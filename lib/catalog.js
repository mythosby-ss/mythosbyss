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
      features: JSON.parse(p.features || '[]'), badge: p.badge, isNew: !!p.is_new, status: p.status,
      rawImages: raw, images: images.length ? images : [PLACEHOLDER], image: images[0] || PLACEHOLDER,
      hasImage: productImages.length > 0 || Boolean(imageVariant),
      imageAlt: p.image_alt || p.name, seoTitle: p.seo_title, seoDesc: p.seo_desc, seoKeywords: p.seo_keywords,
      variants, price: min.price, mrp: min.mrp, discount: min.mrp ? Math.round((1 - min.price / min.mrp) * 100) : 0,
      multi: variants.length > 1, stock, inStock: stock > 0, sort: p.sort, updatedAt: p.updated_at
    };
  }).filter(Boolean);
}

let C = { products: [], all: [], bySlug: {}, categories: [], catBySlug: {} };

async function refresh() {
  const [prows, vrows, cats] = await Promise.all([
    db.q('SELECT * FROM products ORDER BY sort, id'), db.q('SELECT * FROM variants ORDER BY id'), db.q('SELECT * FROM categories ORDER BY sort')]);
  const all = build(prows, vrows, true);
  const products = build(prows, vrows, false);
  const catCounts = {}; products.forEach((p) => { catCounts[p.category] = (catCounts[p.category] || 0) + 1; });
  const categories = cats.map((c) => ({ slug: c.slug, name: c.name, blurb: c.blurb, seoTitle: c.seo_title, seoDesc: c.seo_desc, seoKeywords: c.seo_keywords, count: catCounts[c.slug] || 0 }));
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  products.forEach((p) => { p.categoryName = (catBySlug[p.category] || {}).name || p.category; });
  all.forEach((p) => { p.categoryName = (catBySlug[p.category] || {}).name || p.category; });
  C = { products, all, bySlug: Object.fromEntries(products.map((p) => [p.slug, p])), categories, catBySlug };
}

module.exports = {
  refresh,
  get products() { return C.products; },
  get all() { return C.all; },
  get bySlug() { return C.bySlug; },
  get categories() { return C.categories; },
  get catBySlug() { return C.catBySlug; },
  allBySlug: (s) => C.all.find((p) => p.slug === s),
  featuredPerCategory: () => C.categories.map((c) => C.products.find((p) => p.category === c.slug && p.inStock) || C.products.find((p) => p.category === c.slug)).filter(Boolean),
  inCategory: (slug) => C.products.filter((p) => p.category === slug),
  newArrivals: () => C.products.filter((p) => p.isNew),
  related: (p, n = 4) => C.products.filter((x) => x.category === p.category && x.slug !== p.slug).slice(0, n),
  search(q) {
    const t = String(q || '').toLowerCase().trim();
    if (!t) return C.products;
    return C.products.filter((p) => `${p.name} ${p.categoryName} ${p.seoKeywords || ''} ${p.variants.map((v) => v.sku + ' ' + v.label).join(' ')}`.toLowerCase().includes(t));
  },
  getVariant: (p, sku) => p.variants.find((v) => v.sku === sku),
  imgUrl, PLACEHOLDER
};
