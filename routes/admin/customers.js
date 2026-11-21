const router = require('express').Router();
const db = require('../../lib/db');
const A = require('../../lib/analytics');

router.get('/customers', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim(); const blocked = req.query.tab === 'blocked';
    const where = [blocked ? 'c.blocked=1' : 'c.blocked=0']; const args = [];
    if (q) { where.push('(c.phone LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const list = await db.q(`SELECT c.*, COUNT(o.id) orders, SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) delivered, SUM(CASE WHEN o.status='rto' THEN 1 ELSE 0 END) rto,
      SUM(CASE WHEN ${A.OK.replace(/status/, 'o.status')} THEN o.total ELSE 0 END) revenue FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE ${where.join(' AND ')} GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`, args);
    res.render('admin/customers', { title: 'Customers', list, q, blocked });
  } catch (e) { next(e); }
});
router.get('/customers/:id(\\d+)', async (req, res, next) => {
  const c = await db.one('SELECT * FROM customers WHERE id=?', [req.params.id]); if (!c) return next();
  const orders = await db.q('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC', [c.id]);
  res.render('admin/customer-detail', { title: c.name || c.phone, c, orders });
});
router.post('/customers/:id(\\d+)/block', async (req, res) => {
  await db.run('UPDATE customers SET blocked=? WHERE id=?', [req.body.block ? 1 : 0, req.params.id]);
  res.flash(req.body.block ? 'Customer blocked. They can no longer log in or order.' : 'Customer unblocked.'); res.redirect(req.get('referer') || '/admin/customers');
});
module.exports = router;
