// Emails to the shop owner (not customers):
//   A. instant "New order" email - sent in the background when an order is placed (COD) or paid (prepaid / partial COD advance)
//   B. daily report at daily_report_time (default 22:00 Asia/Kolkata)
// Both are switched on in Admin > Settings > Ops & owner emails, and never block or slow down checkout:
// the checkout response is sent first, the email goes out afterwards with up to 3 tries. Every try is logged in notification_logs.
// No full customer phone number or street address is ever put in these emails.
const path = require('path');
const db = require('./db');
const settings = require('./settings');
const mailer = require('./mailer');
const { readCsv, opsSettings, ROOT, dataDir } = require('./opscsv');
const T = require('./email-template');

const T_ORDER = 'owner_new_order'; const T_DAILY = 'owner_daily_report';
const RETRY_MS = [0, 30e3, 120e3]; // 3 tries: now, +30 s, +2 min
const site = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const money = (n) => { const v = Math.round(Number(n || 0) * 100) / 100; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// India time helpers (orders store UTC ISO timestamps)
const istNow = () => new Date(Date.now() + 330 * 60000); // read with getUTC*()
const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const bounds = (fromDay, toDay = fromDay) => [new Date(fromDay + 'T00:00:00+05:30').toISOString(), new Date(new Date(toDay + 'T00:00:00+05:30').getTime() + 864e5 - 1).toISOString()];

/** Owner address: admin setting > OWNER_EMAIL in .env > owner_email in ops/data/settings.csv */
const recipient = () => String(settings.get('owner_email') || process.env.OWNER_EMAIL || opsSettings().owner_email || '').trim();

async function log(orderId, template, status, error, payload) {
  const now = db.nowIso();
  await db.run('INSERT INTO notification_logs(order_id,customer_phone,template,status,error,payload,send_at,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    [orderId || null, null, template, status, error || null, JSON.stringify(payload || {}), now, status === 'sent' || status === 'simulated' ? now : null, now]).catch(() => {});
}

/** Send with up to 3 tries in the background. Resolves with the last result (callers on the request path do not await it). */
function sendWithRetry(msg, { orderId, template }) {
  return new Promise((resolve) => {
    let attempt = 0;
    const run = async () => {
      const r = await mailer.send(msg);
      attempt++;
      if (r.ok) { await log(orderId, template, mailer.jsonMode() ? 'simulated' : 'sent', null, { subject: msg.subject, to: msg.to, try: attempt }); return resolve(r); }
      if (attempt < RETRY_MS.length && !/not set up|No recipient/.test(r.error)) return setTimeout(run, RETRY_MS[attempt]).unref();
      await log(orderId, template, 'failed', r.error, { subject: msg.subject, to: msg.to, try: attempt });
      console.error(`[owner-mail] ${template} ${orderId || ''} failed: ${r.error}`);
      resolve(r);
    };
    run();
  });
}

/* ---------- A. New order email ---------- */
const PAY = (o) => (o.payment_method === 'prepaid' ? `Prepaid (paid ${money(o.pay_now)} online)`
  : o.payment_method === 'partial_cod' ? `Partial COD (advance ${money(o.pay_now)} paid, ${money(o.due_on_delivery)} on delivery)`
    : `COD (${money(o.due_on_delivery)} to collect on delivery)`);

function newOrderMessage(o, items) {
  const names = items.map((i) => `${i.product_name}${i.variant_label ? ' (' + i.variant_label + ')' : ''} × ${i.qty}`).join(', ');
  const first = items[0] ? items[0].product_name + (items.length > 1 ? ` +${items.length - 1} more` : '') : 'Order';
  const link = `${site()}/admin/orders/${encodeURIComponent(o.id)}`;
  const lines = [`You have received the order ${names} of ${money(o.total)}.`, '', `Payment: ${PAY(o)}`, `Deliver to: ${o.city || '-'}, ${o.pincode || '-'}`, `Open in admin: ${link}`];
  return {
    subject: `New order #${o.id} – ${first} – ${money(o.total)}`,
    text: lines.join('\n'),
    html: newOrderHtml(o, items, link)
  };
}

const PAY_BADGE = { prepaid: ['PREPAID', 'green'], partial_cod: ['PARTIAL COD', 'blue'], cod: ['CASH ON DELIVERY', 'amber'] };
function newOrderHtml(o, items, link) {
  const { layout, badge, button, heading, rows, C, FONT } = T;
  const when = o.created_at ? new Date(o.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const units = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const [payLabel, payTone] = PAY_BADGE[o.payment_method] || PAY_BADGE.cod;
  const itemRows = items.map((i) => {
    const line = i.unit_price != null ? money(i.unit_price * i.qty) : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.line};${FONT}">
      <p style="margin:0;font-size:15px;font-weight:600;color:${C.ink}">${esc(i.product_name)}</p>
      <p style="margin:3px 0 0;font-size:13px;color:${C.muted}">${i.variant_label ? esc(i.variant_label) + ' &middot; ' : ''}Qty ${esc(i.qty)}${i.unit_price != null ? ' &times; ' + money(i.unit_price) : ''}</p></td>
      <td align="right" valign="top" style="padding:12px 0;border-bottom:1px solid ${C.line};${FONT};font-size:15px;font-weight:600;color:${C.ink};white-space:nowrap">${line}</td></tr>`;
  }).join('');
  const price = [];
  if (o.subtotal != null) price.push(['Subtotal', money(o.subtotal)]);
  if (o.discount > 0) price.push(['Discounts' + (o.coupon_code ? ` (${o.coupon_code})` : ''), '− ' + money(o.discount)]);
  if (o.subtotal != null) price.push(['Shipping', o.shipping_fee > 0 ? money(o.shipping_fee) : 'Free']);
  if (o.cod_fee > 0) price.push(['COD fee', money(o.cod_fee)]);
  price.push(['Order total', money(o.total), { big: true }]);
  const pay = [];
  if (o.payment_method !== 'cod') pay.push(['Paid online', `<span style="color:#17663a;font-weight:700">${money(o.pay_now)}</span>`]);
  if (o.payment_method !== 'prepaid') pay.push(['To collect on delivery', `<b>${money(o.due_on_delivery)}</b>`]);
  const meta = [['Deliver to', esc([o.city, o.state].filter(Boolean).join(', ') + (o.pincode ? ' – ' + o.pincode : ''))]];
  if (o.preferred_language) meta.push(['Preferred language', esc(o.preferred_language)]);
  if (o.utm_source && o.utm_source !== 'direct') meta.push(['Came from', esc([o.utm_source, o.utm_campaign].filter(Boolean).join(' / '))]);
  const body = `
    <p style="margin:0 0 6px;${FONT};font-size:13px;color:${C.muted}">${esc(when)}</p>
    <h1 style="margin:0 0 8px;${FONT};font-size:24px;line-height:1.25;color:${C.ink}">New order received 🎉</h1>
    <p style="margin:0 0 18px;${FONT};font-size:15px;line-height:1.5;color:#333">You have received an order of <b>${units} item${units === 1 ? '' : 's'}</b> worth <b>${money(o.total)}</b>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border-radius:12px;margin:0 0 22px"><tr>
      <td style="padding:16px 18px;${FONT}"><p style="margin:0;font-size:12px;color:${C.goldDark};font-weight:700;letter-spacing:.5px">ORDER</p><p style="margin:2px 0 0;font-size:17px;font-weight:800;color:${C.ink}">#${esc(o.id)}</p></td>
      <td align="right" style="padding:16px 18px">${badge(payLabel, payTone)}</td></tr></table>
    ${heading('Items')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px">${itemRows}</table>
    ${heading('Price')}
    <div style="margin:0 0 22px">${rows(price)}</div>
    ${heading('Payment')}
    <div style="margin:0 0 22px">${rows(pay)}</div>
    ${heading('Delivery')}
    <div style="margin:0 0 28px">${rows(meta)}</div>
    ${button(link, 'Open order in admin')}
    <p style="margin:14px 0 0;text-align:center;${FONT};font-size:12px;color:${C.muted}">${o.payment_method === 'cod' ? 'COD order: confirm it with the customer before shipping.' : 'Customer phone and full address are in the admin order page.'}</p>`;
  return layout({ title: `New order #${o.id}`, preheader: `${money(o.total)} · ${payLabel.toLowerCase()} · ${o.city || ''}`, eyebrow: 'New order', body });
}

const inFlight = new Set();
/** Call when an order is placed (COD) or paid (prepaid / advance). Returns immediately; at most one email per order. */
function newOrder(orderId) {
  if (!settings.on('owner_email_new_order') || inFlight.has(orderId)) return;
  inFlight.add(orderId);
  setImmediate(async () => {
    try {
      if (await db.val("SELECT COUNT(*) FROM notification_logs WHERE order_id=? AND template=? AND status IN ('sent','simulated')", [orderId, T_ORDER])) return;
      const o = await db.one('SELECT * FROM orders WHERE id=?', [orderId]); if (!o) return;
      const items = await db.q('SELECT product_name, variant_label, qty, unit_price FROM order_items WHERE order_id=? ORDER BY id', [orderId]);
      await sendWithRetry({ to: recipient(), ...newOrderMessage(o, items) }, { orderId, template: T_ORDER });
    } catch (e) { console.error('[owner-mail] new order', e.message); } finally { inFlight.delete(orderId); }
  });
}

/* ---------- B. Daily report ---------- */
const NA = 'not available';
// Orders that were really placed: not unpaid online attempts
const PLACED = "status<>'awaiting_payment' AND NOT (status='cancelled' AND payment_status IN ('pending','failed'))";

async function lossRows(where, args) {
  // RTO: forward + RTO + COD fee charged by the courier. NULL charge columns = not entered yet.
  return db.one(`SELECT COUNT(*) n, SUM(total) value, SUM(COALESCE(courier_charge,0) + COALESCE(rto_charge,0) + COALESCE(courier_cod_charge,0)) charges,
    SUM(CASE WHEN rto_charge IS NULL THEN 1 ELSE 0 END) missing FROM orders WHERE ${where}`, args);
}
async function returnRows(where, args) {
  return db.one(`SELECT COUNT(*) n, SUM(COALESCE(reverse_pickup_charge,0)) reverse, SUM(CASE WHEN reverse_pickup_charge IS NULL THEN 1 ELSE 0 END) missing,
    COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.order_id IN (SELECT id FROM orders WHERE ${where})), 0) refunds FROM orders WHERE ${where}`, [...args, ...args]);
}

/** Ad spend for one day: ops/data/meta_ads.csv row(s) for the day, else spend saved in admin (manual entry or Meta sync), else null. */
async function adSpend(day) {
  const rows = readCsv(path.join(dataDir(), 'meta_ads.csv'));
  const today = (rows || []).filter((r) => r.date === day);
  if (today.length) return { amount: today.reduce((s, r) => s + (Number(r.spend) || 0), 0), source: 'meta_ads.csv' };
  const manual = await db.one('SELECT amount FROM daily_ad_spend WHERE day=?', [day]);
  if (manual) return { amount: manual.amount, source: 'entered in admin' };
  const synced = await db.one('SELECT COUNT(*) n, SUM(spend) s FROM ad_metrics WHERE day=?', [day]);
  if (synced && synced.n) return { amount: synced.s || 0, source: 'ad account sync' };
  return null;
}

/** Open RTO tickets from ops/tickets/rto/_index.csv (only where the agents run, e.g. your computer). */
function openTickets() {
  const rows = readCsv(path.join(ROOT, 'tickets', 'rto', '_index.csv'));
  if (!rows) return null;
  return rows.filter((r) => /^(OPEN|WAIVER)/i.test(r.status || '')).length;
}

async function dailyData(day = istDay()) {
  const [from, to] = bounds(day);
  const [mFrom] = bounds(day.slice(0, 8) + '01');
  const split = await db.q(`SELECT payment_method m, COUNT(*) n, SUM(total) v FROM orders WHERE created_at BETWEEN ? AND ? AND ${PLACED} GROUP BY payment_method`, [from, to]);
  const by = (m) => split.find((x) => x.m === m) || { n: 0, v: 0 };
  const delivered = await db.one('SELECT COUNT(*) n, SUM(total) v FROM orders WHERE delivered_at BETWEEN ? AND ?', [from, to]);
  const rto = await lossRows("status='rto' AND cancelled_at BETWEEN ? AND ?", [from, to]);
  const ret = await returnRows("status='returned' AND returned_at BETWEEN ? AND ?", [from, to]);
  const rtoM = await lossRows("status='rto' AND cancelled_at BETWEEN ? AND ?", [mFrom, to]);
  const retM = await returnRows("status='returned' AND returned_at BETWEEN ? AND ?", [mFrom, to]);
  const counts = await db.one("SELECT SUM(status='pending_confirmation') pending, SUM(status IN ('shipped','out_for_delivery','ndr')) transit FROM orders");
  return {
    day,
    orders: { n: split.reduce((s, x) => s + x.n, 0), v: split.reduce((s, x) => s + (x.v || 0), 0), prepaid: by('prepaid'), partial: by('partial_cod'), cod: by('cod') },
    delivered: { n: delivered.n || 0, v: delivered.v || 0 },
    rto: { n: rto.n || 0, loss: rto.charges || 0, missing: rto.missing || 0 },
    returns: { n: ret.n || 0, loss: (ret.reverse || 0) + (ret.refunds || 0), missing: ret.missing || 0 },
    lossToday: (rto.charges || 0) + (ret.reverse || 0) + (ret.refunds || 0),
    lossMonth: (rtoM.charges || 0) + (retM.reverse || 0) + (retM.refunds || 0),
    missingMonth: (rtoM.missing || 0) + (retM.missing || 0),
    pending: counts.pending || 0, transit: counts.transit || 0,
    tickets: openTickets(), ads: await adSpend(day)
  };
}

function dailyMessage(d) {
  const note = (missing) => (missing ? ` (charges not entered for ${missing} order${missing > 1 ? 's' : ''})` : '');
  const nice = new Date(d.day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const rows = [
    ['Orders today', `${d.orders.n} · ${money(d.orders.v)}`],
    ['  Prepaid', `${d.orders.prepaid.n} · ${money(d.orders.prepaid.v)}`],
    ['  Partial COD', `${d.orders.partial.n} · ${money(d.orders.partial.v)}`],
    ['  COD', `${d.orders.cod.n} · ${money(d.orders.cod.v)}`],
    ['Delivered today', `${d.delivered.n} · ${money(d.delivered.v)}`],
    ['RTO today', `${d.rto.n} · loss ${money(d.rto.loss)} (forward + RTO + COD fee)${note(d.rto.missing)}`],
    ['Returns today', `${d.returns.n} · loss ${money(d.returns.loss)} (reverse pickup + refunds)${note(d.returns.missing)}`],
    ['RTO + return loss today', money(d.lossToday)],
    ['RTO + return loss this month', money(d.lossMonth) + note(d.missingMonth)],
    ['Pending confirmation', String(d.pending)],
    ['In transit', String(d.transit)],
    ['Open RTO tickets', d.tickets === null ? `${NA} (tickets are kept where the ops agents run)` : String(d.tickets)],
    ['Ad spend today', d.ads ? `${money(d.ads.amount)} (${d.ads.source})` : NA]
  ];
  return {
    subject: `Mythos daily report – ${nice}`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\nAdmin: ${site()}/admin`,
    html: dailyHtml(d, nice, note)
  };
}

function dailyHtml(d, nice, note) {
  const { layout, button, heading, rows, C, FONT } = T;
  const tile = (label, value, sub, color = C.ink) => `<td width="33%" valign="top" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border-radius:12px"><tr><td style="padding:14px 12px;${FONT}">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.5px;color:${C.goldDark};text-transform:uppercase">${esc(label)}</p>
    <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:${color}">${esc(value)}</p><p style="margin:2px 0 0;font-size:12px;color:${C.muted}">${esc(sub)}</p></td></tr></table></td>`;
  const cnt = (x) => `${x.n} · ${money(x.v)}`;
  const red = (v) => (v > 0 ? `<span style="color:#a11d1d;font-weight:700">${money(v)}</span>` : money(v));
  const body = `
    <h1 style="margin:0 0 4px;${FONT};font-size:24px;color:${C.ink}">Daily report</h1>
    <p style="margin:0 0 18px;${FONT};font-size:14px;color:${C.muted}">${esc(nice)} &middot; India time</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px"><tr>
      ${tile('Orders', String(d.orders.n), money(d.orders.v))}${tile('Delivered', String(d.delivered.n), money(d.delivered.v), '#17663a')}${tile('Loss today', money(d.lossToday), 'RTO + returns', d.lossToday > 0 ? '#a11d1d' : C.ink)}
    </tr></table>
    ${heading("Today's orders by payment")}
    <div style="margin:0 0 22px">${rows([['Prepaid', esc(cnt(d.orders.prepaid))], ['Partial COD', esc(cnt(d.orders.partial))], ['COD', esc(cnt(d.orders.cod))], ['Total', esc(cnt(d.orders)), { bold: true }]])}</div>
    ${heading('RTO & returns')}
    <div style="margin:0 0 22px">${rows([
      ['RTO today', `${d.rto.n} · ${red(d.rto.loss)}`], ['', `<span style="font-size:12px;color:${C.muted}">forward + RTO + COD fee${esc(note(d.rto.missing))}</span>`],
      ['Returns today', `${d.returns.n} · ${red(d.returns.loss)}`], ['', `<span style="font-size:12px;color:${C.muted}">reverse pickup + refunds${esc(note(d.returns.missing))}</span>`],
      ['Loss this month', red(d.lossMonth) + (d.missingMonth ? `<br><span style="font-size:12px;color:${C.muted}">${esc(note(d.missingMonth).trim())}</span>` : ''), { bold: true }]])}</div>
    ${heading('Pipeline')}
    <div style="margin:0 0 22px">${rows([['Pending confirmation', `<b>${d.pending}</b>`], ['In transit', String(d.transit)],
      ['Open RTO tickets', d.tickets === null ? `<span style="color:${C.muted}">not available</span>` : String(d.tickets)]])}</div>
    ${heading('Marketing')}
    <div style="margin:0 0 28px">${rows([['Ad spend today', d.ads ? `${money(d.ads.amount)} <span style="font-size:12px;color:${C.muted}">(${esc(d.ads.source)})</span>` : `<span style="color:${C.muted}">not available</span>`]])}</div>
    ${button(site() + '/admin', 'Open admin dashboard')}`;
  return layout({ title: `Daily report ${nice}`, preheader: `${d.orders.n} orders · ${money(d.orders.v)} · ${d.delivered.n} delivered · loss ${money(d.lossToday)}`, eyebrow: nice, body });
}

async function sendDaily(day = istDay(), { test = false } = {}) {
  const msg = dailyMessage(await dailyData(day));
  if (test) msg.subject = '[TEST] ' + msg.subject;
  return sendWithRetry({ to: recipient(), ...msg }, { orderId: null, template: T_DAILY });
}

/** Runs every minute (cheap: only settings in memory are read until it is time). Survives restarts: the last sent day is saved
 *  in the settings table, so a restart never sends twice, and if the app was down at 22:00 the report goes out when it is back. */
let running = false;
async function tick() {
  if (running || !settings.on('owner_email_daily')) return { ok: false, skipped: 'off' };
  const [hh, mm] = String(settings.get('daily_report_time') || '22:00').split(':').map(Number);
  const now = istNow(); const day = istDay();
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < (hh || 0) * 60 + (mm || 0)) return { ok: false, skipped: 'too early' };
  if (settings.get('owner_report_last_day') === day) return { ok: false, skipped: 'already sent' };
  running = true;
  try {
    await settings.set('owner_report_last_day', day); // claim first, so two triggers cannot both send
    return await sendDaily(day);
  } catch (e) { console.error('[owner-mail] daily', e.message); return { ok: false, error: e.message }; } finally { running = false; }
}
function startScheduler() { setInterval(() => tick().catch(() => {}), 60000).unref(); }

/** Test emails from admin: the latest real order (or a made-up example if there is none yet), and today's report. */
async function sendTest(kind) {
  if (kind === 'daily') return sendDaily(istDay(), { test: true });
  const o = await db.one(`SELECT * FROM orders WHERE ${PLACED} ORDER BY created_at DESC LIMIT 1`);
  const items = o ? await db.q('SELECT product_name, variant_label, qty, unit_price FROM order_items WHERE order_id=? ORDER BY id', [o.id]) : [{ product_name: 'Example product', variant_label: '', qty: 1 }];
  const msg = newOrderMessage(o || { id: 'MBTEST', total: 999, pay_now: 0, due_on_delivery: 999, payment_method: 'cod', city: 'Example city', pincode: '000000' }, items);
  msg.subject = '[TEST] ' + msg.subject;
  return sendWithRetry({ to: recipient(), ...msg }, { orderId: null, template: T_ORDER + '_test' });
}

module.exports = { RETRY_MS, newOrder, sendDaily, sendTest, tick, startScheduler, dailyData, dailyMessage, newOrderMessage, recipient, istDay };
