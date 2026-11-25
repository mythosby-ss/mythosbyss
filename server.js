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
const events = require('./lib/events');
const notify = require('./lib/notify');
const DbStore = require('./lib/session-store');
const seo = require('./lib/seo');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Number of proxies in front of the app (Hostinger's web server = 1; add 1 more if the Hostinger CDN / Cloudflare is on).
// Needed so rate limits and analytics see each visitor's real IP, not the proxy's.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://checkout.razorpay.com', 'https://connect.facebook.net', 'https://www.googletagmanager.com', 'https://www.googleadservices.com', 'https://googleads.g.doubleclick.net', 'https://www.google.com'],
        'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://www.googletagmanager.com', 'https://td.doubleclick.net', 'https://www.facebook.com'],
        'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://www.facebook.com', 'https://connect.facebook.net', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com', 'https://www.google.com', 'https://googleads.g.doubleclick.net', 'https://www.googleadservices.com', 'https://pagead2.googlesyndication.com'],
        'img-src': ["'self'", 'data:', 'https://drive.google.com', 'https://*.googleusercontent.com', 'https://www.facebook.com', 'https://*.google-analytics.com', 'https://www.googletagmanager.com', 'https://googleads.g.doubleclick.net', 'https://www.google.com', 'https://www.google.co.in'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProd ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());

// Webhooks: mounted before the session/CSRF middleware (they are verified by signature/secret instead).
// Raw body is needed for signature verification, so these come before express.json().
const webhooks = require('./routes/webhooks');
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), webhooks.razorpay);
app.get('/webhooks/whatsapp', webhooks.whatsappVerify);
app.post('/webhooks/whatsapp', express.raw({ type: 'application/json' }), webhooks.whatsappEvents);
app.post('/webhooks/shipping', express.json({ limit: '50kb' }), webhooks.shipping);

// Uploaded photos can live outside the app folder (UPLOAD_DIR in .env) so redeploys never delete them
app.use('/images/uploads', express.static(require('./lib/images').uploadDir(), { maxAge: isProd ? '30d' : 0 }));
// Product photos keep their file name forever (new uploads get new names), so they can be cached for 30 days
app.use('/images', express.static(path.join(__dirname, 'public', 'images'), { maxAge: isProd ? '30d' : 0 }));
// CSS/JS are linked with ?v=<deploy version>, so a versioned request can be cached for a year
const versioned = (dir) => [(req, res, next) => { if (isProd) res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'); next(); },
  express.static(path.join(__dirname, 'public', dir), { cacheControl: false })];
app.use('/css', ...versioned('css'));
app.use('/fonts', express.static(path.join(__dirname, 'public', 'fonts'), { maxAge: isProd ? '365d' : 0, immutable: isProd }));
app.use('/js', ...versioned('js'));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/images/logo/favicon-64.png'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

if (isProd && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
// Search engines and link-preview bots get no session (no database write per crawl) and no analytics rows
const sessionMw = session({
    name: 'mbss.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: true,
    store: new DbStore(), // sessions live in the database, so logins/carts survive restarts and deploys
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 1000 * 60 * 60 * 24 * 7 }
});
app.use((req, res, next) => {
  req.isBot = events.isBot(req);
  if (req.isBot && (req.method === 'GET' || req.method === 'HEAD')) { req.session = { cookie: {} }; req.sessionID = null; return next(); }
  sessionMw(req, res, next);
});

// CSRF (session token, checked on every POST)
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'POST' && !req.is('multipart/form-data')) return verifyCsrf(req, res, next);
  next();
});

// First-party analytics: page views + traffic source / UTM attribution (stored on the order at checkout)
app.use(events.middleware);

// Shared template locals
const money = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
const ASSET_VERSION = Date.now().toString(36);
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
    res.locals.track = { pixel: process.env.META_PIXEL_ID || g('mk_pixel_id'), ga4: g('mk_ga4_id'), gads: g('mk_gads_id'), gtm: g('mk_gtm_id'),
      labels: { purchase: g('mk_gads_purchase_label'), add_to_cart: g('mk_gads_a2c_label'), view_item: g('mk_gads_view_label') } };
    res.locals.googleVerification = g('mk_google_verification');
  }
  res.locals.pageDesc = null;
  // SEO: canonical URL (no query string), link-preview image, structured data, private pages kept out of Google
  res.locals.storeName = settings.get('store_name');
  res.locals.canonical = seo.base(req) + (req.path === '/' ? '/' : req.path.replace(/\/+$/, ''));
  res.locals.defaultOgImage = seo.base(req) + '/images/logo/Mythos_Logo_TM.png';
  res.locals.ogImage = null; res.locals.ogType = 'website'; res.locals.jsonLd = []; res.locals.seoLd = seo.ldJson;
  res.locals.webp = require('./lib/images').webpUrl; // '/images/x.png' -> '/images/x.webp' when that copy exists
  res.locals.noindex = seo.NOINDEX.test(req.path) || Object.keys(req.query).some((k) => k === 'q');
  if (res.locals.noindex) res.set('X-Robots-Tag', 'noindex, follow');
  // Support contacts + floating WhatsApp button (Admin > Website > Policy pages & support)
  {
    const wa = settings.get('support_whatsapp');
    res.locals.support = { whatsapp: wa, phone: settings.get('support_phone'), email: settings.get('support_email'), button: settings.on('whatsapp_button_enabled') && Boolean(wa),
      waLink: wa ? `https://wa.me/91${wa}?text=${encodeURIComponent(String(settings.get('whatsapp_button_text') || '').replace(/\{store\}/g, settings.get('store_name')))}` : '' };
  }
  res.locals.assetV = ASSET_VERSION; // cache-busting for /css and /js (they are cached for 7 days in production)
  // Payment offers shown on product / cart pages (Admin > Settings > COD & RTO rules)
  res.locals.offers = {
    shippingFee: settings.num('shipping_fee'), freeShipThreshold: settings.num('free_shipping_threshold'),
    prepaidDiscount: cartLib.prepaidDiscount(), codEnabled: settings.on('cod_enabled'), partialEnabled: settings.on('partial_cod_enabled'),
    partialText: settings.get('partial_cod_type') === 'percent' ? `${settings.num('partial_cod_percent')}%` : money(settings.num('partial_cod_amount'))
  };
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

app.use(require('./lib/redirects').middleware); // saved 301s + old Shopdeck URLs
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
  notify.startScheduler(); // every minute: send due review requests, cancel unpaid online orders after 45 min
}
start().catch((err) => { console.error('Failed to start server:', err); process.exit(1); });
