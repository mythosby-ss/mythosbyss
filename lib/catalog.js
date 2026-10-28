const fs = require('fs');
const path = require('path');
const { categories, products: raw } = require('../data/products');

let imageMap = {};
try { imageMap = require('../data/images.json'); } catch (_) {}

const IMG_DIR = path.join(__dirname, '..', 'public', 'images', 'products');
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const localFiles = fs.existsSync(IMG_DIR) ? new Set(fs.readdirSync(IMG_DIR)) : new Set();
const PLACEHOLDER = '/images/placeholder.svg';

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const driveUrl = (v) => (/^https?:/i.test(v) ? v : `https://drive.google.com/thumbnail?id=${v}&sz=w1200`);

function findImages(slug) {
  const mapped = imageMap[slug];
  if (mapped) return [].concat(mapped).map(driveUrl);
  const out = [];
  for (const suffix of ['', '-2', '-3', '-4', '-5']) {
    for (const ext of EXTS) {
      const f = `${slug}${suffix}.${ext}`;
      if (localFiles.has(f)) { out.push(`/images/products/${f}`); break; }
    }
  }
  return out.length ? out : [PLACEHOLDER];
}

const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));

const products = raw.map((p, i) => {
  const slug = slugify(p.name);
  const variants = p.variants.map(([label, code, price, pack]) => ({
    label, sku: `MB-NK-N-${code}`, code: `N-${code}`, price, mrp: price * 2, pack
  }));
  const min = variants.reduce((a, b) => (b.price < a.price ? b : a));
  const images = findImages(slug);
  return {
    id: i + 1, slug, name: p.name, category: p.category, categoryName: catBySlug[p.category].name,
    description: p.desc, features: p.f || [], badge: p.badge || null, isNew: !!p.n,
    variants, price: min.price, mrp: min.mrp,
    discount: 50, images, image: images[0], multi: variants.length > 1
  };
});

const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));

module.exports = {
  categories,
  products,
  bySlug,
  catBySlug,
  featuredPerCategory: () => categories.map((c) => products.find((p) => p.category === c.slug)).filter(Boolean),
  inCategory: (slug) => products.filter((p) => p.category === slug),
  newArrivals: () => products.filter((p) => p.isNew),
  related: (p, n = 4) => products.filter((x) => x.category === p.category && x.slug !== p.slug).slice(0, n),
  search(q) {
    const t = String(q || '').toLowerCase().trim();
    if (!t) return products;
    return products.filter((p) => `${p.name} ${p.categoryName} ${p.variants.map((v) => v.sku + ' ' + v.label).join(' ')}`.toLowerCase().includes(t));
  },
  getVariant: (p, sku) => p.variants.find((v) => v.sku === sku)
};
