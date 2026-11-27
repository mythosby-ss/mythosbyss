const router = require('express').Router();
const db = require('../lib/db');
const orders = require('../lib/orders');
const rateLimit = require('express-rate-limit');

const needLogin = (req, res, next) => (res.locals.customer ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));

router.get('/account', needLogin, async (req, res) => {
  const id = res.locals.customer.id;
  const [list, items, me] = await Promise.all([
    db.q('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC', [id]),
    db.q('SELECT i.order_id, i.product_name, i.variant_label, i.qty FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.customer_id=? ORDER BY i.id', [id]), // one query, not one per order
    db.one('SELECT * FROM customers WHERE id=?', [id])
  ]);
  const by = {}; for (const i of items) (by[i.order_id] = by[i.order_id] || []).push(i);
  for (const o of list) o.items = by[o.id] || [];
  // Order summary: unpaid online attempts (never placed) are not counted as orders
  const placed = list.filter((o) => o.status !== 'awaiting_payment' && !(o.status === 'cancelled' && ['pending', 'failed'].includes(o.payment_status)));
  const count = (...s) => placed.filter((o) => s.includes(o.status)).length;
  const stats = {
    total: placed.length, delivered: count('delivered'), cancelled: count('cancelled'), returned: count('rto', 'returned'),
    inProgress: count('pending_confirmation', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'ndr'),
    spent: placed.filter((o) => o.status === 'delivered').reduce((s, o) => s + (o.total || 0), 0)
  };
  res.render('account', { pageTitle: 'My account | MythosBySS', noindex: true, list, me, stats, statusLabel: orders.STATUS_LABEL, saved: req.query.saved });
});
router.post('/account/profile', needLogin, async (req, res) => {
  await db.run('UPDATE customers SET name=?, email=? WHERE id=?', [String(req.body.name || '').trim().slice(0, 80), String(req.body.email || '').trim().slice(0, 120), res.locals.customer.id]);
  res.redirect('/account?saved=1');
});
// Public order tracking: order ID + the mobile number used at checkout. Shows status and items only (no address).
const trackLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const renderTrack = (res, extra = {}) => res.render('track', { pageTitle: 'Track your order | MythosBySS', noindex: true, error: null, result: null, form: {}, statusLabel: orders.STATUS_LABEL, ...extra });
router.get('/track', (req, res) => renderTrack(res, { form: { orderId: String(req.query.order || '').slice(0, 30) } }));
router.post('/track', trackLimit, async (req, res, next) => {
  try {
    const orderId = String(req.body.orderId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30);
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    const form = { orderId, phone };
    if (!orderId || phone.length !== 10) return renderTrack(res, { form, error: 'Enter your order ID and the 10-digit mobile number used for the order.' });
    // order IDs are stored in capitals and the input is upper-cased above, so this uses the primary key (no table scan)
    const o = await db.one('SELECT * FROM orders WHERE id=? AND phone=?', [orderId, phone]);
    if (!o) return renderTrack(res, { form, error: 'We could not find an order with that ID and mobile number. Please check both, or message us on WhatsApp.' });
    const items = await db.q('SELECT product_name, variant_label, qty FROM order_items WHERE order_id=?', [o.id]);
    const result = { id: o.id, status: o.status, createdAt: o.created_at, courier: o.courier, awb: o.awb, items, due: o.status === 'delivered' ? 0 : o.due_on_delivery,
      paymentMethod: orders.METHOD_LABEL[o.payment_method], cancelReason: o.cancel_reason, deliveredAt: o.delivered_at };
    renderTrack(res, { form, result });
  } catch (e) { next(e); }
});

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
