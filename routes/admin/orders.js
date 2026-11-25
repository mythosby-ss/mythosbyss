const router = require('express').Router();
const db = require('../../lib/db');
const orders = require('../../lib/orders');
const rzp = require('../../lib/razorpay');
const catalog = require('../../lib/catalog');
const shipping = require('../../lib/shipping');
const settings = require('../../lib/settings');

// Customer answers to record when a delivery failed (NDR). "Courier never came" is your escalation proof.
const NDR_REPLIES = ['Courier never came / no call received', 'Customer was not available - wants re-delivery', 'Customer gave a new delivery date/time',
  'Address or phone problem - corrected', 'Customer refused / does not want the order', 'Customer not reachable', 'Other'];
const couriers = () => String(settings.get('courier_names') || '').split(',').map((c) => c.trim()).filter(Boolean);

const TABS = {
  confirm: { label: 'Needs confirmation', sql: "status='pending_confirmation'" },
  ndr: { label: 'NDR - action needed', sql: "status='ndr'" },
  pending: { label: 'Non-dispatched', sql: "status IN ('confirmed','packed')" },
  shipped: { label: 'In transit', sql: "status IN ('shipped','out_for_delivery')" },
  delivered: { label: 'Delivered', sql: "status='delivered'" },
  cancelled: { label: 'Cancelled / RTO', sql: "status IN ('cancelled','rto')" },
  payment: { label: 'Payment pending', sql: "status='awaiting_payment'" },
  all: { label: 'All', sql: '1=1' }
};
const PAGE = 25;

router.get('/', async (req, res, next) => {
  try {
    const counts = {};
    for (const [k, v] of Object.entries(TABS)) counts[k] = await db.val(`SELECT COUNT(*) FROM orders WHERE ${v.sql}`);
    const tab = TABS[req.query.tab] ? req.query.tab : counts.confirm ? 'confirm' : 'pending'; // unconfirmed COD orders come first
    const where = [TABS[tab].sql]; const args = [];
    const q = String(req.query.q || '').trim();
    if (q) { where.push('(id LIKE ? OR phone LIKE ? OR name LIKE ? OR awb LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
    if (['cod', 'prepaid', 'partial_cod'].includes(req.query.method)) { where.push('payment_method=?'); args.push(req.query.method); }
    const total = await db.val(`SELECT COUNT(*) FROM orders WHERE ${where.join(' AND ')}`, args);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const list = await db.q(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args);
    for (const o of list) { o.items = await db.q('SELECT * FROM order_items WHERE order_id=?', [o.id]); o.thumb = (catalog.allBySlug(o.items[0] && o.items[0].product_slug) || {}).image; }
    if (tab === 'confirm') { // help decide: past orders / RTOs of this phone, and how often we already messaged
      for (const o of list) {
        o.history = await db.one("SELECT COUNT(*) orders, SUM(status='rto') rto, SUM(status='delivered') delivered FROM orders WHERE phone=? AND id<>?", [o.phone, o.id]);
        o.waTries = await db.val("SELECT COUNT(*) FROM order_events WHERE order_id=? AND note LIKE 'Confirmation WhatsApp opened%'", [o.id]);
        o.waLink = `/admin/orders/${o.id}/whatsapp-confirm`;
      }
    }
    if (tab === 'ndr') { // failed deliveries: last customer reply + how often we messaged
      for (const o of list) {
        o.lastReply = await db.one('SELECT * FROM ndr_notes WHERE order_id=? ORDER BY id DESC LIMIT 1', [o.id]);
        o.waTries = await db.val("SELECT COUNT(*) FROM order_events WHERE order_id=? AND note LIKE 'NDR WhatsApp opened%'", [o.id]);
      }
    }
    const autoCancelHours = settings.num('confirm_autocancel_hours');
    const summary = { nonDispatched: counts.pending, packed: await db.val("SELECT COUNT(*) FROM orders WHERE status='packed'"), inTransit: counts.shipped,
      delayed: await db.val("SELECT COUNT(*) FROM orders WHERE status IN ('confirmed','packed') AND created_at < ?", [new Date(Date.now() - 48 * 36e5).toISOString()]) };
    res.render('admin/orders', { title: 'Process Orders', autoCancelHours, ndrReplies: NDR_REPLIES, tab, tabs: TABS, counts, list, q, method: req.query.method || '', summary, page, pages: Math.ceil(total / PAGE), total, statusLabel: orders.STATUS_LABEL, methodLabel: orders.METHOD_LABEL });
  } catch (e) { next(e); }
});

router.post('/bulk', async (req, res) => {
  const ids = [].concat(req.body.ids || []); let ok = 0;
  for (const id of ids) { try { await orders.setStatus(id, 'packed', { actor: 'admin' }); ok++; } catch (_) {} }
  res.flash(`${ok} order(s) marked as packed.`); res.redirect(req.get('referer') || '/admin/orders');
});

router.get('/:id', async (req, res, next) => {
  try {
    const o = await orders.getOrder(req.params.id); if (!o) return next();
    o.logs = await db.q('SELECT * FROM notification_logs WHERE order_id=? ORDER BY id DESC', [o.id]);
    o.risk = await require('../../lib/codrules').phoneRisk(o.phone);
    o.ndrNotes = await db.q('SELECT * FROM ndr_notes WHERE order_id=? ORDER BY id DESC', [o.id]);
    const ship = shipping.get();
    res.locals.shipInfo = { provider: ship.label, couriers: couriers(), ndrReplies: NDR_REPLIES };
    res.render('admin/order-detail', { title: `Order ${o.id}`, o, statusLabel: orders.STATUS_LABEL, methodLabel: orders.METHOD_LABEL, next: orders.FLOW[o.status], rzpOn: rzp.enabled() });
  } catch (e) { next(e); }
});

// Printable shipping label and GST tax invoice (HTML, print with the browser; 4x6 label, A4 invoice).
async function printData(id) {
  const settings = require('../../lib/settings');
  const o = await orders.getOrder(id);
  if (!o) return null;
  const s = settings.all();
  const codes = {}; catalog.all.forEach((p) => p.variants.forEach((v) => { codes[v.sku] = v.code; }));
  o.items.forEach((i) => { i.code = codes[i.sku] || ''; });
  o.prevOrders = o.customer_id ? await db.val("SELECT COUNT(*) FROM orders WHERE customer_id=? AND id<>? AND status NOT IN ('awaiting_payment','cancelled')", [o.customer_id, o.id]) : 0;
  const inv = require('../../lib/gst').invoice(o, { rate: settings.num('gst_percent'), homeState: s.biz_state || s.home_state });
  return { o, s, inv, invoiceNo: (s.invoice_prefix || 'MBSS-') + o.id, invoiceDate: o.confirmed_at || o.created_at, logo: s.label_logo ? catalog.imgUrl(s.label_logo) : null };
}
router.get('/:id/label', async (req, res, next) => {
  try {
    const d = await printData(req.params.id); if (!d) return next();
    res.render('admin/print', { ...d, docs: d.s.label_type === 'with_invoice' ? ['label', 'invoice'] : ['label'] });
  } catch (e) { next(e); }
});
router.get('/:id/invoice', async (req, res, next) => {
  try { const d = await printData(req.params.id); if (!d) return next(); res.render('admin/print', { ...d, docs: ['invoice'] }); } catch (e) { next(e); }
});

// Failed delivery: open WhatsApp with the NDR message ("Did our courier visit you today?") and log it
router.get('/:id/whatsapp-ndr', async (req, res, next) => {
  try {
    const o = await orders.getOrder(req.params.id); if (!o) return next();
    await orders.addEvent(o.id, null, 'NDR WhatsApp opened by admin', 'admin');
    res.redirect(orders.confirmWhatsAppLink(o, 'ndr'));
  } catch (e) { next(e); }
});

// Record the customer's answer for a failed delivery (kept with the courier name + attempt number, for escalations)
router.post('/:id/ndr-note', async (req, res) => {
  const { id } = req.params;
  try {
    const o = await db.one('SELECT id, courier, ndr_count FROM orders WHERE id=?', [id]); if (!o) throw new Error('Order not found');
    const reply = NDR_REPLIES.includes(req.body.reply) ? req.body.reply : 'Other';
    const detail = String(req.body.detail || '').trim().slice(0, 300);
    if (reply === 'Other' && !detail) throw new Error('Write what the customer said.');
    await db.run('INSERT INTO ndr_notes(order_id,attempt,courier,reply,detail,actor,at) VALUES(?,?,?,?,?,?,?)', [id, o.ndr_count || 0, o.courier || '', reply, detail, 'admin', db.nowIso()]);
    await orders.addEvent(id, null, `NDR customer reply: ${reply}${detail ? ' - ' + detail : ''}`, 'admin');
    res.flash('Customer reply saved.');
  } catch (e) { res.flash(e.message, 'err'); }
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/admin/orders') && !back.startsWith('//') ? back : `/admin/orders/${id}`);
});

// Opens WhatsApp (wa.me) with the confirmation message, and records the attempt in the order timeline
router.get('/:id/whatsapp-confirm', async (req, res, next) => {
  try {
    const o = await orders.getOrder(req.params.id); if (!o) return next();
    await orders.addEvent(o.id, null, 'Confirmation WhatsApp opened by admin', 'admin');
    res.redirect(orders.confirmWhatsAppLink(o));
  } catch (e) { next(e); }
});

router.post('/:id/status', async (req, res) => {
  const { id } = req.params; const b = req.body;
  try {
    const extra = {};
    const current = await orders.getOrder(id); if (!current) throw new Error('Order not found');
    const ship = shipping.get();
    if (b.status === 'shipped' && current.status !== 'ndr') { // first dispatch: book / record the shipment through the shipping adapter
      const r = await ship.createShipment(current, { courier: b.courier, awb: b.awb });
      if (!r.ok) throw new Error(r.error);
      Object.assign(extra, { courier: r.courier, awb: r.awb, courier_charge: Number(b.courier_charge) || 0 });
    }
    if (b.status === 'cancelled' && current.awb) { // cancel the booked shipment too
      const r = await ship.cancelShipment(current);
      await orders.addEvent(id, null, r.ok ? r.note : `Shipment cancel failed: ${r.error}`, 'shipping');
    }
    await orders.setStatus(id, b.status, { note: String(b.note || '').slice(0, 200) || undefined, actor: 'admin', extra });
    res.flash(`Order ${id} moved to "${orders.STATUS_LABEL[b.status]}".`);
  } catch (e) { res.flash(e.message, 'err'); }
  const back = String(b.back || ''); // one-click buttons on the order list return to the list
  res.redirect(back.startsWith('/admin/orders') && !back.startsWith('//') ? back : `/admin/orders/${id}`);
});

router.post('/:id/logistics', async (req, res) => {
  const b = req.body;
  await db.run('UPDATE orders SET courier=?, awb=?, courier_charge=?, updated_at=? WHERE id=?', [String(b.courier || '').trim(), String(b.awb || '').trim(), Number(b.courier_charge) || 0, db.nowIso(), req.params.id]);
  await orders.addEvent(req.params.id, null, `Logistics updated: ${b.courier || '-'} / ${b.awb || '-'}`, 'admin');
  res.flash('Logistics saved.'); res.redirect(`/admin/orders/${req.params.id}`);
});

router.post('/:id/refund', async (req, res) => {
  const { id } = req.params;
  try {
    const o = await orders.getOrder(id); if (!o) throw new Error('Order not found');
    const amount = Math.round(Number(req.body.amount) * 100) / 100;
    const paid = ['paid', 'advance_paid'].includes(o.payment_status) || o.status === 'delivered' ? o.total - (o.payment_method === 'prepaid' ? 0 : 0) : 0;
    if (!(amount > 0) || amount > o.total - o.refunded) throw new Error(`Refund must be between ₹1 and ₹${o.total - o.refunded}.`);
    let rid = null; const method = req.body.method === 'razorpay' ? 'razorpay' : 'manual';
    if (method === 'razorpay') {
      if (!rzp.enabled() || !o.razorpay_payment_id) throw new Error('This order has no online payment to refund through Razorpay.');
      if (amount > o.pay_now - o.refunded) throw new Error(`Only ₹${o.pay_now - o.refunded} was collected online and is refundable via Razorpay.`);
      const r = await rzp.get().payments.refund(o.razorpay_payment_id, { amount: Math.round(amount * 100), notes: { orderId: id, reason: String(req.body.reason || '').slice(0, 100) } });
      rid = r.id;
    }
    await db.run('INSERT INTO refunds(order_id,amount,reason,method,razorpay_refund_id,status,created_at) VALUES(?,?,?,?,?,?,?)', [id, amount, String(req.body.reason || '').slice(0, 200), method, rid, 'processed', db.nowIso()]);
    const total = o.refunded + amount;
    await db.run('UPDATE orders SET payment_status=?, updated_at=? WHERE id=?', [total >= o.total ? 'refunded' : 'partially_refunded', db.nowIso(), id]);
    await orders.addEvent(id, null, `Refund of ₹${amount} (${method})`, 'admin');
    res.flash(`Refund of ₹${amount} recorded.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect(`/admin/orders/${id}`);
});

module.exports = router;
