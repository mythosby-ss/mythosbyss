const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../lib/db');
const cartLib = require('../lib/cart');
const coupons = require('../lib/coupons');
const rzp = require('../lib/razorpay');
const events = require('../lib/events');
const settings = require('../lib/settings');
const catalog = require('../lib/catalog');
const orders = require('../lib/orders');
const notify = require('../lib/notify');

const METHODS = { prepaid: 'Pay online (UPI / Card / NetBanking)', cod: 'Cash on delivery', partial_cod: 'Partial COD (pay a part now, rest on delivery)' };
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'];

const isBuyNow = (req) => req.query.mode === 'buynow' || (req.body && req.body.mode === 'buynow');
const activeLines = (req) => (isBuyNow(req) ? req.session.buyNow : req.session.cart) || [];
const needLogin = (req, res, next) => {
  if (res.locals.customer) return next();
  if (req.method === 'POST') return res.status(401).json({ ok: false, message: 'Please log in to continue.', login: '/login' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
};
async function couponFor(req, subtotal) {
  if (isBuyNow(req) || !req.session.coupon) return { discount: 0, code: null };
  const r = await coupons.validate(req.session.coupon, subtotal);
  return r.ok ? { discount: r.discount, code: r.code } : { discount: 0, code: null };
}

function validate(b) {
  const e = {}; const s = (v) => String(v || '').trim();
  if (s(b.name).length < 2) e.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(b.email))) e.email = 'Enter a valid email address.';
  if (s(b.line1).length < 5) e.line1 = 'Enter your house number and street.';
  if (s(b.city).length < 2) e.city = 'Enter your city.';
  if (s(b.state).length < 2) e.state = 'Select your state.';
  if (!/^[1-9]\d{5}$/.test(s(b.pincode))) e.pincode = 'Enter a valid 6-digit pincode.';
  return e;
}

router.get('/checkout', needLogin, async (req, res) => {
  const buyNow = isBuyNow(req);
  const cart = cartLib.hydrate(activeLines(req));
  if (!cart.items.length) return res.redirect('/cart');
  const { discount, code } = await couponFor(req, cart.subtotal);
  const pricing = Object.fromEntries(Object.keys(METHODS).map((m) => [m, cartLib.priceOrder(cart, m, discount)]));
  const full = await db.one('SELECT * FROM customers WHERE id=?', [res.locals.customer.id]);
  let saved = {}; try { saved = JSON.parse(full.last_address || '{}'); } catch (_) {}
  events.track(req, 'begin_checkout');
  res.render('checkout', {
    pageTitle: 'Checkout | MythosBySS', noindex: true, cart, pricing, methods: METHODS, buyNow, couponCode: code, discount,
    partialPercent: settings.num('partial_cod_percent'), codFee: settings.num('cod_fee'), onlineEnabled: rzp.enabled(), states: STATES, saved, profile: full
  });
});

router.post('/checkout/place', needLogin, limiter, async (req, res, next) => {
  const reserved = [];
  try {
    const b = req.body; const method = b.paymentMethod; const cust = res.locals.customer;
    if (!METHODS[method]) return res.status(422).json({ ok: false, message: 'Choose a payment method.' });
    const errors = validate(b);
    if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors, message: 'Please fix the highlighted fields.' });
    const cart = cartLib.hydrate(activeLines(req));
    if (!cart.items.length) return res.status(400).json({ ok: false, message: 'Your cart is empty.' });
    if (cart.hasSoldOut) return res.status(409).json({ ok: false, message: 'Some items just went out of stock. Please review your cart.' });

    const { discount, code } = await couponFor(req, cart.subtotal);
    const amounts = cartLib.priceOrder(cart, method, discount);
    if (amounts.payNow > 0 && !rzp.enabled()) return res.status(503).json({ ok: false, message: 'Online payment is not available right now. Please choose Cash on delivery.' });

    for (const i of cart.items) { // reserve stock atomically per line
      const r = await db.run('UPDATE variants SET stock = stock - ? WHERE sku=? AND stock >= ?', [i.qty, i.sku, i.qty]);
      if (!r.changes) { for (const x of reserved) await db.run('UPDATE variants SET stock = stock + ? WHERE sku=?', [x.qty, x.sku]); await catalog.refresh(); return res.status(409).json({ ok: false, message: `${i.product.name} (${i.variant.label}) is no longer available in that quantity.` }); }
      reserved.push(i);
    }

    const t = (v) => String(v || '').trim(); const now = db.nowIso(); const id = orders.newId(); const attr = req.session.attr || {};
    const online = amounts.payNow > 0;
    await db.run(`INSERT INTO orders(id,customer_id,status,payment_method,payment_status,subtotal,discount,coupon_code,shipping_fee,cod_fee,total,pay_now,due_on_delivery,
      name,email,phone,address,city,state,pincode,note,utm_source,utm_medium,utm_campaign,review_token,created_at,confirmed_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cust.id, online ? 'awaiting_payment' : 'confirmed', method, online ? 'pending' : 'cod_pending', amounts.subtotal, amounts.discount, code, amounts.shipping, amounts.codFee, amounts.total, amounts.payNow, amounts.dueOnDelivery,
        t(b.name), t(b.email).toLowerCase(), cust.phone, [t(b.line1), t(b.line2)].filter(Boolean).join(', '), t(b.city), t(b.state), t(b.pincode), t(b.note).slice(0, 300),
        attr.source || 'direct', attr.medium || '', attr.campaign || '', crypto.randomBytes(12).toString('hex'), now, online ? null : now, now]);
    await db.batch([
      ...cart.items.map((i) => ['INSERT INTO order_items(order_id,product_slug,product_name,sku,variant_label,qty,unit_price,cost_price) VALUES(?,?,?,?,?,?,?,?)', [id, i.slug, i.product.name, i.sku, i.variant.label, i.qty, i.unit, i.variant.cost]]),
      ['INSERT INTO order_events(order_id,status,note,actor,at) VALUES(?,?,?,?,?)', [id, online ? 'awaiting_payment' : 'confirmed', online ? 'Waiting for online payment' : 'Order placed', 'customer', now]],
      ['UPDATE customers SET name=?, email=?, last_address=? WHERE id=?', [t(b.name), t(b.email).toLowerCase(), JSON.stringify({ line1: t(b.line1), line2: t(b.line2), city: t(b.city), state: t(b.state), pincode: t(b.pincode) }), cust.id]]
    ].concat(code ? [['UPDATE coupons SET used = used + 1 WHERE code=?', [code]]] : []));
    await catalog.refresh();
    req.session.orders = [...(req.session.orders || []), id];

    if (!online) {
      clearActive(req); events.track(req, 'purchase');
      notify.onConfirmed(id).catch((e) => console.error(e.message));
      return res.json({ ok: true, redirect: `/order/${id}` });
    }
    try {
      const ro = await rzp.get().orders.create({ amount: Math.round(amounts.payNow * 100), currency: 'INR', receipt: id, notes: { orderId: id, method, due_on_delivery: String(amounts.dueOnDelivery) } });
      await db.run('UPDATE orders SET razorpay_order_id=? WHERE id=?', [ro.id, id]);
      res.json({ ok: true, orderId: id, key: process.env.RAZORPAY_KEY_ID, razorpayOrderId: ro.id, amount: ro.amount, currency: 'INR', name: 'MythosBySS',
        description: method === 'partial_cod' ? `Advance for order ${id}` : `Order ${id}`, prefill: { name: t(b.name), email: t(b.email), contact: cust.phone } });
    } catch (e) {
      await orders.setStatus(id, 'cancelled', { note: 'Could not start payment', actor: 'system' }).catch(() => {});
      throw e;
    }
  } catch (err) { next(err); }
});

router.post('/checkout/verify', needLogin, limiter, async (req, res, next) => {
  try {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body;
    const o = await db.one('SELECT * FROM orders WHERE razorpay_order_id=? AND customer_id=?', [oid, res.locals.customer.id]);
    if (!o) return res.status(404).json({ ok: false, message: 'Order not found.' });
    if (!orders.safeEqual(orders.hmac(process.env.RAZORPAY_KEY_SECRET || '', `${oid}|${pid}`), sig || '')) {
      await db.run("UPDATE orders SET payment_status='failed' WHERE id=? AND payment_status='pending'", [o.id]);
      return res.status(400).json({ ok: false, message: 'Payment could not be verified. If money was deducted, it will be refunded automatically.' });
    }
    await orders.markPaid(o, pid);
    req.session.buyNow = null; req.session.cart = [];
    events.track(req, 'purchase');
    res.json({ ok: true, redirect: `/order/${o.id}` });
  } catch (e) { next(e); }
});

function clearActive(req) { if (req.body.mode === 'buynow') req.session.buyNow = null; else { req.session.cart = []; req.session.coupon = null; } }

router.get('/order/:id', needLogin, async (req, res, next) => {
  const order = await orders.getOrder(req.params.id);
  if (!order || order.customer_id !== res.locals.customer.id) return next();
  res.render('order', { pageTitle: `Order ${order.id} | MythosBySS`, noindex: true, order, methods: orders.METHOD_LABEL, statusLabel: orders.STATUS_LABEL });
});

module.exports = router;
