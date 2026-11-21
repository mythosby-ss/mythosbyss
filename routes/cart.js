const router = require('express').Router();
const cartLib = require('../lib/cart');
const coupons = require('../lib/coupons');
const events = require('../lib/events');

const wantsJson = (req) => req.is('json') || req.accepts(['html', 'json']) === 'json';
const back = (req, res, fb = '/cart') => res.redirect(req.get('referer') || fb);
const MSG = { notfound: 'Product not found', soldout: 'Sorry, this size is out of stock' };

router.get('/', async (req, res) => {
  const cart = cartLib.hydrate(req.session.cart);
  let coupon = null;
  if (req.session.coupon) { coupon = await coupons.validate(req.session.coupon, cart.subtotal); if (!coupon.ok) { req.session.couponMsg = coupon.message; req.session.coupon = null; coupon = null; } }
  const msg = req.session.couponMsg; req.session.couponMsg = null;
  res.render('cart', { pageTitle: 'Your cart | MythosBySS', noindex: true, cart, coupon, couponMsg: msg, maxQty: cartLib.MAX_QTY });
});

router.post('/add', (req, res) => {
  const { slug, qty } = req.body; const sku = req.body.variant || req.body.sku;
  req.session.cart = req.session.cart || [];
  const r = cartLib.addLine(req.session.cart, slug, sku, parseInt(qty, 10) || 1);
  const cart = cartLib.hydrate(req.session.cart);
  if (r === 'ok') events.track(req, 'add_to_cart', { product: slug });
  if (wantsJson(req)) return res.status(r === 'ok' ? 200 : 400).json({ ok: r === 'ok', count: cart.count, subtotal: cart.subtotal, message: r === 'ok' ? 'Added to cart' : MSG[r] });
  return r === 'ok' ? res.redirect('/cart') : back(req, res);
});

router.post('/buy-now', (req, res) => {
  const { slug, qty } = req.body; const sku = req.body.variant || req.body.sku;
  const lines = [];
  const r = cartLib.addLine(lines, slug, sku, parseInt(qty, 10) || 1);
  if (r !== 'ok') return wantsJson(req) ? res.status(400).json({ ok: false, message: MSG[r] }) : back(req, res, '/');
  req.session.buyNow = lines;
  events.track(req, 'add_to_cart', { product: slug });
  res.redirect('/checkout?mode=buynow');
});

router.post('/update', (req, res) => {
  const qty = parseInt(req.body.qty, 10); const cart = req.session.cart || [];
  const line = cart.find((l) => l.sku === req.body.sku);
  if (line) { if (!qty || qty < 1) cart.splice(cart.indexOf(line), 1); else line.qty = cartLib.clampQty(qty); }
  res.redirect('/cart');
});
router.post('/remove', (req, res) => { req.session.cart = (req.session.cart || []).filter((l) => l.sku !== req.body.sku); res.redirect('/cart'); });

router.post('/coupon', async (req, res) => {
  if (req.body.remove) { req.session.coupon = null; return res.redirect('/cart'); }
  const cart = cartLib.hydrate(req.session.cart);
  const r = await coupons.validate(req.body.code, cart.subtotal);
  if (r.ok) req.session.coupon = r.code; req.session.couponMsg = r.message;
  res.redirect('/cart');
});

module.exports = router;
