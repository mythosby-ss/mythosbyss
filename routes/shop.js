const router = require('express').Router();
const catalog = require('../lib/catalog');
const reviews = require('../data/reviews');

const SORTS = {
  featured: null,
  'price-asc': (a, b) => a.price - b.price,
  'price-desc': (a, b) => b.price - a.price,
  'name-asc': (a, b) => a.name.localeCompare(b.name)
};
const sortList = (list, key) => (SORTS[key] ? [...list].sort(SORTS[key]) : list);

const slides = [
  { title: 'Hydrate in style', text: 'Elegant everyday hydration with leak-proof bottles from 500 ml to 2.6 litres.', cta: 'Shop water bottles', href: '/collections/water-bottle', theme: 'lilac', product: 'kohinoor-water-bottle' },
  { title: 'Lunch that travels well', text: 'Compartment lunch boxes and layered tiffins with cutlery included.', cta: 'Shop lunch boxes', href: '/collections/lunch-box', theme: 'gold', product: 'pro-max-lunch-box' },
  { title: 'Hot at the table, hours later', text: 'Double-walled casseroles that keep rotis soft and sabzi warm.', cta: 'Shop casseroles', href: '/collections/casserole', theme: 'ink', product: 'crystal-casserole' }
].map((s) => ({ ...s, image: (catalog.bySlug[s.product] || {}).image }));

router.get('/', (req, res) => {
  res.render('index', {
    pageTitle: 'MythosBySS | Kitchen & everyday essentials',
    pageDesc: 'Insulated casseroles, water bottles, lunch boxes, tiffins and more. Save min 50% and get free shipping.',
    slides,
    featured: catalog.featuredPerCategory(),
    newArrivals: catalog.newArrivals().slice(0, 4),
    reviews: reviews.map((r) => ({ ...r, productObj: catalog.bySlug[r.product] }))
  });
});

router.get('/collections/:slug', (req, res, next) => {
  const cat = catalog.catBySlug[req.params.slug];
  if (!cat) return next();
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', {
    pageTitle: `${cat.name} | MythosBySS`, pageDesc: cat.blurb,
    heading: cat.name, blurb: cat.blurb, activeCat: cat.slug, sort,
    list: sortList(catalog.inCategory(cat.slug), sort)
  });
});

router.get('/new-arrivals', (req, res) => {
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  res.render('collection', {
    pageTitle: 'New arrivals | MythosBySS', heading: 'New arrivals', blurb: 'The latest additions to our range.',
    activeCat: 'new', sort, list: sortList(catalog.newArrivals(), sort)
  });
});

router.get('/products', (req, res) => {
  const q = String(req.query.q || '').slice(0, 80);
  const sort = req.query.sort in SORTS ? req.query.sort : 'featured';
  let list = catalog.search(q);
  if (req.query.category && catalog.catBySlug[req.query.category]) list = list.filter((p) => p.category === req.query.category);
  res.render('collection', {
    pageTitle: q ? `Search: ${q} | MythosBySS` : 'All products | MythosBySS',
    heading: q ? `Results for "${q}"` : 'All products', blurb: q ? `${list.length} product${list.length === 1 ? '' : 's'} found.` : 'Everything in the MythosBySS range.',
    activeCat: 'all', sort, q, list: sortList(list, sort), isSearch: Boolean(q)
  });
});

router.get('/products/:slug', (req, res, next) => {
  const product = catalog.bySlug[req.params.slug];
  if (!product) return next();
  const rv = reviews.filter((r) => r.product === product.slug);
  res.render('product', {
    pageTitle: `${product.name} | MythosBySS`, pageDesc: product.description.slice(0, 155),
    product, related: catalog.related(product), reviews: rv,
    initial: catalog.getVariant(product, req.query.v) || product.variants[0]
  });
});

const PAGES = {
  'shipping-policy': ['Shipping policy', ['Orders are dispatched within 2-4 working days of confirmation.', 'Shipping is free on all orders. Delivery usually takes 4-8 working days depending on your pincode.', 'You will receive tracking details by SMS and email once your order ships.']],
  'returns': ['Returns & refunds', ['Damaged or wrong items can be returned within 7 days of delivery. Share an unboxing photo or video with our team.', 'Refunds for prepaid orders go back to the original payment method within 5-7 working days after we receive the item.']],
  'privacy-policy': ['Privacy policy', ['We collect only the details needed to process and deliver your order. We never sell your personal data.', 'Online payments are processed by Razorpay. We do not store your card or UPI details.']],
  'terms': ['Terms of service', ['By placing an order you agree to these terms. Prices and availability may change without notice.', 'Product images are for representation; colours and prints may vary slightly.']],
  'contact': ['Contact us', ['Email: support@mythosbyss.com', 'We reply within one working day. For order queries, share your order ID.']]
};
router.get('/pages/:name', (req, res, next) => {
  const pg = PAGES[req.params.name];
  if (!pg) return next();
  res.render('page', { pageTitle: `${pg[0]} | MythosBySS`, title: pg[0], paras: pg[1] });
});

module.exports = router;
