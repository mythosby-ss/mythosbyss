// Razorpay webhook: safety net if the customer closes the tab after paying.
// Dashboard -> Settings -> Webhooks -> URL: {SITE_URL}/webhooks/razorpay, events: payment.captured, order.paid
const store = require('../lib/store');
const { markPaid, safeEqual, hmac } = require('../lib/orders');

module.exports = (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).end();
  const sig = req.get('x-razorpay-signature') || '';
  if (!safeEqual(hmac(secret, req.body), sig)) return res.status(400).end();
  try {
    const evt = JSON.parse(req.body.toString('utf8'));
    const pay = evt.payload && evt.payload.payment && evt.payload.payment.entity;
    if (pay && ['payment.captured', 'order.paid'].includes(evt.event)) {
      const order = store.all().find((o) => o.payment && o.payment.razorpayOrderId === pay.order_id);
      if (order) markPaid(order, pay.id);
    }
  } catch (e) { console.error('webhook error', e.message); }
  res.json({ ok: true });
};
