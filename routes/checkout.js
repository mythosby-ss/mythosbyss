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
const stock = require('../lib/stock');
const capi = require('../lib/capi');

// Browser context for the Conversions API, captured now because Purchase may be sent later (on payment or confirmation)
function adContext(req) {
  const cookies = Object.fromEntries(String(req.get('cookie') || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  return { fbp: cookies._fbp || null, fbc: cookies._fbc || req.session.fbc || null, ip: req.ip || null, ua: String(req.get('user-agent') || '').slice(0, 400) || null };
}
const validate = require('../lib/validate');
const codrules = require('../lib/codrules');

const METHODS = { prepaid: 'Pay online (UPI / Card / NetBanking)', cod: 'Cash on delivery', partial_cod: 'Partial COD (pay a part now, rest on delivery)' };
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const STATES = validate.STATES;

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

router.get('/checkout', needLogin, async (req, res) => {
  const buyNow = isBuyNow(req);
  const cart = cartLib.hydrate(activeLines(req));
  if (!cart.items.length) return res.redirect('/cart');
  const { discount, code } = await couponFor(req, cart.net);
  const pricing = Object.fromEntries(Object.keys(METHODS).map((m) => [m, cartLib.priceOrder(cart, m, discount)]));
  const full = await db.one('SELECT * FROM customers WHERE id=?', [res.locals.customer.id]);
  let saved = {}; try { saved = JSON.parse(full.last_address || '{}'); } catch (_) {}
  if (!saved.landmark && saved.line2) saved.landmark = saved.line2; // addresses saved before the separate landmark field
  const options = await codrules.paymentOptions({ orderValue: cart.net - discount, pincode: saved.pincode, phone: full.phone });
  events.track(req, 'begin_checkout');
  res.render('checkout', {
    pageTitle: 'Checkout | MythosBySS', noindex: true, cart, pricing, methods: METHODS, buyNow, couponCode: code, discount,
    options: options.methods, selected: codrules.defaultMethod(options.methods), pincodeMessage: options.pincodeMessage,
    prepaidDiscount: cartLib.prepaidDiscount(), requireLandmark: settings.on('address_require_landmark'),
    codFee: settings.num('cod_fee'), onlineEnabled: rzp.enabled(), states: STATES, saved, profile: full
  });
});

router.post('/checkout/place', needLogin, limiter, async (req, res, next) => {
  try {
    const b = req.body; const method = b.paymentMethod; const cust = res.locals.customer;
    if (!METHODS[method]) return res.status(422).json({ ok: false, message: 'Choose a payment method.' });
    const errors = validate.address(b);
    if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors, message: 'Please fix the highlighted fields.' });
    const cart = cartLib.hydrate(activeLines(req));
    if (!cart.items.length) return res.status(400).json({ ok: false, message: 'Your cart is empty.' });
    if (cart.hasSoldOut) return res.status(409).json({ ok: false, message: 'Some items just went out of stock. Please review your cart.' });

    const { discount, code } = await couponFor(req, cart.net);
    // COD / RTO rules (pincode, order value, phone RTO history, blacklist) are always enforced here, not only in the browser
    const options = await codrules.paymentOptions({ orderValue: cart.net - discount, pincode: b.pincode, phone: cust.phone });
    if (!options.serviceable) return res.status(422).json({ ok: false, errors: { pincode: options.pincodeMessage }, message: options.pincodeMessage });
    if (!options.methods[method].ok) return res.status(422).json({ ok: false, message: options.methods[method].reason + ' Please choose another payment method.', options: options.methods });
    const amounts = cartLib.priceOrder(cart, method, discount);
    if (amounts.payNow > 0 && !rzp.enabled()) return res.status(503).json({ ok: false, message: 'Online payment is not available right now. Please try again later.' });

    // Reserve stock (bundles reserve their component SKUs). All-or-nothing.
    const lines = cart.items.map((i) => ({ sku: i.sku, qty: i.qty, components: i.variant.components }));
    const r = await stock.reserve(stock.needs(lines));
    if (!r.ok) {
      await catalog.refresh();
      const i = cart.items.find((x) => x.sku === r.sku || (x.variant.components || []).some((c) => c.sku === r.sku)) || cart.items[0];
      return res.status(409).json({ ok: false, message: `${i.product.name} (${i.variant.label}) is no longer available in that quantity.` });
    }

    const t = (v) => String(v || '').trim(); const now = db.nowIso(); const id = orders.newId(); const attr = req.session.attr || {};
    const online = amounts.payNow > 0;
    const ctx = adContext(req);
    // COD orders wait for a confirmation call/WhatsApp from the admin; prepaid & partial COD are confirmed once paid.
    const offlineStatus = method === 'cod' ? 'pending_confirmation' : 'confirmed';
    await db.run(`INSERT INTO orders(id,customer_id,status,payment_method,payment_status,subtotal,discount,prepaid_discount,offer_discount,fbp,fbc,client_ip,user_agent,coupon_code,shipping_fee,cod_fee,total,pay_now,due_on_delivery,
      name,email,phone,address,city,state,pincode,note,utm_source,utm_medium,utm_campaign,review_token,created_at,confirmed_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, cust.id, online ? 'awaiting_payment' : offlineStatus, method, online ? 'pending' : 'cod_pending', amounts.subtotal, amounts.discount + amounts.prepaidDiscount + amounts.offerDiscount, amounts.prepaidDiscount, amounts.offerDiscount, ctx.fbp, ctx.fbc, ctx.ip, ctx.ua, code, amounts.shipping, amounts.codFee, amounts.total, amounts.payNow, amounts.dueOnDelivery,
        t(b.name), t(b.email).toLowerCase(), cust.phone, fullAddress(b), t(b.city), t(b.state), t(b.pincode), t(b.note).slice(0, 300),
        attr.source || 'direct', attr.medium || '', attr.campaign || '', crypto.randomBytes(12).toString('hex'), now, !online && offlineStatus === 'confirmed' ? now : null, now]);
    await db.batch([
      ...cart.items.map((i) => ['INSERT INTO order_items(order_id,product_slug,product_name,sku,variant_label,qty,unit_price,cost_price,components) VALUES(?,?,?,?,?,?,?,?,?)',
        [id, i.slug, i.product.name, i.sku, i.variant.label, i.qty, i.unit, i.variant.cost, i.variant.components ? JSON.stringify(i.variant.components.map((c) => ({ sku: c.sku, qty: c.qty, name: c.name, label: c.label }))) : null]]),
      ['INSERT INTO order_events(order_id,status,note,actor,at) VALUES(?,?,?,?,?)', [id, online ? 'awaiting_payment' : offlineStatus, online ? 'Waiting for online payment' : offlineStatus === 'pending_confirmation' ? 'Order placed (cash on delivery) - waiting for confirmation' : 'Order placed', 'customer', now]],
      ['UPDATE customers SET name=?, email=?, last_address=? WHERE id=?', [t(b.name), t(b.email).toLowerCase(), JSON.stringify({ house: t(b.house), line1: t(b.line1), landmark: t(b.landmark), city: t(b.city), state: t(b.state), pincode: t(b.pincode) }), cust.id]]
    ].concat(code ? [['UPDATE coupons SET used = used + 1 WHERE code=?', [code]]] : []));
    await catalog.refresh();
    req.session.orders = [...(req.session.orders || []), id];

    if (!online) {
      clearActive(req); events.track(req, 'purchase'); // first-party funnel step "order placed" (not sent to Meta)
      // COD: confirmation message + conversion events are sent when the admin confirms the order (lib/notify onStatus)
      if (offlineStatus === 'confirmed') notify.onConfirmed(id).catch((e) => console.error(e.message));
      else if (capi.metaReady()) orders.getOrder(id).then((o) => capi.codPlaced(o)).catch((e) => console.error('[capi] COD_Placed', e.message)); // not a Purchase
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

// Re-check payment options when the customer types a pincode at checkout (rules are enforced again on /checkout/place)
router.get('/checkout/options', needLogin, async (req, res, next) => {
  try {
    const cart = cartLib.hydrate(activeLines(req));
    const { discount } = await couponFor(req, cart.net);
    const o = await codrules.paymentOptions({ orderValue: cart.net - discount, pincode: String(req.query.pincode || ''), phone: res.locals.customer.phone });
    res.json({ ok: true, serviceable: o.serviceable, pincodeMessage: o.pincodeMessage, methods: o.methods, selected: codrules.defaultMethod(o.methods) });
  } catch (e) { next(e); }
});

const fullAddress = (b) => { const t = (v) => String(v || '').trim(); return [t(b.house), t(b.line1), t(b.landmark) && 'Landmark: ' + t(b.landmark)].filter(Boolean).join(', '); };

function clearActive(req) { if (req.body.mode === 'buynow') req.session.buyNow = null; else { req.session.cart = []; req.session.coupon = null; } }

router.get('/order/:id', needLogin, async (req, res, next) => {
  const order = await orders.getOrder(req.params.id);
  if (!order || order.customer_id !== res.locals.customer.id) return next();
  res.render('order', { pageTitle: `Order ${order.id} | MythosBySS`, noindex: true, order, methods: orders.METHOD_LABEL, statusLabel: orders.STATUS_LABEL });
});

module.exports = router;
