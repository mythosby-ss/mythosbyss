const router = require('express').Router();
const store = require('../lib/store');
const { safeEqual } = require('../lib/orders');

const STATUSES = ['awaiting_payment', 'confirmed', 'shipped', 'delivered', 'cancelled'];

router.use((req, res, next) => {
  const user = process.env.ADMIN_USER; const pass = process.env.ADMIN_PASS;
  if (!user || !pass) return res.status(503).send('Set ADMIN_USER and ADMIN_PASS in .env to enable the admin panel.');
  const [u = '', p = ''] = Buffer.from((req.get('authorization') || '').split(' ')[1] || '', 'base64').toString().split(/:(.*)/s);
  if (safeEqual(u, user) && safeEqual(p, pass)) return next();
  res.set('WWW-Authenticate', 'Basic realm="MythosBySS Admin"').status(401).send('Authentication required');
});

router.get('/', (req, res) => res.render('admin/orders', { pageTitle: 'Orders | Admin', orders: store.all(), statuses: STATUSES }));

router.post('/orders/:id/status', (req, res) => {
  if (STATUSES.includes(req.body.status)) store.update(req.params.id, { status: req.body.status });
  res.redirect('/admin');
});

module.exports = router;
