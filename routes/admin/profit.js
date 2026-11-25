// Admin > Analytics > Profit & RTO: order mix, RTO breakdowns, per-order profit, daily ad spend, P&L and breakeven.
const router = require('express').Router();
const db = require('../../lib/db');
const settings = require('../../lib/settings');
const catalog = require('../../lib/catalog');
const profit = require('../../lib/profit');

const money = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null; };
const back = (req) => `/admin/profit?from=${encodeURIComponent(req.body.from || '')}&to=${encodeURIComponent(req.body.to || '')}`;

router.get('/profit', async (req, res, next) => {
  try {
    const rep = await profit.report(req.query);
    res.render('admin/profit', { title: 'Profit & RTO', rep, months: await profit.monthly(6), s: settings.all(), products: catalog.all, showCosts: req.query.costs === '1' });
  } catch (e) { next(e); }
});

// Daily ad spend: one input per day. Empty = use campaign spend from Marketing > Performance for that day.
router.post('/profit/spend', async (req, res) => {
  const days = [].concat(req.body.day || []); const amounts = [].concat(req.body.amount || []);
  const stmts = [];
  days.forEach((d, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const raw = String(amounts[i] ?? '').trim();
    if (raw === '') stmts.push(['DELETE FROM daily_ad_spend WHERE day=?', [d]]);
    else if (money(raw) !== null) stmts.push(['INSERT INTO daily_ad_spend(day,amount,updated_at) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET amount=excluded.amount, updated_at=excluded.updated_at', [d, money(raw), db.nowIso()]]);
  });
  if (stmts.length) await db.batch(stmts);
  res.flash('Ad spend saved.'); res.redirect(back(req) + '#spend');
});

router.post('/profit/assumptions', async (req, res) => {
  const b = req.body;
  for (const k of ['profit_packaging_default', 'profit_forward_shipping_default', 'profit_reverse_shipping', 'cod_handling_min']) if (money(b[k]) !== null) await settings.set(k, String(money(b[k])));
  for (const k of ['cod_handling_percent', 'pg_fee_percent']) { const v = money(b[k]); if (v !== null && v <= 20) await settings.set(k, String(v)); }
  await settings.set('profit_deduct_gst', b.profit_deduct_gst ? '1' : '0');
  res.flash('Cost assumptions saved.'); res.redirect(back(req) + '#assumptions');
});

// Bulk edit: product cost (per size), packaging and default shipping (per product). Empty packaging/shipping = use the default.
router.post('/profit/costs', async (req, res) => {
  const b = req.body; const stmts = [];
  [].concat(b.pid || []).forEach((pid, i) => {
    const pk = String([].concat(b.packaging)[i] ?? '').trim(); const sh = String([].concat(b.shipping)[i] ?? '').trim();
    stmts.push(['UPDATE products SET packaging_cost=?, shipping_cost=? WHERE id=?', [pk === '' ? null : money(pk), sh === '' ? null : money(sh), Number(pid)]]);
  });
  [].concat(b.vid || []).forEach((vid, i) => { const c = money([].concat(b.vcost)[i]); if (c !== null) stmts.push(['UPDATE variants SET cost_price=? WHERE id=?', [c, Number(vid)]]); });
  if (stmts.length) await db.batch(stmts);
  await catalog.refresh();
  res.flash('Product costs saved.'); res.redirect(back(req) + '&costs=1#costs');
});

module.exports = router;
