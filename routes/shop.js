const router = require('express').Router();
const catalog = require('../lib/catalog');
const db = require('../lib/db');
const settings = require('../lib/settings');
const events = require('../lib/events');
const rateLimit = require('express-rate-limit');
const codrules = require('../lib/codrules');
const upsell = require('../lib/upsell');
const cartLib = require('../lib/cart');
const seo = require('../lib/seo');
// "Hot Deals" ribbon on the New arrivals section (text in Admin -> Settings; empty = hidden)
const dealsBanner = (list) => (settings.get('new_arrivals_banner') ? { title: settings.get('new_arrivals_banner'), sub: settings.get('new_arrivals_banner_sub'),
  upto: Math.max(0, ...list.map((p) => p.discount || 0)) } : null);
const { memo } = require('../lib/cache');

const SORTS = { featured: null, 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, 'name-asc': (a, b) => a.name.localeCompare(b.name) };
const sortList = (list, key) => (SORTS[key] ? [...list].sort(SORTS[key]) : list);
const today = () => new Date().toISOString().slice(0, 10);
const abs = seo.abs;

async function publicReviews(where = '1=1', args = [], limit = 20) {
  const rows = await memo(`reviews:${where}:${args.join(',')}:${limit}`, () => db.q(`SELECT * FROM reviews WHERE status='approved' AND ${where} ORDER BY id DESC LIMIT ${limit}`, args));
  return rows.map((r) => ({ ...r, productObj: catalog.bySlug[r.product_slug], photoUrl: r.photo ? catalog.imgUrl(r.photo) : null }));
}
const videoView = (t) => ({ ...t, videoId: t.video, thumbUrl: t.thumb ? catalog.imgUrl('drive:' + t.thumb) : (t.video ? `/media/${t.video}?sz=sm` : '/images/placeholder.svg'), productObj: catalog.bySlug[t.product_slug] });
const reviewPhotoView = (r) => ({ ...r, videoId: null, thumbUrl: r.photoUrl, quote: [r.title, r.body].filter(Boolean).join('. ') });

router.get('/', async (req, res, next) => {
  try {
    // the three home-page queries run in parallel and are cached for 60 s (cleared on every admin save)
    const [banners, testRows, reviews] = await Promise.all([
      memo(`banners:${today()}`, () => db.q("SELECT * FROM banners WHERE active=1 AND (starts_on IS NULL OR starts_on='' OR starts_on<=?) AND (ends_on IS NULL OR ends_on='' OR ends_on>=?) ORDER BY sort,id", [today(), today()])),
      memo('tests:home', () => db.q('SELECT * FROM testimonials WHERE active=1 ORDER BY sort, id DESC LIMIT 8')),
      publicReviews('1=1', [], 6)]);
    const tests = testRows.map(videoView);
    const reviewTestimonials = reviews.filter((r) => r.photoUrl).map(reviewPhotoView);
    res.render('index', {
      ...seo.home(req), jsonLd: [seo.organization(req), seo.website(req)],
      slides: banners.map((b) => ({ title: b.title, text: b.subtitle, cta: b.cta_text, href: b.link || '/products', theme: b.theme, image: b.image ? catalog.imgUrl(b.image) : null })),
      featured: catalog.featuredPerCategory(), ...(() => { const n = catalog.newArrivals().slice(0, Math.max(6, settings.num('new_arrivals_min'))); return { newArrivals: n, deals: dealsBanner(n) }; })(),
      reviews, testimonials: [...tests, ...reviewTestimonials].slice(0, 8)
    });
  } catch (e) { next(e); }
});

router.get('/collections/:slug', (req, res, next) => {
  const cat = catalog.catBySlug[req.params.slug];
  if (!cat) return next();
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', {
    ...seo.collection(req, cat), jsonLd: [seo.breadcrumbs(req, [['Home', '/'], ['All products', '/products'], [cat.name, `/collections/${cat.slug}`]])],
    heading: cat.name, blurb: cat.blurb, activeCat: cat.slug, sort, list: sortList(catalog.inCategory(cat.slug), sort)
  });
});

router.get('/new-arrivals', (req, res) => {
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', { ...seo.collection(req, { name: 'New Arrivals' }), heading: 'New arrivals', blurb: 'The latest additions to our range.', activeCat: 'new', sort, list: sortList(catalog.newArrivals(), sort), deals: dealsBanner(catalog.newArrivals()) });
});

router.get('/products', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  let list = catalog.search(q);
  if (req.query.category && catalog.catBySlug[req.query.category]) list = list.filter((p) => p.category === req.query.category);
  if (q) events.track(req, 'search', { term: q.toLowerCase(), results: list.length });
  res.render('collection', {
    ...(q ? { pageTitle: `Search: ${q} | ${settings.get('store_name')}`, pageDesc: null } : seo.collection(req, { name: 'All Products' })), noindex: Boolean(q),
    heading: q ? `Results for "${q}"` : 'All products', blurb: q ? `${list.length} product${list.length === 1 ? '' : 's'} found.` : 'Everything in the MythosBySS range.',
    activeCat: 'all', sort, q, list: sortList(list, sort), isSearch: Boolean(q)
  });
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const product = catalog.bySlug[req.params.slug];
    if (!product) return next();
    const [reviews, own, general, addons] = await Promise.all([ // parallel + cached 60 s
      publicReviews('product_slug=?', [product.slug]),
      memo(`tests:p:${product.slug}`, () => db.q('SELECT * FROM testimonials WHERE active=1 AND product_slug=? ORDER BY sort LIMIT 4', [product.slug])),
      memo('tests:general', () => db.q('SELECT * FROM testimonials WHERE active=1 ORDER BY sort, id DESC LIMIT 3')),
      upsell.forProduct(product)]);
    let tests = (own.length ? own : general).map(videoView);
    tests = [...tests, ...reviews.filter((r) => r.photoUrl).map(reviewPhotoView)].slice(0, 4);
    events.track(req, 'product_view', { product: product.slug });
    const initial = catalog.getVariant(product, req.query.v) || product.variants.find((v) => v.stock > 0) || product.variants[0];
    res.render('product', {
      ...seo.product(req, product), ogImage: product.hasImage ? abs(req, product.image) : null, ogType: 'product', ogPrice: Number(product.price).toFixed(2),
      jsonLd: [seo.productLd(req, product, reviews), seo.breadcrumbs(req, [['Home', '/'], [product.categoryName, `/collections/${product.category}`], [product.name, `/products/${product.slug}`]])],
      product, related: catalog.related(product), reviews, testimonials: tests, initial,
      addons, defaultVariant: upsell.defaultVariant, offerTiers: cartLib.offerTiers(), offers: productOffers(res.locals.offers, product, initial)
    });
  } catch (e) { next(e); }
});

// Payment lines on the product page follow the cart rules for one unit of this product (lib/codrules cartRule)
function productOffers(base, product, variant) {
  const r = codrules.cartRule([{ product, qty: 1 }], (variant || product).price);
  return { ...base, codEnabled: base.codEnabled && r.cod, partialEnabled: base.partialEnabled && r.partial,
    partialText: r.advance ? money(r.advance) : base.partialText, onlineOnly: r.tier === 'prepaid_only' ? r.codReason : '' };
}
const money = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');

// Product-page delivery check (no login needed). Order-value and phone rules are applied later at checkout.
const pinLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
router.get('/api/pincode/:pin', pinLimit, async (req, res, next) => {
  try {
    const pin = String(req.params.pin || '').trim();
    const info = await codrules.pincodeInfo(pin);
    if (!info.valid) return res.json({ ok: false, message: 'Enter a valid 6-digit pincode.' });
    if (!info.serviceable) return res.json({ ok: true, serviceable: false, message: `Sorry, we do not deliver to ${pin} yet.` });
    // ?slug=<product>: also apply that product's weight / price / "prepaid only" rule (one unit)
    const p = catalog.bySlug[String(req.query.slug || '')];
    const r = p ? codrules.cartRule([{ product: p, qty: 1 }], p.price) : { cod: true, partial: true };
    const pinCod = settings.on('cod_enabled') && !info.codBlocked;
    const cod = pinCod && r.cod;
    const partial = settings.on('partial_cod_enabled') && r.partial && (pinCod || settings.on('risk_allow_partial'));
    const why = !r.cod && r.codReason ? r.codReason + ' ' : '';
    const pay = cod ? 'Cash on delivery available.' : partial ? why + 'Pay online or use Partial COD.' : why || 'Online payment only for this pincode.';
    res.json({ ok: true, serviceable: true, cod, partial, message: `Delivery to ${pin} in ${settings.get('delivery_days_text')}. ${pay}` });
  } catch (e) { next(e); }
});

// Policy pages: text editable in Admin > Website > Policy pages (lib/pages.js)
router.get('/pages/:name', (req, res, next) => {
  const pages = require('../lib/pages');
  if (!pages.slugs.includes(req.params.name)) return next();
  const blocks = pages.blocks(req.params.name); const first = blocks.find((b) => b.type === 'p');
  res.render('page', { pageTitle: `${pages.title(req.params.name)} | ${settings.get('store_name')}`, pageDesc: seo.clip(`${pages.title(req.params.name)} of ${settings.get('store_name')}. ${first ? first.text : ''}`, 160), title: pages.title(req.params.name), blocks });
});

module.exports = router;
