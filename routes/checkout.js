const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const cartLib = require('../lib/cart');
const store = require('../lib/store');
const rzp = require('../lib/razorpay');
const { newId, markPaid, safeEqual, hmac } = require('../lib/orders');

const METHODS = {
  prepaid: 'Pay online (UPI / Card / NetBanking)',
  cod: 'Cash on delivery',
  partial_cod: 'Partial COD (pay a part now, rest on delivery)'
};
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });

const isBuyNow = (req) => req.query.mode === 'buynow' || req.body.mode === 'buynow';
const activeLines = (req) => (isBuyNow(req) ? req.session.buyNow : req.session.cart) || [];

function validate(b) {
  const e = {};
  const s = (v) => String(v || '').trim();
  if (s(b.name).length < 2) e.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(b.email))) e.email = 'Enter a valid email address.';
  if (!/^[6-9]\d{9}$/.test(s(b.phone))) e.phone = 'Enter a valid 10-digit mobile number.';
  if (s(b.line1).length < 5) e.line1 = 'Enter your house number and street.';
  if (s(b.city).length < 2) e.city = 'Enter your city.';
  if (s(b.state).length < 2) e.state = 'Select your state.';
  if (!/^[1-9]\d{5}$/.test(s(b.pincode))) e.pincode = 'Enter a valid 6-digit pincode.';
  return e;
}

router.get('/checkout', (req, res) => {
  const buyNow = isBuyNow(req);
  const cart = cartLib.hydrate(activeLines(req));
  if (!cart.items.length) return res.redirect('/cart');
  const pricing = Object.fromEntries(Object.keys(METHODS).map((m) => [m, cartLib.priceOrder(cart, m)]));
  res.render('checkout', {
    pageTitle: 'Checkout | MythosBySS', cart, pricing, methods: METHODS, buyNow,
    partialPercent: cartLib.PARTIAL_PERCENT(), codFee: cartLib.COD_FEE(), onlineEnabled: rzp.enabled(),
    rzpKey: process.env.RAZORPAY_KEY_ID || '', states: STATES
  });
});

router.post('/checkout/place', limiter, async (req, res, next) => {
  try {
    const b = req.body;
    const method = b.paymentMethod;
    if (!METHODS[method]) return res.status(422).json({ ok: false, message: 'Choose a payment method.' });
    const errors = validate(b);
    if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors, message: 'Please fix the highlighted fields.' });

    const cart = cartLib.hydrate(activeLines(req));
    if (!cart.items.length) return res.status(400).json({ ok: false, message: 'Your cart is empty.' });

    const amounts = cartLib.priceOrder(cart, method);
    if (amounts.payNow > 0 && !rzp.enabled()) return res.status(503).json({ ok: false, message: 'Online payment is not available right now. Please choose Cash on delivery.' });

    const t = (v) => String(v || '').trim();
    const order = {
      id: newId(), createdAt: new Date().toISOString(),
      status: amounts.payNow > 0 ? 'awaiting_payment' : 'confirmed',
      paymentMethod: method, amounts,
      customer: { name: t(b.name), email: t(b.email).toLowerCase(), phone: t(b.phone) },
      address: { line1: t(b.line1), line2: t(b.line2), city: t(b.city), state: t(b.state), pincode: t(b.pincode) },
      note: t(b.note).slice(0, 300),
      items: cart.items.map((i) => ({ slug: i.slug, name: i.product.name, sku: i.sku, variant: i.variant.label, qty: i.qty, unit: i.unit, total: i.total })),
      payment: { status: amounts.payNow > 0 ? 'pending' : 'cod_pending' }
    };

    let rzpOrder = null;
    if (amounts.payNow > 0) {
      rzpOrder = await rzp.get().orders.create({
        amount: Math.round(amounts.payNow * 100), currency: 'INR', receipt: order.id,
        notes: { orderId: order.id, method, due_on_delivery: String(amounts.dueOnDelivery) }
      });
      order.payment.razorpayOrderId = rzpOrder.id;
    }
    store.create(order);
    req.session.orders = [...(req.session.orders || []), order.id];

    if (!rzpOrder) { // plain COD
      clearActive(req);
      return res.json({ ok: true, redirect: `/order/${order.id}` });
    }
    res.json({
      ok: true, orderId: order.id, key: process.env.RAZORPAY_KEY_ID, razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount, currency: 'INR', name: 'MythosBySS',
      description: method === 'partial_cod' ? `Advance for order ${order.id}` : `Order ${order.id}`,
      prefill: { name: order.customer.name, email: order.customer.email, contact: order.customer.phone }
    });
  } catch (err) { next(err); }
});

router.post('/checkout/verify', limiter, (req, res) => {
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
  const order = store.all().find((o) => o.payment && o.payment.razorpayOrderId === oid);
  if (!order || !(req.session.orders || []).includes(order.id)) return res.status(404).json({ ok: false, message: 'Order not found.' });
  const expected = hmac(process.env.RAZORPAY_KEY_SECRET || '', `${oid}|${pid}`);
  if (!safeEqual(expected, sig || '')) {
    store.update(order.id, { payment: { ...order.payment, status: 'failed' } });
    return res.status(400).json({ ok: false, message: 'Payment could not be verified. If money was deducted, it will be refunded automatically.' });
  }
  markPaid(order, pid);
  clearActive(req, true);
  res.json({ ok: true, redirect: `/order/${order.id}` });
});

function clearActive(req, both) {
  if (both || req.body.mode === 'buynow') req.session.buyNow = null;
  if (both || req.body.mode !== 'buynow') req.session.cart = [];
}

router.get('/order/:id', (req, res, next) => {
  const order = store.find(req.params.id);
  if (!order) return next();
  if (!(req.session.orders || []).includes(order.id)) return res.redirect('/track');
  res.render('order', { pageTitle: `Order ${order.id} | MythosBySS`, order, methods: METHODS });
});

router.get('/track', (req, res) => res.render('track', { pageTitle: 'Track your order | MythosBySS', error: null }));
router.post('/track', limiter, (req, res) => {
  const order = store.find(String(req.body.orderId || '').trim().toUpperCase());
  const phone = String(req.body.phone || '').trim();
  if (!order || order.customer.phone !== phone) return res.status(404).render('track', { pageTitle: 'Track your order | MythosBySS', error: 'We could not find an order with that ID and phone number.' });
  req.session.orders = [...new Set([...(req.session.orders || []), order.id])];
  res.redirect(`/order/${order.id}`);
});

const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'];

module.exports = router;
