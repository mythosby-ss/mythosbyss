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
  'about-us': { title: 'About mythosbyss', intro: [
    'mythosbyss brings together thoughtfully curated essentials for modern living, from premium insulated water bottles and lunch boxes to beautiful artificial plants, flowers, and vines that breathe life into any space. We also offer high-quality mascara brushes and carefully designed sets that make everyday moments more delightful.',
    'Our collections are crafted for individuals who appreciate the blend of functionality and aesthetics—whether you’re a busy professional seeking reliable hydration solutions, a home decorator looking to add effortless greenery, or someone who values quality in every detail of daily life.',
    'At mythosbyss, we believe that the objects you use every day should inspire you and reflect your aspirations. We’re committed to offering products that combine durability, style, and thoughtful design, making it easy to elevate your routine without compromise.',
    'mythosbyss — Where everyday essentials meet timeless elegance.'
  ]},
  'returns': { title: 'Return policy', sections: [
    { heading: 'Return and Refund Policy', paragraphs: [] },
    { heading: 'Cancellation Policy:', ordered: true, list: ['In case there is an order cancellation, please do so before it is shipped. Once the product is shipped it cannot be cancelled using our website.'] },
    { heading: 'Return Policy:', ordered: true, list: [
      'Returns and exchanges are applicable only to select products. Detailed return eligibility and conditions are provided on the respective product pages. For most products, the standard return window is 3 days.',
      'The return policy for any product is subject to change without prior notice.',
      'In case we do not have pick-up service available at your location, you would have to self-ship the product to our office address.',
      'Return/Exchange charges may apply on a case-to-case basis.'
    ]},
    { heading: 'NOTE FOR RETURN', list: [
      'The items should be unused and unwashed for hygiene reasons.',
      'The product should have the original packaging and tags in place. Items without the original tags will not be accepted.',
      'Customized products cannot be returned or exchanged.',
      'Return/Exchange requests that are not raised within the return period (refer to product page) will not be accepted.'
    ]}
  ]},
  'terms': { title: 'Terms of service', intro: [
    '<strong>MYTHOSBYSS</strong> operates this website. The terms <strong>we, us and our</strong> refer to MYTHOSBYSS. The information on the website, tools and services is for users. Browsing through the website means the user has accepted the terms, conditions, notices and policies of the website. Visiting or purchasing from the website means you are bound to the terms and conditions. The terms apply to all vendors, browsers, merchants, content contributors and customers. Please go through the terms and conditions mentioned on the website. If you do not agree to the conditions then do not access the website or use the services. The tools or features added to the website are also subject to terms and conditions. We reserve the right to replace or change the terms of service by posting updates on the website. You have to check such updates periodically to know the changes and decide to accept them or not. We have hosted our store on Nushop.store.'
  ], sections: [
    { heading: 'Section-1 Online Store Terms', paragraphs: ['You have to be a major to agree to the terms and conditions. With your consent, dependents can also use the website. Our products cannot be used illegally or for unauthorized purposes. Our services cannot be used to violate the laws in your jurisdiction. Any type of destructive virus, worm or code cannot be transmitted by you. Violation or breach of any of the terms and conditions may lead to termination of your services.'] },
    { heading: 'Section-2 General Conditions', paragraphs: ['Without prior permission, you cannot duplicate, sell, copy or resell any information on the website. We reserve the right to deny service to anyone at any time for any reason.'] },
    { heading: 'Section-3 Accuracy, Completeness and Timeliness of Information', paragraphs: ['If the information provided on the website is not accurate, we are not responsible. It is always better to re-confirm the information and then take decisions to avoid risks.'] },
    { heading: 'Section 4 – Modifications to the Service and Prices', paragraphs: ['The price of the products or services can change without any prior notice. We are not liable to you or any other third party for a change in price or suspension of services.'] },
    { heading: 'Section 5 – Products or Services', paragraphs: ['The products and services may have limited quantities subject to the stock available. The display on the website may not accurately display the product colour. Return or exchange is subject to our return or exchange policy. We do not give a warranty that our products, services and information can meet your expectations.'] }
  ]},
  'privacy-policy': { title: 'Privacy policy', intro: [
    'Your personal information is always kept confidential. The privacy policy is displayed on the website. The type of information collected from customers and usage of this information is published here. We have a policy of not disclosing any information to third parties except as needed to provide our services. Using our website means you have agreed to the terms and conditions of the website. It applies to people who have not made transactions or who have registered to the site and had business. Personal information such as name, address, phone number, fax, credit card information, financial profiles, identification number and e-mail address is treated as confidential.'
  ], sections: [
    { heading: 'Terms of Our Privacy Policy', paragraphs: [] },
    { heading: 'Personal Information That We Collect', paragraphs: ['Necessary information is collected when becoming a subscriber or member of our website. Our system collects the IP address of your computer automatically. This detail does not by itself identify a particular person. The MYTHOSBYSS website does not knowingly collect information about children.'] },
    { heading: 'Uses of the Information Collected', paragraphs: ['All personal information collected is handled confidentially. The information may be used to:'], list: ['Send news about the website.','Calculate the number of visitors.','Monitor the website.','Understand the geographical location of users.','Contact users to provide information about the website.','Give users a better online shopping experience.','Share updates about recent offers on the website.'] },
    { heading: '', paragraphs: ['Some personal information may be shared with courier companies, such as address and contact details, to fulfil and deliver orders. Information may also be shared with vendors where necessary to provide the service. The company may disclose information when required by law, regulation or a government authority. Cookies may be used to save preferences on your computer and help calculate website usage. Cookies do not necessarily identify visitors personally. We may share aggregated website statistics or demographic information with service providers and business partners. Third-party websites have their own privacy policies; once you leave the MYTHOSBYSS website, this policy no longer applies.'] }
  ]},
  'shipping-policy': { title: 'Shipping policy', intro: [
    'We ship all over India and try to get the best rates for our customers. Orders placed Monday through Saturday (IST) will be processed on the same or following business day and will be shipped within two business days of order placement if the product(s) are in inventory in our warehouse. If you want to enquire about the delivery time of a product, do not hesitate to contact us prior to placing your order. Shipping charges vary as per the order value and delivery location. Shipping charges for your order will be calculated and displayed at checkout. If you have any further questions, please contact us at mythosbyss@gmail.com.'
  ]},
  'contact': { title: 'Contact us', sections: [
    { heading: 'We’re here to help', paragraphs: ['For questions about products, orders, shipping or returns, please reach out using the details below.'] },
    { heading: 'Customer support', paragraphs: ['Phone: +91 7668757937', 'WhatsApp: +91 7668757937', 'Email: mythosbyss@gmail.com', 'Address: H.N. No. 37D/JRB/25, Jaganpura, Jay Ram Bagh Mauza, Agra, Uttar Pradesh 282005, India.'] }
  ]}
};
router.get('/pages/:name', (req, res, next) => {
  const pg = PAGES[req.params.name];
  if (!pg) return next();
  res.render('page', {
    pageTitle: `${pg.title} | MythosBySS`,
    pageDesc: `${pg.title} - MythosBySS customer information.`,
    page: pg
  });
});

module.exports = router;
