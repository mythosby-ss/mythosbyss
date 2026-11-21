require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const catalog = require('./lib/catalog');
const cartLib = require('./lib/cart');
const db = require('./lib/db');
const verifyCsrf = require('./lib/csrf');
const seed = require('./lib/seed');
const settings = require('./lib/settings');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://connect.facebook.net', 'https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://www.google.com'],
        'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://www.googletagmanager.com', 'https://td.doubleclick.net', 'https://www.facebook.com'],
        'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://www.facebook.com', 'https://connect.facebook.net', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com', 'https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com', 'https://pagead2.googlesyndication.com'],
        'img-src': ["'self'", 'data:', 'https://drive.google.com', 'https://*.googleusercontent.com', 'https://d2lxx579h3vopi.cloudfront.net', 'https://www.facebook.com', 'https://*.google-analytics.com', 'https://www.googletagmanager.com', 'https://googleads.g.doubleclick.net', 'https://www.google.com', 'https://www.google.co.in'],
        'style-src': ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());

// Raw body needed for webhook signature verification - must come before express.json()
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), require('./routes/webhooks').razorpay);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

if (isProd && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
app.use(
  session({
    name: 'mbss.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 7 }
    // NOTE: MemoryStore is for development. Use connect-redis / connect-mongo in production.
  })
);

// CSRF (session token, checked on every POST)
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'POST' && !req.is('multipart/form-data')) return verifyCsrf(req, res, next);
  next();
});

// Shared template locals
const money = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
app.use((req, res, next) => {
  res.locals.money = money;
  res.locals.categories = catalog.categories;
  res.locals.csrf = req.session.csrf;
  res.locals.siteUrl = process.env.SITE_URL || '';
  res.locals.path = req.path;
  res.locals.q = '';
  res.locals.cartCount = cartLib.hydrate(req.session.cart).count;
  res.locals.pageTitle = null;
  {
    const g = (k) => settings.get(k) || '';
    res.locals.track = { pixel: g('mk_pixel_id'), ga4: g('mk_ga4_id'), gads: g('mk_gads_id'), gtm: g('mk_gtm_id'),
      labels: { purchase: g('mk_gads_purchase_label'), add_to_cart: g('mk_gads_a2c_label'), view_item: g('mk_gads_view_label') } };
    res.locals.googleVerification = g('mk_google_verification');
  }
  res.locals.pageDesc = null;
  next();
});

app.use(async (req, res, next) => {
  try {
    res.locals.customer = req.session.customerId
      ? await db.one('SELECT id, phone, name, email FROM customers WHERE id=?', [req.session.customerId])
      : null;
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/account'));
app.use('/media', require('./lib/media'));
app.use('/', require('./routes/seo')); // robots.txt, sitemap.xml, product feed
app.use('/', require('./routes/shop'));
app.use('/cart', require('./routes/cart'));
app.use('/', require('./routes/checkout'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('404', { pageTitle: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) return res.status(500).json({ ok: false, message: 'Something went wrong on our side. Please try again.' });
  res.status(500).render('404', { pageTitle: 'Error', errorMode: true });
});

const PORT = process.env.PORT || 3000;
async function start() {
  await seed();
  await settings.load(); // admin-saved settings override defaults
  await catalog.refresh();
  app.listen(PORT, () => console.log(`MythosBySS running on http://localhost:${PORT}`));
}
start().catch((err) => { console.error('Failed to start server:', err); process.exit(1); });
