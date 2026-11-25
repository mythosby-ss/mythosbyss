const crypto = require('crypto');
const db = require('./db');
const catalog = require('./catalog');

const STATUS_LABEL = { awaiting_payment: 'Awaiting payment', pending_confirmation: 'Awaiting confirmation', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', out_for_delivery: 'Out for delivery', ndr: 'Delivery attempted (NDR)', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned (RTO)' };
const FLOW = {
  awaiting_payment: ['confirmed', 'cancelled'], pending_confirmation: ['confirmed', 'cancelled'], confirmed: ['packed', 'shipped', 'cancelled'], packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'ndr', 'delivered', 'rto', 'cancelled'], out_for_delivery: ['delivered', 'ndr', 'rto'],
  ndr: ['shipped', 'out_for_delivery', 'delivered', 'rto'], // NDR = failed delivery attempt; "shipped" = re-attempt requested
  delivered: [], cancelled: [], rto: []
};
const METHOD_LABEL = { prepaid: 'Prepaid (online)', cod: 'Cash on delivery', partial_cod: 'Partial COD' };

const newId = () => 'MB' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

async function getOrder(id) {
  const order = await db.one('SELECT * FROM orders WHERE id=?', [id]);
  if (!order) return null;
  order.items = await db.q('SELECT * FROM order_items WHERE order_id=?', [id]);
  order.events = await db.q('SELECT * FROM order_events WHERE order_id=? ORDER BY id', [id]);
  order.refunds = await db.q('SELECT * FROM refunds WHERE order_id=? ORDER BY id', [id]);
  order.refunded = order.refunds.reduce((s, r) => s + r.amount, 0);
  return order;
}

const addEvent = (orderId, status, note, actor) =>
  db.run('INSERT INTO order_events(order_id,status,note,actor,at) VALUES(?,?,?,?,?)', [orderId, status, note || null, actor || 'system', db.nowIso()]);

async function restoreStock(orderId) {
  const lines = (await db.q('SELECT sku, qty, components FROM order_items WHERE order_id=?', [orderId]))
    .map((it) => ({ sku: it.sku, qty: it.qty, components: it.components ? JSON.parse(it.components) : null })); // bundles: put components back
  await require('./stock').release(require('./stock').needs(lines));
  await catalog.refresh();
}

/** Move an order to a new status, with validation, timestamps, stock restore and WhatsApp notifications. */
async function setStatus(id, status, { note, actor = 'admin', extra = {} } = {}) {
  const o = await db.one('SELECT * FROM orders WHERE id=?', [id]);
  if (!o) throw new Error('Order not found');
  if (o.status === status) return o;
  if (!(FLOW[o.status] || []).includes(status)) throw new Error(`Cannot move an order from "${STATUS_LABEL[o.status]}" to "${STATUS_LABEL[status]}".`);
  const now = db.nowIso();
  const sets = ['status=?', 'updated_at=?']; const args = [status, now];
  const ts = { confirmed: 'confirmed_at', shipped: 'shipped_at', delivered: 'delivered_at', cancelled: 'cancelled_at', rto: 'cancelled_at' }[status];
  if (ts) { sets.push(`${ts}=?`); args.push(now); }
  if (status === 'delivered') {
    sets.push('payment_status=?'); args.push(o.payment_method === 'prepaid' ? 'paid' : o.payment_method === 'partial_cod' ? 'paid' : 'cod_collected');
  }
  if (status === 'ndr') { sets.push('ndr_count=COALESCE(ndr_count,0)+1', 'ndr_at=?', 'ndr_reason=?'); args.push(now, note || 'Delivery attempted'); }
  if (status === 'cancelled' || status === 'rto') { sets.push('cancel_reason=?'); args.push(note || (status === 'rto' ? 'Returned to origin' : 'Cancelled')); }
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k}=?`); args.push(v); }
  args.push(id);
  await db.run(`UPDATE orders SET ${sets.join(', ')} WHERE id=?`, args);
  await addEvent(id, status, note, actor);
  if (status === 'cancelled' || status === 'rto') {
    await restoreStock(id);
    // log for the ad exclusion audience (Admin > Settings > Marketing & tracking > export)
    const kind = status === 'rto' ? 'rto' : o.status === 'pending_confirmation' ? 'cod_cancelled' : o.status === 'awaiting_payment' ? 'unpaid' : 'cancelled';
    await db.run('INSERT OR REPLACE INTO ad_exclusions(order_id, kind, at) VALUES(?,?,?)', [id, kind, now]);
  }
  require('./notify').onStatus(id, status).catch((e) => console.error('notify error', e.message));
  return getOrder(id);
}

/** Called when Razorpay confirms payment (verify endpoint or webhook). Idempotent. */
async function markPaid(order, paymentId) {
  if (['paid', 'advance_paid'].includes(order.payment_status)) return;
  const full = order.payment_method === 'prepaid';
  await db.run('UPDATE orders SET payment_status=?, razorpay_payment_id=?, status=CASE WHEN status=\'awaiting_payment\' THEN \'confirmed\' ELSE status END, confirmed_at=?, updated_at=? WHERE id=?',
    [full ? 'paid' : 'advance_paid', paymentId, db.nowIso(), db.nowIso(), order.id]);
  await addEvent(order.id, 'confirmed', `Online payment received (${paymentId})`, 'razorpay');
  require('./notify').onConfirmed(order.id).catch((e) => console.error('notify error', e.message));
}

/** Click-to-chat link (wa.me, no API needed) with a message template filled in. kind: 'confirm' | 'ndr' */
function confirmWhatsAppLink(o, kind = 'confirm') {
  const settings = require('./settings');
  const money = (n) => '\u20B9' + Number(n || 0).toLocaleString('en-IN');
  const vars = {
    name: String(o.name || '').split(' ')[0], order_id: o.id, store: settings.get('store_name'), total: money(o.total), due: money(o.due_on_delivery),
    items: (o.items || []).map((i) => `${i.product_name} (${i.variant_label}) x${i.qty}`).join(', '),
    address: [o.address, o.city, o.state, o.pincode].filter(Boolean).join(', '), hours: settings.get('confirm_autocancel_hours'),
    courier: o.courier || 'our courier', awb: o.awb || ''
  };
  const text = String(settings.get(kind === 'ndr' ? 'ndr_message' : 'confirm_message') || '').replace(/\\n/g, '\n').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return `https://wa.me/91${String(o.phone || '').replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`;
}

module.exports = { confirmWhatsAppLink, STATUS_LABEL, FLOW, METHOD_LABEL, newId, safeEqual, hmac, getOrder, addEvent, setStatus, markPaid, restoreStock };
