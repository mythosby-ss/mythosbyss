const db = require('../lib/db');
const orders = require('../lib/orders');
const { safeEqual, hmac } = orders;

// Razorpay: safety net if the customer closes the tab after paying. Events: payment.captured, order.paid
exports.razorpay = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end();
  if (!safeEqual(hmac(secret, req.body), req.get('x-razorpay-signature') || '')) return res.status(400).end();
  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    const pay = evt.payload && evt.payload.payment && evt.payload.payment.entity;
    if (pay && ['payment.captured', 'order.paid'].includes(evt.event)) {
      const o = await db.one('SELECT * FROM orders WHERE razorpay_order_id=?', [pay.order_id]);
      if (o) await orders.markPaid(o, pay.id);
    }
  } catch (e) { console.error('razorpay webhook', e.message); }
  res.json({ ok: true });
};

// WhatsApp Cloud API: verification handshake + delivery receipts (sent/delivered/read/failed)
exports.whatsappVerify = (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.status(403).end();
};
exports.whatsappEvents = async (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = (req.get('x-hub-signature-256') || '').replace('sha256=', '');
    if (!safeEqual(hmac(secret, req.body), sig)) return res.status(400).end();
  }
  try {
    const body = JSON.parse(req.body.toString('utf8'));
    for (const e of body.entry || []) for (const ch of e.changes || []) for (const s of (ch.value && ch.value.statuses) || []) {
      const err = s.errors && s.errors[0] ? s.errors[0].title : null;
      await db.run('UPDATE notification_logs SET status=?, error=COALESCE(?, error) WHERE wa_message_id=?', [s.status, err, s.id]);
    }
  } catch (e) { console.error('wa webhook', e.message); }
  res.json({ ok: true });
};

// Generic courier status webhook (Shiprocket / Delhivery via middleware). POST {order_id, status, awb?} + header x-webhook-secret
exports.shipping = async (req, res) => {
  if (!process.env.SHIPPING_WEBHOOK_SECRET || !safeEqual(req.get('x-webhook-secret') || '', process.env.SHIPPING_WEBHOOK_SECRET)) return res.status(401).end();
  const map = { shipped: 'shipped', in_transit: 'shipped', out_for_delivery: 'out_for_delivery', delivered: 'delivered', rto: 'rto', returned: 'rto' };
  const status = map[String(req.body.status || '').toLowerCase()];
  if (!status) return res.status(400).json({ ok: false, message: 'Unknown status' });
  try {
    const extra = req.body.awb ? { awb: String(req.body.awb) } : {};
    await orders.setStatus(String(req.body.order_id), status, { actor: 'courier', note: req.body.note, extra });
    res.json({ ok: true });
  } catch (e) { res.status(409).json({ ok: false, message: e.message }); }
};
