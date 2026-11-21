const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { safeEqual } = require('../../lib/orders');
const nav = require('./nav');
const db = require('../../lib/db');

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: 'Too many login attempts. Try again later.' });

router.get('/login', (req, res) => res.render('admin/login', { pageTitle: 'Admin login', noindex: true, error: null, configured: Boolean(process.env.ADMIN_USER && process.env.ADMIN_PASS) }));
router.post('/login', loginLimit, (req, res) => {
  const u = process.env.ADMIN_USER; const p = process.env.ADMIN_PASS;
  const ok = u && p && safeEqual(String(req.body.user || ''), u) && safeEqual(String(req.body.pass || ''), p);
  if (!ok) return res.status(401).render('admin/login', { pageTitle: 'Admin login', noindex: true, error: 'Incorrect username or password.', configured: Boolean(u && p) });
  const keep = { csrf: req.session.csrf };
  req.session.regenerate(() => { req.session.csrf = keep.csrf; req.session.admin = true; req.session.save(() => res.redirect('/admin')); });
});
router.post('/logout', (req, res) => { req.session.admin = false; res.redirect('/admin/login'); });

// Everything below requires an admin session
router.use((req, res, next) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  res.locals.nav = nav; res.locals.adminPath = req.baseUrl + req.path; res.locals.adminQuery = req.query; res.locals.noindex = true;
  res.locals.flash = req.session.flash || null; req.session.flash = null;
  res.locals.pageTitle = 'Admin | MythosBySS';
  next();
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SC = { awaiting_payment: 'amber', confirmed: 'blue', packed: 'blue', shipped: 'blue', out_for_delivery: 'amber', delivered: 'green', cancelled: 'red', rto: 'red', paid: 'green', advance_paid: 'amber', cod_pending: 'gray', cod_collected: 'green', pending: 'amber', failed: 'red', refunded: 'red', partially_refunded: 'amber', sent: 'blue', delivered_wa: 'green', read: 'green', simulated: 'gray', scheduled: 'amber', published: 'green', draft: 'gray', approved: 'green', rejected: 'red', active: 'green', paused: 'gray' };
router.use((req, res, next) => {
  res.locals.esc = esc;
  res.locals.pill = (t, c) => `<span class="pill pill-${c || SC[t] || 'gray'}">${esc(String(t).replace(/_/g, ' '))}</span>`;
  res.locals.dt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
  res.locals.d = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-');
  res.locals.n = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  res.locals.imgUrl = require('../../lib/catalog').imgUrl;
  next();
});
// helper: flash + redirect
router.use((req, res, next) => { res.flash = (msg, type = 'ok') => { req.session.flash = { msg, type }; }; next(); });
router.use(async (req, res, next) => {
  try { res.locals.alerts = { lowStock: await db.val('SELECT COUNT(*) FROM variants WHERE stock <= low_stock AND active=1'), toShip: await db.val("SELECT COUNT(*) FROM orders WHERE status IN ('confirmed','packed')") }; next(); } catch (e) { next(e); }
});

router.use('/', require('./dashboard'));
router.use('/orders', require('./orders'));
router.use('/finance', require('./finance'));
router.use('/', require('./catalogue'));
router.use('/', require('./customers'));
router.use('/', require('./marketing'));
router.use('/', require('./website'));
router.use('/', require('./communication'));
router.use('/', require('./plugins'));
router.use('/', require('./settings'));

router.use((req, res) => res.status(404).render('admin/notfound', { title: 'Not found' }));
module.exports = router;
