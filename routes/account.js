const router = require('express').Router();
const db = require('../lib/db');
const orders = require('../lib/orders');

const needLogin = (req, res, next) => (res.locals.customer ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));

router.get('/account', needLogin, async (req, res) => {
  const list = await db.q('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC', [res.locals.customer.id]);
  for (const o of list) o.items = await db.q('SELECT product_name, variant_label, qty FROM order_items WHERE order_id=?', [o.id]);
  const me = await db.one('SELECT * FROM customers WHERE id=?', [res.locals.customer.id]);
  res.render('account', { pageTitle: 'My account | MythosBySS', noindex: true, list, me, statusLabel: orders.STATUS_LABEL, saved: req.query.saved });
});
router.post('/account/profile', needLogin, async (req, res) => {
  await db.run('UPDATE customers SET name=?, email=? WHERE id=?', [String(req.body.name || '').trim().slice(0, 80), String(req.body.email || '').trim().slice(0, 120), res.locals.customer.id]);
  res.redirect('/account?saved=1');
});
router.get('/track', (req, res) => res.redirect('/account'));

// Review request link sent on WhatsApp after delivery. The secret token identifies the order.
router.get('/review/:token', async (req, res, next) => {
  const o = await db.one("SELECT * FROM orders WHERE review_token=? AND status='delivered'", [req.params.token]);
  if (!o) return next();
  const items = await db.q('SELECT DISTINCT product_slug, product_name FROM order_items WHERE order_id=?', [o.id]);
  const done = (await db.q('SELECT product_slug FROM reviews WHERE order_id=?', [o.id])).map((r) => r.product_slug);
  res.render('review', { pageTitle: 'Review your order | MythosBySS', noindex: true, order: o, items: items.filter((i) => !done.includes(i.product_slug)), thanks: req.query.thanks });
});
router.post('/review/:token', async (req, res, next) => {
  const o = await db.one("SELECT * FROM orders WHERE review_token=? AND status='delivered'", [req.params.token]);
  if (!o) return next();
  const items = await db.q('SELECT DISTINCT product_slug FROM order_items WHERE order_id=?', [o.id]);
  for (const it of items) {
    const rating = parseInt(req.body['rating_' + it.product_slug], 10);
    if (!(rating >= 1 && rating <= 5)) continue;
    if (await db.val('SELECT COUNT(*) FROM reviews WHERE order_id=? AND product_slug=?', [o.id, it.product_slug])) continue;
    await db.run('INSERT INTO reviews(product_slug,order_id,customer_name,city,rating,title,body,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      [it.product_slug, o.id, o.name, o.city, rating, String(req.body['title_' + it.product_slug] || '').slice(0, 100), String(req.body['body_' + it.product_slug] || '').slice(0, 1000), 'pending', db.nowIso()]);
  }
  res.redirect(`/review/${o.review_token}?thanks=1`);
});
module.exports = router;
