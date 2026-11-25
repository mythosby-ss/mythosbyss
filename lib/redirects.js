// Permanent (301) redirects for URLs that no longer exist. Runs just before the 404 page, so it never slows real pages.
//  1. Saved redirects (table slug_redirects): written automatically when a product URL is changed in admin,
//     and imported for old Shopdeck URLs with: node scripts/shopdeck-redirects.js
//  2. Old Shopdeck URL patterns on this domain (/<Name>/catalogue/<id>/<id>, /<NAME>/collection/<id>, /featured/...,
//     /about-us ...) are matched to the closest product / collection by name, so old Google results and shared
//     links keep working even before the list is imported.
const db = require('./db');
const catalog = require('./catalog');
const { memo } = require('./cache');

const saved = () => memo('redirects', async () => Object.fromEntries((await db.q('SELECT from_path, to_path FROM slug_redirects')).map((r) => [r.from_path.toLowerCase(), r.to_path])), 5 * 60 * 1000);

const STATIC = {
  '/featured/all-products': '/products', '/featured/best-sellers': '/products', '/featured/new-arrivals': '/new-arrivals',
  '/collection/all-products': '/products', '/collection/new-arrivals': '/new-arrivals', '/collection/best-sellers': '/products',
  '/search': '/products', '/about-us': '/pages/about-us', '/privacy-policy': '/pages/privacy-policy', '/terms-and-conditions': '/pages/terms',
  '/shipping-policy': '/pages/shipping-policy', '/return-policy': '/pages/returns', '/refund-policy': '/pages/returns', '/contact-us': '/pages/contact',
  '/cancellation-policy': '/pages/returns', '/track-order': '/track', '/orders': '/account', '/profile': '/account'
};

const STOP = new Set(['the', 'and', 'with', 'for', 'of', 'in', 'a', 'an', 'to', 'set', 'pack', 'new', 'ml', 'l', 'pcs', 'pc']);
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));

/** closest product for an old product name; null if nothing is a convincing match */
function matchProduct(name) {
  const want = words(name); if (!want.length) return null;
  let best = null; let bestScore = 0;
  for (const p of catalog.products) {
    const have = new Set(words(`${p.name} ${p.categoryName} ${p.variants.map((v) => v.label).join(' ')}`));
    const score = want.filter((w) => have.has(w)).length / want.length;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return bestScore >= 0.5 ? { product: best, score: bestScore } : null;
}
function matchCategory(name) {
  const want = new Set(words(name));
  return catalog.categories.find((c) => c.count && words(`${c.slug} ${c.name}`).every((w) => want.has(w))) || null;
}

/** where an old path should go, or null */
async function resolve(rawPath) {
  let path; try { path = decodeURIComponent(rawPath); } catch (_) { path = rawPath; }
  path = path.replace(/\/+$/, '') || '/';
  const key = path.toLowerCase();
  const s = (await saved())[key]; if (s) return s;
  if (STATIC[key]) return STATIC[key];
  let m = path.match(/^\/([^/]+)\/catalogue\/[^/]+(?:\/[^/]+)?$/i); // Shopdeck product
  if (m) { const hit = matchProduct(m[1]); if (hit) return `/products/${hit.product.slug}`; const c = matchCategory(m[1]); return c ? `/collections/${c.slug}` : '/products'; }
  m = path.match(/^\/(?:([^/]+)\/)?collection\/([^/]+)$/i); // Shopdeck collection
  if (m) { const c = matchCategory(m[1] || m[2]); return c ? `/collections/${c.slug}` : '/products'; }
  m = path.match(/^\/products\/([^/]+)$/); // old / renamed product slug
  if (m) { const hit = matchProduct(m[1].replace(/-/g, ' ')); if (hit && hit.score >= 0.75) return `/products/${hit.product.slug}`; }
  return null;
}

// keep ad / campaign tracking parameters when redirecting
const KEEP = /^(utm_\w+|fbclid|gclid|gbraid|wbraid)$/;
function middleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  resolve(req.path).then((to) => {
    if (!to || to === req.path) return next();
    const qs = new URLSearchParams(Object.entries(req.query).filter(([k, v]) => KEEP.test(k) && typeof v === 'string')).toString();
    res.redirect(301, to + (qs ? (to.includes('?') ? '&' : '?') + qs : ''));
  }).catch(next);
}
module.exports = { middleware, resolve, matchProduct, matchCategory };
