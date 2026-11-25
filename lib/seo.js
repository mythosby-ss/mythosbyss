// SEO helpers: page titles/descriptions from templates (lib/settings.js), canonical URLs and JSON-LD structured data.
const settings = require('./settings');

const base = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const abs = (req, u) => (u && u.startsWith('/') ? base(req) + u : u);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= n) return s; const c = s.slice(0, n - 1); return c.slice(0, c.lastIndexOf(' ') > n * 0.6 ? c.lastIndexOf(' ') : c.length).replace(/[\s,.;:–-]+$/, '') + '…'; };

function vars(req, extra = {}) {
  return { store: settings.get('store_name'), domain: base(req).replace(/^https?:\/\//, ''), site_description: settings.get('site_description'),
    pay_options: settings.on('cod_enabled') ? 'Cash on delivery available' : 'Secure online payment', ...extra };
}
const fill = (tpl, v) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m)).replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
const firstSentence = (s) => clip(String(s || '').split(/(?<=[.!?])\s/)[0], 90);

const home = (req) => ({ pageTitle: clip(fill(settings.get('seo_home_title'), vars(req)), 70), pageDesc: clip(fill(settings.get('seo_home_desc'), vars(req)), 160) });
function product(req, p) {
  const v = vars(req, { product: p.name, price: Number(p.price).toLocaleString('en-IN'), category: p.categoryName, snippet: firstSentence(p.description) });
  return { pageTitle: p.seoTitle || clip(fill(settings.get('seo_product_title'), v), 70), pageDesc: p.seoDesc || clip(fill(settings.get('seo_product_desc'), v), 160) };
}
function collection(req, c) {
  const v = vars(req, { collection: c.name, category: c.name });
  return { pageTitle: c.seoTitle || clip(fill(settings.get('seo_collection_title'), v), 70), pageDesc: c.seoDesc || clip(fill(settings.get('seo_collection_desc'), v), 160) };
}

// ---- JSON-LD ----
function organization(req) {
  const b = base(req);
  const sameAs = ['social_instagram', 'social_facebook', 'social_youtube'].map((k) => settings.get(k)).filter((u) => /^https:\/\//.test(u || ''));
  const phone = settings.get('support_phone');
  return { '@context': 'https://schema.org', '@type': 'Organization', '@id': `${b}/#org`, name: settings.get('store_name'), url: `${b}/`,
    logo: `${b}/images/logo/Mythos_Logo_TM.png`, description: settings.get('site_description'), ...(sameAs.length ? { sameAs } : {}),
    ...(phone ? { contactPoint: { '@type': 'ContactPoint', telephone: `+91${phone}`, contactType: 'customer service', areaServed: 'IN', availableLanguage: ['en', 'hi'] } } : {}) };
}
function website(req) {
  const b = base(req);
  return { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${b}/#website`, name: settings.get('store_name'), url: `${b}/`, publisher: { '@id': `${b}/#org` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${b}/products?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } };
}
const breadcrumbs = (req, items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(req, url) })) });

function productLd(req, p, reviews = []) {
  const b = base(req); const url = `${b}/products/${p.slug}`;
  const until = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  const offers = p.variants.map((v) => ({ '@type': 'Offer', sku: v.sku, name: p.multi ? v.label : undefined, price: Number(v.price).toFixed(2), priceCurrency: 'INR',
    priceValidUntil: until, availability: v.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition',
    url: p.multi ? `${url}?v=${encodeURIComponent(v.sku)}` : url, seller: { '@id': `${b}/#org` } }));
  const ld = { '@context': 'https://schema.org', '@type': 'Product', '@id': `${url}#product`, name: p.name, url, image: p.images.map((i) => abs(req, i)).slice(0, 6),
    description: clip(p.description || p.name, 5000), sku: p.variants[0] && p.variants[0].sku, category: p.categoryName,
    brand: { '@type': 'Brand', name: settings.get('store_name') }, offers: offers.length === 1 ? offers[0] : offers };
  if (reviews.length) { // only real, approved reviews
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1), reviewCount: reviews.length, bestRating: 5, worstRating: 1 };
    ld.review = reviews.slice(0, 10).map((r) => ({ '@type': 'Review', author: { '@type': 'Person', name: r.customer_name || 'Customer' }, datePublished: String(r.created_at || '').slice(0, 10) || undefined,
      reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 }, name: r.title || undefined, reviewBody: r.body || undefined }));
  }
  return ld;
}
// <script type="application/ld+json"> content (escaped so it can never close the script tag)
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// Pages that must never be indexed (also sent as an X-Robots-Tag header)
const NOINDEX = /^\/(cart|checkout|login|account|order|review|track|admin|api|media\/upload)(\/|$)/;

module.exports = { base, abs, clip, home, product, collection, organization, website, breadcrumbs, productLd, ldJson, NOINDEX };
