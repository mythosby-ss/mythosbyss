// DB-backed catalog with an in-memory cache. Admin changes call refresh(), so the storefront updates instantly.
const db = require('./db');

const PLACEHOLDER = '/images/placeholder.svg';
const imgUrl = (v) => {
  if (!v) return null;
  if (v.startsWith('drive:')) return `/media/${v.slice(6)}`;
  return v;
};

function build(prows, vrows, withDrafts) {
  const vBy = {};
  vrows.forEach((v) => { (vBy[v.product_id] = vBy[v.product_id] || []).push({
    id: v.id, sku: v.sku, code: v.code, label: v.label, price: v.price, mrp: v.mrp, cost: v.cost_price || 0,
    stock: v.stock, lowStock: v.low_stock, pack: v.pack, active: !!v.active,
    rawImages: JSON.parse(v.images || '[]'), images: JSON.parse(v.images || '[]').map(imgUrl).filter(Boolean) }); });
  return prows.filter((p) => withDrafts || p.status === 'published').map((p) => {
    const variants = (vBy[p.id] || []).filter((v) => withDrafts || v.active);
    if (!variants.length && !withDrafts) return null;
    const min = variants.length ? variants.reduce((a, b) => (b.price < a.price ? b : a)) : { price: 0, mrp: 0 };
    const raw = JSON.parse(p.images || '[]');
    const productImages = raw.map(imgUrl).filter(Boolean);
    const imageVariant = variants.find((v) => v.stock > 0 && v.images.length) || variants.find((v) => v.images.length);
    const images = productImages.length ? productImages : imageVariant ? imageVariant.images : [];
    const stock = variants.reduce((s, v) => s + v.stock, 0);
    return {
      id: p.id, slug: p.slug, name: p.name, category: p.category, description: p.description || '',
      features: JSON.parse(p.features || '[]'), badge: p.badge, isNew: !!p.is_new, status: p.status, createdAt: p.created_at,
      rawImages: raw, images: images.length ? images : [PLACEHOLDER], image: images[0] || PLACEHOLDER,
      hasImage: productImages.length > 0 || Boolean(imageVariant),
      packagingCost: p.packaging_cost, shippingCost: p.shipping_cost, // null = settings default (profit dashboard)
      weightKg: p.weight_kg, lengthCm: p.length_cm, breadthCm: p.breadth_cm, heightCm: p.height_cm,
      chargeableWeight: p.chargeable_weight_kg, // null = settings default_weight_kg (payment rules)
      paymentMode: p.payment_mode_override === 'prepaid_only' ? 'prepaid_only' : 'auto',
      imageAlt: p.image_alt || p.name, seoTitle: p.seo_title, seoDesc: p.seo_desc, seoKeywords: p.seo_keywords,
      variants, price: min.price, mrp: min.mrp, discount: min.mrp ? Math.round((1 - min.price / min.mrp) * 100) : 0,
      multi: variants.length > 1, stock, inStock: stock > 0, sort: p.sort, updatedAt: p.updated_at
    };
  }).filter(Boolean);
}

/** Bundles: stock = complete sets the component stock allows; cost = sum of component costs unless set on the bundle. */
function applyBundles(list, prows, vrows, brows) {
  if (!brows.length) return;
  const raw = Object.fromEntries(vrows.map((v) => [v.sku, v]));
  const pname = Object.fromEntries(prows.map((p) => [p.id, p.name]));
  const comps = {}; brows.forEach((b) => { (comps[b.bundle_sku] = comps[b.bundle_sku] || []).push(b); });
  for (const p of list) {
    for (const v of p.variants) {
      const cs = comps[v.sku]; if (!cs) continue;
      v.isBundle = true;
      v.components = cs.map((c) => { const r = raw[c.component_sku] || {}; return { sku: c.component_sku, qty: c.qty, name: pname[r.product_id] || c.component_sku, label: r.label || '', price: r.price || 0, cost: r.cost_price || 0 }; });
      v.stock = Math.max(0, Math.min(...cs.map((c) => { const r = raw[c.component_sku]; return r && r.active ? Math.floor(r.stock / c.qty) : 0; })));
      v.componentsValue = v.components.reduce((s, c) => s + c.price * c.qty, 0);
      if (!v.cost) v.cost = v.components.reduce((s, c) => s + c.cost * c.qty, 0);
    }
    if (p.variants.some((v) => v.isBundle)) { p.isBundle = true; p.stock = p.variants.reduce((s, v) => s + v.stock, 0); p.inStock = p.stock > 0; }
  }
}

let C = { products: [], all: [], bySlug: {}, categories: [], catBySlug: {}, bundleSkus: new Set(), sold: {} };

async function refresh() {
  const [prows, vrows, cats, brows, sales] = await Promise.all([
    db.q('SELECT * FROM products ORDER BY sort, id'), db.q('SELECT * FROM variants ORDER BY id'), db.q('SELECT * FROM categories ORDER BY sort'),
    db.q('SELECT * FROM bundle_items ORDER BY rowid'),
    // units sold per product (paid / confirmed orders only), for "best sellers" and the New arrivals top-up
    db.q("SELECT oi.product_slug AS slug, SUM(oi.qty) AS sold FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status NOT IN ('cancelled','awaiting_payment','rto') GROUP BY oi.product_slug ORDER BY sold DESC")]);
  const all = build(prows, vrows, true);
  const products = build(prows, vrows, false);
  applyBundles(all, prows, vrows, brows); applyBundles(products, prows, vrows, brows);
  const catCounts = {}; products.forEach((p) => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });
  const categories = cats.map((c) => ({ slug: c.slug, name: c.name, blurb: c.blurb, seoTitle: c.seo_title, seoDesc: c.seo_desc, seoKeywords: c.seo_keywords, count: catCounts[c.slug] || 0 }));
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  products.forEach((p) => { p.categoryName = (catBySlug[p.category] || {}).name || p.category; });
  all.forEach((p) => { p.categoryName = (catBySlug[p.category] || {}).name || p.category; });
  require('./cache').clear(); // cached add-ons / reviews reference products
  C = { products, all, bySlug: Object.fromEntries(products.map((p) => [p.slug, p])), categories, catBySlug, bundleSkus: new Set(brows.map((b) => b.bundle_sku)), sold: Object.fromEntries(sales.map((r) => [r.slug, Number(r.sold) || 0])) };
}

/** best sellers by units sold (in-stock first, then the rest); products with no sales keep the shop order */
function bestSellers() {
  const sold = (p) => C.sold[p.slug] || 0;
  return C.products.filter((p) => sold(p) > 0).sort((a, b) => (b.inStock - a.inStock) || (sold(b) - sold(a)));
}

/** New arrivals: marked "New" or added in the last N days (newest first), always at least new_arrivals_min products.
 *  Nothing added in N days -> best sellers first. Topped up with best sellers, then the newest products. */
function newArrivals() {
  const settings = require('./settings');
  const min = Math.max(1, settings.num('new_arrivals_min') || 6);
  const since = Date.now() - Math.max(1, settings.num('new_arrivals_days') || 90) * 864e5;
  const added = (p) => { const t = Date.parse(p.createdAt || ''); return Number.isFinite(t) ? t : 0; };
  const byNewest = [...C.products].sort((a, b) => added(b) - added(a));
  const recent = byNewest.filter((p) => added(p) >= since);
  const marked = byNewest.filter((p) => p.isNew);
  const inStockFirst = (l) => [...l.filter((p) => p.inStock), ...l.filter((p) => !p.inStock)];
  const order = recent.length ? [...recent, ...marked, ...bestSellers(), ...inStockFirst(byNewest)]
    : [...bestSellers(), ...marked, ...inStockFirst(byNewest)];
  const seen = new Set(); const out = [];
  for (const p of order) if (!seen.has(p.slug)) { seen.add(p.slug); out.push(p); }
  const fresh = new Set([...recent, ...marked].map((p) => p.slug));
  const max = Math.max(min, settings.num('new_arrivals_max') || 12);
  return out.slice(0, Math.min(max, Math.max(min, fresh.size)));
}

module.exports = {
  refresh,
  get products() { return C.products; },
  get all() { return C.all; },
  get bySlug() { return C.bySlug; },
  get categories() { return C.categories; },
  get catBySlug() { return C.catBySlug; },
  isBundleSku: (sku) => C.bundleSkus.has(sku),
  allBySlug: (s) => C.all.find((p) => p.slug === s),
  featuredPerCategory: () => C.categories.map((c) => C.products.find((p) => p.category === c.slug && p.inStock) || C.products.find((p) => p.category === c.slug)).filter(Boolean),
  inCategory: (slug) => C.products.filter((p) => p.category === slug),
  newArrivals,
  bestSellers,
  related: (p, n = 4) => C.products.filter((x) => x.category === p.category && x.slug !== p.slug).slice(0, n),
  search(q) {
    const t = String(q || '').toLowerCase().trim();
    if (!t) return C.products;
    return C.products.filter((p) => `${p.name} ${p.categoryName} ${p.seoKeywords || ''} ${p.variants.map((v) => v.sku + ' ' + v.label).join(' ')}`.toLowerCase().includes(t));
  },
  getVariant: (p, sku) => p.variants.find((v) => v.sku === sku),
  imgUrl, PLACEHOLDER
};
