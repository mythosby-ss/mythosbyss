const router = require('express').Router();
const cartLib = require('../lib/cart');

const wantsJson = (req) => req.is('json') || req.accepts(['html', 'json']) === 'json';
const back = (req, res, fallback = '/cart') => res.redirect(req.get('referer') || fallback);

router.get('/', (req, res) => {
  res.render('cart', { pageTitle: 'Your cart | MythosBySS', cart: cartLib.hydrate(req.session.cart), maxQty: cartLib.MAX_QTY });
});

router.post('/add', (req, res) => {
  const { slug, qty } = req.body;
  const sku = req.body.variant || req.body.sku;
  req.session.cart = req.session.cart || [];
  const ok = cartLib.addLine(req.session.cart, slug, sku, parseInt(qty, 10) || 1);
  const cart = cartLib.hydrate(req.session.cart);
  if (wantsJson(req)) return res.status(ok ? 200 : 400).json({ ok, count: cart.count, subtotal: cart.subtotal, message: ok ? 'Added to cart' : 'Product not found' });
  return ok ? res.redirect('/cart') : back(req, res);
});

router.post('/buy-now', (req, res) => {
  const { slug, qty } = req.body;
  const sku = req.body.variant || req.body.sku;
  const lines = [];
  if (!cartLib.addLine(lines, slug, sku, parseInt(qty, 10) || 1)) return back(req, res, '/');
  req.session.buyNow = lines;
  if (wantsJson(req)) return res.json({ ok: true, redirect: '/checkout?mode=buynow' });
  res.redirect('/checkout?mode=buynow');
});

router.post('/update', (req, res) => {
  const qty = parseInt(req.body.qty, 10);
  const cart = req.session.cart || [];
  const line = cart.find((l) => l.sku === req.body.sku);
  if (line) {
    if (!qty || qty < 1) cart.splice(cart.indexOf(line), 1); else line.qty = cartLib.clampQty(qty);
  }
  res.redirect('/cart');
});

router.post('/remove', (req, res) => {
  req.session.cart = (req.session.cart || []).filter((l) => l.sku !== req.body.sku);
  res.redirect('/cart');
});

module.exports = router;
