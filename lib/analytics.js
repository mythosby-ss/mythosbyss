// Reporting queries for the admin dashboard, finance and marketing modules.
const db = require('./db');
const settings = require('./settings');

const OK = "status NOT IN ('cancelled','awaiting_payment')";           // counted as real orders
const day = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function range(q, def = 7) {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : day(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : day(addDays(new Date(to), -(def - 1)));
  return { from, to, fromTs: from + 'T00:00:00.000Z', toTs: to + 'T23:59:59.999Z' };
}
const days = (from, to) => { const out = []; for (let d = new Date(from); day(d) <= to; d = addDays(d, 1)) out.push(day(d)); return out; };

async function orderDashboard(r, method) {
  const mf = method ? ' AND payment_method=?' : ''; const ma = method ? [method] : [];
  const rows = await db.q(`SELECT substr(created_at,1,10) d, COUNT(*) placed, SUM(status='cancelled') cancelled, SUM(${OK.replace(/status/g, 'status')}) ok,
      SUM(CASE WHEN ${OK} THEN total ELSE 0 END) rev, SUM(total) revAll, SUM(status IN ('shipped','out_for_delivery','ndr')) transit, SUM(status='delivered') delivered, SUM(status='rto') rto, SUM(status IN ('confirmed','packed')) pending
    FROM orders WHERE created_at BETWEEN ? AND ?${mf} GROUP BY d`, [r.fromTs, r.toTs, ...ma]);
  const by = Object.fromEntries(rows.map((x) => [x.d, x]));
  const daily = days(r.from, r.to).map((d) => ({ d, placed: 0, cancelled: 0, ok: 0, rev: 0, revAll: 0, transit: 0, delivered: 0, rto: 0, pending: 0, ...(by[d] || {}) }));
  const tot = daily.reduce((a, x) => { for (const k of ['placed', 'cancelled', 'ok', 'rev', 'revAll', 'transit', 'delivered', 'rto', 'pending']) a[k] += x[k] || 0; return a; }, { placed: 0, cancelled: 0, ok: 0, rev: 0, revAll: 0, transit: 0, delivered: 0, rto: 0, pending: 0 });
  const base = [r.fromTs, r.toTs, ...ma];
  const payment = await db.q(`SELECT payment_method m, COUNT(*) n, SUM(total) rev FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK}${mf} GROUP BY m`, base);
  const states = await db.q(`SELECT state, COUNT(*) n FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK}${mf} GROUP BY state ORDER BY n DESC LIMIT 12`, base);
  const cities = await db.q(`SELECT city, COUNT(*) n FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK}${mf} GROUP BY lower(city) ORDER BY n DESC LIMIT 10`, base);
  const products = await db.q(`SELECT i.product_name name, i.product_slug slug, SUM(i.qty) units FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.created_at BETWEEN ? AND ? AND o.${OK}${mf.replace('payment_method', 'o.payment_method')} GROUP BY i.product_slug ORDER BY units DESC LIMIT 10`, base);
  const cancels = await db.q(`SELECT COALESCE(cancel_reason,'Other') reason, COUNT(*) n FROM orders WHERE created_at BETWEEN ? AND ? AND status='cancelled'${mf} GROUP BY reason ORDER BY n DESC`, base);
  const aov = tot.ok ? Math.round(tot.rev / tot.ok) : 0;
  return { daily, tot, payment, states, cities, products, cancels, aov };
}

async function productPerformance(r) {
  const rows = await db.q(`SELECT i.product_slug slug, i.product_name name, SUM(i.qty) units, SUM(i.qty*i.unit_price) revenue, SUM(i.qty*i.cost_price) cost, COUNT(DISTINCT i.order_id) orders,
      SUM(CASE WHEN o.status='rto' THEN i.qty ELSE 0 END) rto_units, SUM(CASE WHEN o.status='delivered' THEN i.qty ELSE 0 END) delivered_units
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.created_at BETWEEN ? AND ? AND o.${OK} GROUP BY i.product_slug`, [r.fromTs, r.toTs]);
  const views = Object.fromEntries((await db.q("SELECT product_slug s, COUNT(*) n FROM events WHERE type='product_view' AND day BETWEEN ? AND ? GROUP BY s", [r.from, r.to])).map((x) => [x.s, x.n]));
  const sold = Object.fromEntries(rows.map((x) => [x.slug, x]));
  const catalog = require('./catalog');
  const all = catalog.all.map((p) => ({ slug: p.slug, name: p.name, category: p.categoryName, units: 0, revenue: 0, cost: 0, orders: 0, rto_units: 0, delivered_units: 0, ...(sold[p.slug] || {}), views: views[p.slug] || 0, stock: p.stock }));
  const totalRev = all.reduce((s, x) => s + x.revenue, 0);
  all.forEach((x) => { x.share = pct(x.revenue, totalRev); x.rtoPct = pct(x.rto_units, x.units); x.conv = pct(x.orders, x.views); });
  all.sort((a, b) => b.revenue - a.revenue);
  const sellers = all.filter((x) => x.units > 0);
  const best = sellers.slice(0, 5);
  const under = all.filter((x) => x.units === 0 || (x.views >= 10 && x.conv < 1)).sort((a, b) => b.views - a.views).slice(0, 8);
  return { all, best, under, totalRev };
}

async function businessMetrics(r) {
  const sessions = await db.val("SELECT COUNT(DISTINCT sid) FROM events WHERE type='page_view' AND day BETWEEN ? AND ?", [r.from, r.to]);
  const f = async (t) => db.val('SELECT COUNT(DISTINCT sid) FROM events WHERE type=? AND day BETWEEN ? AND ?', [t, r.from, r.to]);
  const funnel = { sessions, product_view: await f('product_view'), add_to_cart: await f('add_to_cart'), begin_checkout: await f('begin_checkout'), purchase: await f('purchase') };
  const sources = await db.q("SELECT source, COUNT(DISTINCT sid) sessions FROM events WHERE type='page_view' AND day BETWEEN ? AND ? GROUP BY source ORDER BY sessions DESC LIMIT 10", [r.from, r.to]);
  const orders = await db.val(`SELECT COUNT(*) FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK}`, [r.fromTs, r.toTs]);
  const repeat = await db.val(`SELECT COUNT(*) FROM (SELECT customer_id FROM orders WHERE ${OK} GROUP BY customer_id HAVING COUNT(*)>1)`);
  const buyers = await db.val(`SELECT COUNT(DISTINCT customer_id) FROM orders WHERE ${OK}`);
  const modes = await db.q(`SELECT payment_method m, COUNT(*) n, SUM(total) rev, SUM(status='delivered') delivered, SUM(status='rto') rto, SUM(status='cancelled') cancelled FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY m`, [r.fromTs, r.toTs]);
  return { funnel, sources, conversion: pct(orders, sessions), repeatRate: pct(repeat, buyers), modes, orders };
}

async function trend(period, count, platform) {
  const out = []; const now = new Date();
  for (let i = 0; i < count; i++) {
    let from, to;
    if (period === 'month') { from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0)); }
    else { const dow = (now.getUTCDay() + 6) % 7; from = addDays(new Date(day(now)), -dow - 7 * i); to = addDays(from, 6); }
    const f = day(from), t = day(to); const ft = f + 'T00:00:00.000Z', tt = t + 'T23:59:59.999Z';
    const o = await db.one(`SELECT COUNT(*) total, SUM(status='cancelled') cancelled, SUM(status='rto') rto, SUM(status='delivered') delivered,
        SUM(CASE WHEN ${OK} THEN total ELSE 0 END) sales, SUM(CASE WHEN ${OK} THEN shipping_fee ELSE 0 END) shipping_charged,
        SUM(CASE WHEN ${OK} THEN courier_charge ELSE 0 END) courier, SUM(CASE WHEN ${OK} AND payment_method!='cod' THEN pay_now ELSE 0 END) online_paid
      FROM orders WHERE created_at BETWEEN ? AND ?`, [ft, tt]);
    const cost = await db.val(`SELECT SUM(i.qty*i.cost_price) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.created_at BETWEEN ? AND ? AND o.${OK}`, [ft, tt]);
    const pf = platform && platform !== 'all' ? ' AND lower(c.platform)=?' : '';
    const spend = await db.val(`SELECT SUM(m.spend) FROM ad_metrics m JOIN campaigns c ON c.id=m.campaign_id WHERE m.day BETWEEN ? AND ?${pf}`, [f, t, ...(pf ? [platform] : [])]);
    const sales = o.sales || 0; const courier = o.courier || 0; const fees = Math.round((o.online_paid || 0) * settings.num('pg_fee_percent')) / 100;
    const net = sales - courier - spend - fees; const prod = cost || 0;
    out.push({ label: period === 'month' ? f.slice(0, 7) : `${f.slice(8)}/${f.slice(5, 7)} - ${t.slice(8)}/${t.slice(5, 7)}`, total: o.total || 0, cancelled: o.cancelled || 0, rto: o.rto || 0, rtoPct: pct(o.rto || 0, (o.total || 0) - (o.cancelled || 0)), delivered: o.delivered || 0, sales, courier, spend, fees, net, prod, profit: net - prod });
  }
  return out;
}

async function campaigns(r) {
  const camps = await db.q('SELECT * FROM campaigns ORDER BY id DESC');
  const out = [];
  for (const c of camps) {
    const m = await db.one('SELECT SUM(spend) spend, SUM(impressions) imp, SUM(clicks) clicks, SUM(conversions) conv FROM ad_metrics WHERE campaign_id=? AND day BETWEEN ? AND ?', [c.id, r.from, r.to]);
    const a = await db.one(`SELECT COUNT(*) orders, SUM(total) revenue FROM orders WHERE utm_campaign=? AND created_at BETWEEN ? AND ? AND ${OK}`, [c.utm_campaign || '\u0000', r.fromTs, r.toTs]);
    const spend = m.spend || 0; const orders = a.orders || 0; const revenue = a.revenue || 0;
    out.push({ ...c, spend, imp: m.imp || 0, clicks: m.clicks || 0, conv: m.conv || 0, orders, revenue, cpa: orders ? Math.round(spend / orders) : 0, roas: spend ? Math.round((revenue / spend) * 100) / 100 : 0, ctr: pct(m.clicks || 0, m.imp || 0), cpc: m.clicks ? Math.round(spend / m.clicks * 100) / 100 : 0 });
  }
  const productWise = await db.q(`SELECT i.product_name name, SUM(i.qty) units, SUM(i.qty*i.unit_price) revenue FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.utm_campaign IS NOT NULL AND o.utm_campaign!='' AND o.created_at BETWEEN ? AND ? AND o.${OK} GROUP BY i.product_slug ORDER BY revenue DESC LIMIT 15`, [r.fromTs, r.toTs]);
  for (const p of productWise) {
    p.spend = await db.val(`SELECT SUM(m.spend) FROM ad_metrics m JOIN campaigns c ON c.id=m.campaign_id WHERE c.product_slug=(SELECT slug FROM products WHERE name=? LIMIT 1) AND m.day BETWEEN ? AND ?`, [p.name, r.from, r.to]);
    p.roas = p.spend ? Math.round((p.revenue / p.spend) * 100) / 100 : null;
  }
  const t = out.reduce((a, c) => ({ spend: a.spend + c.spend, orders: a.orders + c.orders, revenue: a.revenue + c.revenue, clicks: a.clicks + c.clicks, imp: a.imp + c.imp }), { spend: 0, orders: 0, revenue: 0, clicks: 0, imp: 0 });
  return { list: out, productWise, total: { ...t, roas: t.spend ? Math.round((t.revenue / t.spend) * 100) / 100 : 0, cpa: t.orders ? Math.round(t.spend / t.orders) : 0 } };
}

async function seoPerformance(r) {
  const landing = await db.q("SELECT path, COUNT(*) views, COUNT(DISTINCT sid) visitors FROM events WHERE type='page_view' AND day BETWEEN ? AND ? GROUP BY path ORDER BY views DESC LIMIT 12", [r.from, r.to]);
  const sources = await db.q("SELECT source, COUNT(DISTINCT sid) visitors FROM events WHERE type='page_view' AND day BETWEEN ? AND ? GROUP BY source ORDER BY visitors DESC LIMIT 8", [r.from, r.to]);
  const organic = await db.val("SELECT COUNT(DISTINCT sid) FROM events WHERE type='page_view' AND day BETWEEN ? AND ? AND source IN ('google','bing','duckduckgo','yahoo')", [r.from, r.to]);
  const searches = await db.q("SELECT term, COUNT(*) n, MAX(results) results FROM events WHERE type='search' AND day BETWEEN ? AND ? GROUP BY term ORDER BY n DESC LIMIT 12", [r.from, r.to]);
  return { landing, sources, organic, searches };
}

module.exports = { OK, day, addDays, pct, range, orderDashboard, productPerformance, businessMetrics, trend, campaigns, seoPerformance };
