const router = require('express').Router();
const db = require('../../lib/db');
const A = require('../../lib/analytics');
const { toCsv } = require('../../lib/reports');
const crypto = require('crypto');

router.get('/', async (req, res, next) => {
  try {
    const unsettled = await db.one("SELECT COUNT(*) n, SUM(due_on_delivery) amt, SUM(courier_charge) exp FROM orders WHERE status='delivered' AND payment_method!='prepaid' AND cod_settlement_id IS NULL");
    const transit = await db.one("SELECT COUNT(*) n, SUM(due_on_delivery) amt FROM orders WHERE status IN ('shipped','out_for_delivery') AND payment_method!='prepaid'");
    const prepaid = await db.one(`SELECT COUNT(*) n, SUM(pay_now) amt FROM orders WHERE payment_status IN ('paid','advance_paid','refunded','partially_refunded') AND payment_method!='cod'`);
    const refunds = await db.one('SELECT COUNT(*) n, SUM(amount) amt FROM refunds');
    const settled = await db.one("SELECT COUNT(*) n, SUM(net_amount) amt FROM settlements WHERE status='paid'");
    const pendingSet = await db.one("SELECT COUNT(*) n, SUM(net_amount) amt FROM settlements WHERE status='pending'");
    const history = await db.q('SELECT * FROM settlements ORDER BY id DESC LIMIT 50');
    const ship = await db.one(`SELECT SUM(shipping_fee) charged, SUM(courier_charge) cost FROM orders WHERE ${A.OK}`);
    res.render('admin/finance', { title: 'Remittance', unsettled, transit, prepaid, refunds, settled, pendingSet, history, ship });
  } catch (e) { next(e); }
});

router.post('/settlements', async (req, res) => {
  const upto = /^\d{4}-\d{2}-\d{2}$/.test(req.body.upto || '') ? req.body.upto : A.day(new Date());
  const rows = await db.q("SELECT id, due_on_delivery, courier_charge, delivered_at FROM orders WHERE status='delivered' AND payment_method!='prepaid' AND cod_settlement_id IS NULL AND substr(delivered_at,1,10) <= ?", [upto]);
  if (!rows.length) { res.flash('No unsettled delivered COD orders up to that date.', 'err'); return res.redirect('/admin/finance'); }
  const cod = rows.reduce((s, r) => s + r.due_on_delivery, 0); const exp = rows.reduce((s, r) => s + (r.courier_charge || 0), 0);
  const start = rows.map((r) => r.delivered_at.slice(0, 10)).sort()[0];
  const ref = 'SET-' + upto.replace(/-/g, '') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  const s = await db.run('INSERT INTO settlements(reference,cycle_start,cycle_end,order_count,cod_amount,expenses,net_amount,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [ref, start, upto, rows.length, cod, exp, cod - exp, 'pending', db.nowIso()]);
  await db.batch(rows.map((r) => ['UPDATE orders SET cod_settlement_id=? WHERE id=?', [s.id, r.id]]));
  res.flash(`Settlement ${ref} created for ${rows.length} orders (net ₹${cod - exp}).`); res.redirect('/admin/finance');
});
router.post('/settlements/:id/paid', async (req, res) => {
  await db.run("UPDATE settlements SET status='paid', paid_on=? WHERE id=?", [/^\d{4}-\d{2}-\d{2}$/.test(req.body.paid_on || '') ? req.body.paid_on : A.day(new Date()), req.params.id]);
  res.flash('Settlement marked as paid.'); res.redirect('/admin/finance');
});

router.get('/orders', async (req, res, next) => {
  try {
    const r = A.range(req.query, 30);
    const where = ['created_at BETWEEN ? AND ?']; const args = [r.fromTs, r.toTs];
    for (const [k, col] of [['status', 'status'], ['method', 'payment_method'], ['pstatus', 'payment_status']]) if (req.query[k]) { where.push(`${col}=?`); args.push(req.query[k]); }
    if (req.query.settlement) { where.push('cod_settlement_id=?'); args.push(req.query.settlement); }
    const q = String(req.query.q || '').trim(); if (q) { where.push('(id LIKE ? OR phone LIKE ? OR name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const rows = await db.q(`SELECT o.*, COALESCE((SELECT SUM(amount) FROM refunds WHERE order_id=o.id),0) refunded,
      (SELECT group_concat(product_name || ' x' || qty, '; ') FROM order_items WHERE order_id=o.id) items FROM orders o WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`, args);
    for (const o of rows) { o.codCollected = o.payment_method !== 'prepaid' && o.status === 'delivered' ? o.due_on_delivery : 0; o.onlinePaid = ['paid', 'advance_paid', 'refunded', 'partially_refunded'].includes(o.payment_status) || (o.status === 'delivered' && o.payment_method === 'prepaid') ? o.pay_now : 0; }
    const live = rows.filter((o) => !['cancelled', 'awaiting_payment'].includes(o.status));
    const totals = { orders: live.length, value: live.reduce((s, o) => s + o.total, 0), discount: live.reduce((s, o) => s + o.discount, 0), shipping: live.reduce((s, o) => s + o.shipping_fee, 0), online: rows.reduce((s, o) => s + o.onlinePaid, 0), cod: rows.reduce((s, o) => s + o.codCollected, 0), refunds: rows.reduce((s, o) => s + o.refunded, 0) };
    if (req.query.format === 'csv') {
      const cols = ['id', 'created_at', 'name', 'phone', 'status', 'payment_method', 'payment_status', 'items', 'subtotal', 'discount', 'shipping_fee', 'cod_fee', 'total', 'onlinePaid', 'codCollected', 'refunded', 'courier', 'awb', 'courier_charge'];
      return res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="order-finance.csv"' }).send('\uFEFF' + toCsv(cols, rows));
    }
    res.render('admin/finance-orders', { title: 'Order finance', rows, totals, r, f: req.query });
  } catch (e) { next(e); }
});

router.get('/refunds', async (req, res, next) => {
  try {
    const list = await db.q('SELECT r.*, o.name, o.phone, o.total FROM refunds r JOIN orders o ON o.id=r.order_id ORDER BY r.id DESC LIMIT 200');
    const owed = await db.q(`SELECT o.*, COALESCE((SELECT SUM(amount) FROM refunds WHERE order_id=o.id),0) refunded FROM orders o
      WHERE o.status IN ('cancelled') AND o.payment_method!='cod' AND o.payment_status IN ('paid','advance_paid','partially_refunded') ORDER BY created_at DESC LIMIT 100`);
    const cancelled = await db.q("SELECT id, created_at, cancelled_at, name, total, payment_method, cancel_reason, status FROM orders WHERE status IN ('cancelled','rto') ORDER BY cancelled_at DESC LIMIT 100");
    res.render('admin/refunds', { title: 'Refunds & cancellations', list, owed: owed.filter((o) => o.refunded < o.pay_now), cancelled });
  } catch (e) { next(e); }
});
module.exports = router;
