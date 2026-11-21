const router = require('express').Router();
const catalog = require('../lib/catalog');
const db = require('../lib/db');
const settings = require('../lib/settings');
const events = require('../lib/events');

const SORTS = { featured: null, 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, 'name-asc': (a, b) => a.name.localeCompare(b.name) };
const sortList = (list, key) => (SORTS[key] ? [...list].sort(SORTS[key]) : list);
const today = () => new Date().toISOString().slice(0, 10);
const abs = (req, u) => (u && u.startsWith('/') ? (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + u : u);

async function publicReviews(where = '1=1', args = [], limit = 20) {
  const rows = await db.q(`SELECT * FROM reviews WHERE status='approved' AND ${where} ORDER BY id DESC LIMIT ${limit}`, args);
  return rows.map((r) => ({ ...r, productObj: catalog.bySlug[r.product_slug], photoUrl: r.photo ? catalog.imgUrl(r.photo) : null }));
}
const videoView = (t) => ({ ...t, videoId: t.video, thumbUrl: t.thumb ? catalog.imgUrl('drive:' + t.thumb) : (t.video ? `/media/${t.video}?sz=sm` : '/images/placeholder.svg'), productObj: catalog.bySlug[t.product_slug] });
const reviewPhotoView = (r) => ({ ...r, videoId: null, thumbUrl: r.photoUrl, quote: [r.title, r.body].filter(Boolean).join('. ') });

router.get('/', async (req, res, next) => {
  try {
    const banners = await db.q("SELECT * FROM banners WHERE active=1 AND (starts_on IS NULL OR starts_on='' OR starts_on<=?) AND (ends_on IS NULL OR ends_on='' OR ends_on>=?) ORDER BY sort,id", [today(), today()]);
    const tests = (await db.q('SELECT * FROM testimonials WHERE active=1 ORDER BY sort, id DESC LIMIT 8')).map(videoView);
    const reviews = await publicReviews('1=1', [], 6);
    const reviewTestimonials = reviews.filter((r) => r.photoUrl).map(reviewPhotoView);
    res.render('index', {
      pageTitle: 'MythosBySS | Kitchen & everyday essentials',
      pageDesc: 'Insulated casseroles, water bottles, lunch boxes, tiffins and more. Save min 50% and get free shipping.',
      slides: banners.map((b) => ({ title: b.title, text: b.subtitle, cta: b.cta_text, href: b.link || '/products', theme: b.theme, image: b.image ? catalog.imgUrl(b.image) : null })),
      featured: catalog.featuredPerCategory(), newArrivals: catalog.newArrivals().slice(0, 4),
      reviews, testimonials: [...tests, ...reviewTestimonials].slice(0, 8)
    });
  } catch (e) { next(e); }
});

router.get('/collections/:slug', (req, res, next) => {
  const cat = catalog.catBySlug[req.params.slug];
  if (!cat) return next();
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', {
    pageTitle: cat.seoTitle || `${cat.name} | MythosBySS`, pageDesc: cat.seoDesc || cat.blurb,
    heading: cat.name, blurb: cat.blurb, activeCat: cat.slug, sort, list: sortList(catalog.inCategory(cat.slug), sort)
  });
});

router.get('/new-arrivals', (req, res) => {
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', { pageTitle: 'New arrivals | MythosBySS', heading: 'New arrivals', blurb: 'The latest additions to our range.', activeCat: 'new', sort, list: sortList(catalog.newArrivals(), sort) });
});

router.get('/products', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  let list = catalog.search(q);
  if (req.query.category && catalog.catBySlug[req.query.category]) list = list.filter((p) => p.category === req.query.category);
  if (q) events.track(req, 'search', { term: q.toLowerCase(), results: list.length });
  res.render('collection', {
    pageTitle: q ? `Search: ${q} | MythosBySS` : 'All products | MythosBySS', noindex: Boolean(q),
    heading: q ? `Results for "${q}"` : 'All products', blurb: q ? `${list.length} product${list.length === 1 ? '' : 's'} found.` : 'Everything in the MythosBySS range.',
    activeCat: 'all', sort, q, list: sortList(list, sort), isSearch: Boolean(q)
  });
});

router.get('/products/:slug', async (req, res, next) => {
  try {
    const product = catalog.bySlug[req.params.slug];
    if (!product) return next();
    const reviews = await publicReviews('product_slug=?', [product.slug]);
    let tests = (await db.q('SELECT * FROM testimonials WHERE active=1 AND product_slug=? ORDER BY sort LIMIT 4', [product.slug])).map(videoView);
    if (!tests.length) tests = (await db.q('SELECT * FROM testimonials WHERE active=1 ORDER BY sort, id DESC LIMIT 3')).map(videoView);
    tests = [...tests, ...reviews.filter((r) => r.photoUrl).map(reviewPhotoView)].slice(0, 4);
    events.track(req, 'product_view', { product: product.slug });
    const initial = catalog.getVariant(product, req.query.v) || product.variants.find((v) => v.stock > 0) || product.variants[0];
    res.render('product', {
      pageTitle: product.seoTitle || `${product.name} | MythosBySS`, pageDesc: product.seoDesc || product.description.slice(0, 155),
      ogImage: abs(req, product.image), product, related: catalog.related(product), reviews, testimonials: tests, initial
    });
  } catch (e) { next(e); }
});

const PAGES = {
  'shipping-policy': ['Shipping policy', ['Orders are dispatched within 2-4 working days of confirmation.', 'Shipping is free on all orders. Delivery usually takes 4-8 working days depending on your pincode.', 'You will receive WhatsApp updates when your order ships, is out for delivery and is delivered.']],
  returns: ['Returns & refunds', ['Damaged or wrong items can be returned within 7 days of delivery. Share an unboxing photo or video with our team.', 'Refunds for prepaid orders go back to the original payment method within 5-7 working days after we receive the item.']],
  'privacy-policy': ['Privacy policy', ['We collect only the details needed to process and deliver your order, and your WhatsApp number to send order updates. We never sell your personal data.', 'Online payments are processed by Razorpay. We do not store your card or UPI details.']],
  terms: ['Terms of service', ['By placing an order you agree to these terms. Prices and availability may change without notice.', 'Product images are for representation; colours and prints may vary slightly.']],
  contact: ['Contact us', [`Email: ${settings.get('support_email')}`, 'We reply within one working day. For order queries, share your order ID.']]
};
router.get('/pages/:name', (req, res, next) => {
  const pg = PAGES[req.params.name]; if (!pg) return next();
  res.render('page', { pageTitle: `${pg[0]} | MythosBySS`, title: pg[0], paras: pg[1] });
});

module.exports = router;
