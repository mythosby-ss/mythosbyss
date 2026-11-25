// Order lifecycle WhatsApp notifications + a tiny in-process scheduler (review requests, abandoned-payment cleanup).
const db = require('./db');
const wa = require('./whatsapp');
const settings = require('./settings');
const catalog = require('./catalog');

const site = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const abs = (u) => (u && u.startsWith('/') ? site() + u : u);
const money = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');

async function already(orderId, template) {
  return (await db.val("SELECT COUNT(*) FROM notification_logs WHERE order_id=? AND template=? AND status IN ('sent','simulated','scheduled')", [orderId, template])) > 0;
}
async function load(orderId) {
  const o = await db.one('SELECT * FROM orders WHERE id=?', [orderId]);
  if (o) o.items = await db.q('SELECT * FROM order_items WHERE order_id=?', [orderId]);
  return o;
}

async function onConfirmed(orderId) {
  const o = await load(orderId); if (!o) return;
  // Server-side Purchase (Meta CAPI + GA4), exactly once per order. Reaching "confirmed" means: paid online,
  // partial-COD advance paid, or COD confirmed by the admin (see the PURCHASE RULE in lib/capi.js).
  const capi = require('./capi');
  const dest = capi.configured();
  if (dest && !(await db.val("SELECT COUNT(*) FROM order_events WHERE order_id=? AND actor='conversions' AND note LIKE 'Purchase%'", [orderId]))) {
    await db.run('INSERT INTO order_events(order_id,status,note,actor,at) VALUES(?,?,?,?,?)', [orderId, null, `Purchase queued for ${dest}`, 'conversions', db.nowIso()]);
    capi.purchase(o);
  }
  if (!wa.enabled() || await already(orderId, wa.T.confirmed)) return;
  const items = o.items.map((i) => `${i.product_name} (${i.variant_label}) x${i.qty}`).join(', ');
  const qty = o.items.reduce((s, i) => s + i.qty, 0);
  const pay = o.payment_method === 'prepaid' ? `Prepaid - paid ${money(o.pay_now)}`
    : o.payment_method === 'partial_cod' ? `Partial COD - paid ${money(o.pay_now)}, pay ${money(o.due_on_delivery)} on delivery`
    : `Cash on delivery - pay ${money(o.due_on_delivery)} on delivery`;
  await wa.sendAndLog({ phone: o.phone, orderId, template: wa.T.confirmed, body: [o.name.split(' ')[0], o.id, items, String(qty), money(o.total), pay] });
}

async function onStatus(orderId, status) {
  if (status === 'confirmed') return onConfirmed(orderId); // also sends conversion events, even when WhatsApp is off
  if (!wa.enabled()) return;
  const o = await load(orderId); if (!o) return;
  const first = o.name.split(' ')[0];
  if (status === 'shipped' && !(await already(orderId, wa.T.shipped)))
    await wa.sendAndLog({ phone: o.phone, orderId, template: wa.T.shipped, body: [first, o.id, o.courier || 'our courier partner', o.awb || 'will be shared soon'], urlSuffix: o.id });
  if (status === 'out_for_delivery' && !(await already(orderId, wa.T.out_for_delivery)))
    await wa.sendAndLog({ phone: o.phone, orderId, template: wa.T.out_for_delivery, body: [first, o.id, o.payment_method === 'prepaid' ? 'No payment needed' : `Please keep ${money(o.due_on_delivery)} ready`] });
  if (status === 'delivered') {
    if (!(await already(orderId, wa.T.delivered))) await wa.sendAndLog({ phone: o.phone, orderId, template: wa.T.delivered, body: [first, o.id] });
    if (!(await already(orderId, wa.T.review))) {
      const delay = settings.num('review_delay_hours');
      await wa.log({ orderId, phone: o.phone, template: wa.T.review, status: 'scheduled', sendAt: new Date(Date.now() + delay * 36e5).toISOString(), payload: { orderId } });
      if (delay <= 0) await processQueue();
    }
  }
}

async function sendReview(row) {
  const o = await load(row.order_id);
  if (!o) return { ok: false, error: 'order missing' };
  const p = catalog.allBySlug(o.items[0].product_slug);
  const img = p && p.hasImage ? abs(p.image) : null;
  return wa.sendTemplate({ phone: o.phone, template: wa.T.review, headerImage: img || abs('/images/review-header.png'),
    body: [o.name.split(' ')[0], o.items.map((i) => i.product_name).slice(0, 2).join(' & ')], urlSuffix: o.review_token });
}

let busy = false;
async function processQueue() {
  if (busy) return; busy = true;
  try {
    for (const row of await db.q("SELECT * FROM notification_logs WHERE status='scheduled' AND send_at <= ? LIMIT 20", [db.nowIso()])) {
      const res = await sendReview(row);
      await db.run('UPDATE notification_logs SET status=?, wa_message_id=?, error=?, sent_at=? WHERE id=?',
        [res.ok ? (res.simulated ? 'simulated' : 'sent') : 'failed', res.id || null, res.error || null, db.nowIso(), row.id]);
    }
    // cancel online orders that were never paid (frees reserved stock)
    const cutoff = new Date(Date.now() - 45 * 60000).toISOString();
    const orders = require('./orders');
    for (const o of await db.q("SELECT id FROM orders WHERE status='awaiting_payment' AND created_at < ?", [cutoff])) {
      await orders.setStatus(o.id, 'cancelled', { note: 'Payment not completed', actor: 'system' }).catch(() => {});
    }
    // auto-cancel COD orders that were never confirmed (Admin > Settings > COD & RTO rules)
    const hours = settings.num('confirm_autocancel_hours');
    if (hours > 0) {
      const old = new Date(Date.now() - hours * 36e5).toISOString();
      for (const o of await db.q("SELECT id FROM orders WHERE status='pending_confirmation' AND created_at < ?", [old])) {
        await orders.setStatus(o.id, 'cancelled', { note: `Auto-cancelled: not confirmed within ${hours} hours`, actor: 'system' }).catch((e) => console.error('auto-cancel', o.id, e.message));
      }
    }
  } catch (e) { console.error('queue error', e.message); } finally { busy = false; }
}
async function housekeeping() {
  const cut = (d) => new Date(Date.now() - d * 864e5).toISOString();
  try {
    await db.run('DELETE FROM events WHERE at < ?', [cut(180)]);
    await db.run('DELETE FROM otp_codes WHERE created_at < ?', [Date.now() - 864e5]);
  } catch (e) { console.error('housekeeping error', e.message); }
}
function startScheduler() { setInterval(processQueue, 60000).unref(); setInterval(housekeeping, 864e5).unref(); housekeeping(); }

module.exports = { onConfirmed, onStatus, processQueue, startScheduler };
