// Profit & RTO maths for Admin > Analytics > Profit & RTO.
//
// Per order (money in ₹):
//   selling price     = order total paid by the customer (minus refunds; minus GST if "deduct GST" is on)
//   product cost      = Σ item cost × qty (cost saved on the order; current variant cost if it was 0)
//   packaging         = highest packaging cost among the order's products (one box), else the default
//   forward shipping  = courier charge entered when shipping, else the highest product shipping cost, else the default
//   payment / COD fee = gateway % × amount paid online  +  COD fee on cash collected = max(min ₹, % × cash)
//   PROFIT PER ORDER  = selling price − product cost − packaging − forward shipping − payment/COD fee
//   LOSS PER RTO      = forward shipping + reverse shipping + packaging
//                       (a partial-COD advance kept on an RTO is shown separately and reduces the loss)
//
// Period:
//   PROFIT / LOSS     = Σ profit of delivered orders − Σ loss of RTO orders + advances kept − ad spend
//                       (= delivered × avg profit per order − RTO count × avg loss per RTO − ad spend)
//   RTO %             = RTO ÷ (delivered + RTO)      (orders still in transit are not counted yet)
//   Breakeven RTO %   = (P − A) ÷ (P + L)   P = avg profit per delivered order, L = avg loss per RTO,
//                                            A = ad spend per order placed (0 for the "before ads" figure)
//   Breakeven orders/day = average daily ad spend ÷ ((1 − r) × P − r × L)   at the current RTO rate r
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');

const r2 = (n) => Math.round(n * 100) / 100;
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

function range(q, defDays = 30) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const to = ok(q.to) ? q.to : day(new Date());
  const from = ok(q.from) ? q.from : day(addDays(new Date(to + 'T00:00:00Z'), -(defDays - 1)));
  return { from, to, fromTs: from + 'T00:00:00.000Z', toTs: to + 'T23:59:59.999Z' };
}
const daysIn = (from, to) => { const out = []; for (let d = new Date(from + 'T00:00:00Z'); day(d) <= to; d = addDays(d, 1)) out.push(day(d)); return out; };

/** Cost assumptions from settings. */
function assumptions() {
  return {
    packaging: settings.num('profit_packaging_default'), forward: settings.num('profit_forward_shipping_default'), reverse: settings.num('profit_reverse_shipping'),
    pgPct: settings.num('pg_fee_percent'), codPct: settings.num('cod_handling_percent'), codMin: settings.num('cod_handling_min'),
    gst: settings.on('profit_deduct_gst') ? settings.num('gst_percent') : 0
  };
}

const skuMap = () => { const m = {}; catalog.all.forEach((p) => p.variants.forEach((v) => { m[v.sku] = { v, p }; })); return m; };

/** Economics of one order (both outcomes, so averages work before orders are delivered). */
function economics(o, a) {
  const variants = a.variants || skuMap();
  const prods = o.items.map((i) => (variants[i.sku] || {}).p || catalog.allBySlug(i.product_slug)).filter(Boolean);
  const productCost = o.items.reduce((s, i) => s + (i.cost_price || ((variants[i.sku] || {}).v || {}).cost || 0) * i.qty, 0);
  const pick = (k, def) => { const vals = prods.map((p) => p[k]).filter((x) => x != null && x !== ''); return vals.length ? Math.max(...vals.map(Number)) : def; };
  const packaging = pick('packagingCost', a.packaging);
  const forward = o.courier_charge > 0 ? o.courier_charge : pick('shippingCost', a.forward);
  const paidOnline = ['paid', 'advance_paid', 'refunded', 'partially_refunded'].includes(o.payment_status) ? o.pay_now || 0 : 0;
  const cash = o.due_on_delivery || 0;
  const pgFee = paidOnline * a.pgPct / 100;
  const codFee = cash > 0 ? Math.max(a.codMin, cash * a.codPct / 100) : 0;
  let revenue = (o.total || 0) - (o.refunded || 0);
  if (a.gst) revenue -= revenue * a.gst / (100 + a.gst);
  const profit = revenue - productCost - packaging - forward - pgFee - codFee;
  const rtoLoss = forward + a.reverse + packaging;
  const advanceKept = o.payment_method === 'partial_cod' ? Math.max(0, paidOnline - (o.refunded || 0)) : 0;
  return { revenue: r2(revenue), productCost: r2(productCost), packaging: r2(packaging), forward: r2(forward), fees: r2(pgFee + codFee), profit: r2(profit), rtoLoss: r2(rtoLoss), advanceKept: r2(advanceKept) };
}

/** outcome bucket: delivered | rto | cancelled | transit | pending */
function outcome(o) {
  if (o.status === 'delivered') return 'delivered';
  if (o.status === 'rto' || (o.status === 'cancelled' && o.shipped_at)) return 'rto'; // cancelled after it was shipped costs like an RTO
  if (o.status === 'cancelled') return 'cancelled';
  if (['shipped', 'out_for_delivery', 'ndr'].includes(o.status)) return 'transit';
  return 'pending';
}

async function adSpendByDay(from, to) {
  const manual = Object.fromEntries((await db.q('SELECT day, amount FROM daily_ad_spend WHERE day BETWEEN ? AND ?', [from, to])).map((r) => [r.day, r.amount]));
  const campaigns = Object.fromEntries((await db.q('SELECT day, SUM(spend) s FROM ad_metrics WHERE day BETWEEN ? AND ? GROUP BY day', [from, to])).map((r) => [r.day, r.s]));
  const out = {};
  for (const d of daysIn(from, to)) out[d] = d in manual ? { amount: manual[d], source: 'manual' } : { amount: campaigns[d] || 0, source: campaigns[d] ? 'campaigns' : '' };
  return out;
}

/** Real orders placed in the range (not abandoned online payments), with economics. */
async function loadOrders(r) {
  const orders = await db.q(`SELECT * FROM orders WHERE created_at BETWEEN ? AND ? AND status <> 'awaiting_payment'
    AND NOT (status='cancelled' AND cancel_reason='Payment not completed') ORDER BY created_at`, [r.fromTs, r.toTs]);
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id); const ph = ids.map(() => '?').join(',');
  const items = await db.q(`SELECT * FROM order_items WHERE order_id IN (${ph})`, ids);
  const refunds = Object.fromEntries((await db.q(`SELECT order_id, SUM(amount) s FROM refunds WHERE order_id IN (${ph}) GROUP BY order_id`, ids)).map((x) => [x.order_id, x.s]));
  const a = { ...assumptions(), variants: skuMap() };
  for (const o of orders) {
    o.items = items.filter((i) => i.order_id === o.id); o.refunded = refunds[o.id] || 0;
    o.outcome = outcome(o); o.eco = economics(o, a); o.day = o.created_at.slice(0, 10);
  }
  return orders;
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const avg = (list, f) => (list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0);

function summarise(orders, spend) {
  const by = (k) => orders.filter((o) => o.outcome === k);
  const delivered = by('delivered'); const rto = by('rto');
  const profitDelivered = delivered.reduce((s, o) => s + o.eco.profit, 0);
  const rtoLoss = rto.reduce((s, o) => s + o.eco.rtoLoss, 0);
  const advanceKept = rto.reduce((s, o) => s + o.eco.advanceKept, 0);
  return { orders: orders.length, delivered: delivered.length, rto: rto.length, cancelled: by('cancelled').length, transit: by('transit').length, pending: by('pending').length,
    profitDelivered: r2(profitDelivered), rtoLoss: r2(rtoLoss), advanceKept: r2(advanceKept), spend: r2(spend), net: r2(profitDelivered - rtoLoss + advanceKept - spend) };
}

/** Group RTO % by a key among resolved orders (delivered + RTO). */
function rtoBy(orders, keyFn, limit = 25) {
  const m = {};
  for (const o of orders.filter((x) => x.outcome === 'delivered' || x.outcome === 'rto')) {
    const k = keyFn(o) || '(unknown)'; const g = (m[k] = m[k] || { key: k, n: 0, rto: 0, loss: 0 });
    g.n++; if (o.outcome === 'rto') { g.rto++; g.loss += o.eco.rtoLoss; }
  }
  return Object.values(m).map((g) => ({ ...g, pct: pct(g.rto, g.n), loss: r2(g.loss) })).sort((x, y) => y.rto - x.rto || y.pct - x.pct || y.n - x.n).slice(0, limit);
}

async function report(q) {
  const r = range(q);
  const orders = await loadOrders(r);
  const spendDays = await adSpendByDay(r.from, r.to);
  const totalSpend = Object.values(spendDays).reduce((s, x) => s + x.amount, 0);
  const sum = summarise(orders, totalSpend);
  const mix = Object.fromEntries(['prepaid', 'partial_cod', 'cod'].map((m) => { const n = orders.filter((o) => o.payment_method === m).length; return [m, { n, pct: pct(n, orders.length) }]; }));
  const resolved = sum.delivered + sum.rto;
  const rtoRate = resolved ? sum.rto / resolved : 0;

  // Unit economics: P and L averaged over every order (as if delivered / as if returned), so they exist before outcomes are known
  const P = avg(orders, (o) => o.eco.profit); const L = avg(orders, (o) => o.eco.rtoLoss);
  const days = daysIn(r.from, r.to).length;
  const cpa = orders.length ? totalSpend / orders.length : 0;
  const perOrder = (1 - rtoRate) * P - rtoRate * L; // expected contribution per order before ads, at the current RTO rate
  const be = {
    P: r2(P), L: r2(L), cpa: r2(cpa), rtoPct: r2(rtoRate * 100), perOrder: r2(perOrder), perOrderAfterAds: r2(perOrder - cpa),
    rtoBeforeAds: P + L > 0 ? r2(Math.max(0, P / (P + L)) * 100) : 0,
    rtoWithAds: P + L > 0 ? r2(Math.max(0, (P - cpa) / (P + L)) * 100) : 0,
    avgDailySpend: r2(totalSpend / days),
    ordersPerDay: perOrder > 0 ? Math.ceil((totalSpend / days) / perOrder * 10) / 10 : null,
    ordersPerDayActual: r2(orders.length / days)
  };

  const daily = daysIn(r.from, r.to).map((d) => ({ day: d, spendSource: spendDays[d].source, ...summarise(orders.filter((o) => o.day === d), spendDays[d].amount) })).reverse();
  const unit = { revenue: avg(orders, (o) => o.eco.revenue), productCost: avg(orders, (o) => o.eco.productCost), packaging: avg(orders, (o) => o.eco.packaging), forward: avg(orders, (o) => o.eco.forward), fees: avg(orders, (o) => o.eco.fees) };
  Object.keys(unit).forEach((k) => { unit[k] = r2(unit[k]); });

  return { r, sum, mix, resolved, rtoPct: pct(sum.rto, resolved), be, unit, a: assumptions(), daily, spendDays,
    byPincode: rtoBy(orders, (o) => o.pincode), byState: rtoBy(orders, (o) => o.state), byCourier: rtoBy(orders, (o) => o.courier),
    byPayment: rtoBy(orders, (o) => o.payment_method), byCity: rtoBy(orders, (o) => o.city && o.city.trim().toLowerCase()) };
}

/** Last N calendar months (UTC), same P&L formula. */
async function monthly(n = 6) {
  const now = new Date(); const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0));
    const r = { from: day(from), to: day(to), fromTs: day(from) + 'T00:00:00.000Z', toTs: day(to) + 'T23:59:59.999Z' };
    const orders = await loadOrders(r);
    const spend = Object.values(await adSpendByDay(r.from, r.to)).reduce((s, x) => s + x.amount, 0);
    const s = summarise(orders, spend);
    out.push({ month: r.from.slice(0, 7), ...s, rtoPct: pct(s.rto, s.delivered + s.rto) });
  }
  return out.reverse();
}

module.exports = { report, monthly, range, daysIn, assumptions, economics };
