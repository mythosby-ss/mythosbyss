// "Frequently bought together" / add-on suggestions.
// Order of preference: add-ons chosen in admin -> products often bought together -> low-price in-stock items.
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');
const memo = require('./cache').memo;
// All admin-chosen add-ons in one cached query (was one query per product / cart item)
const addonMap = () => memo('addons', async () => { const m = {}; (await db.q('SELECT product_slug, addon_slug FROM product_addons ORDER BY sort')).forEach((r) => { (m[r.product_slug] = m[r.product_slug] || []).push(r.addon_slug); }); return m; });

let cache = { at: 0, pairs: {} };
async function boughtTogether() { // refreshed at most every 10 minutes
  if (Date.now() - cache.at < 6e5) return cache.pairs;
  const rows = await db.q(`SELECT a.product_slug s, b.product_slug t, COUNT(*) n FROM order_items a JOIN order_items b ON a.order_id=b.order_id AND a.product_slug<>b.product_slug
    JOIN orders o ON o.id=a.order_id WHERE o.status NOT IN ('cancelled','awaiting_payment','rto') GROUP BY s, t ORDER BY n DESC`);
  const pairs = {}; rows.forEach((r) => { (pairs[r.s] = pairs[r.s] || []).push(r.t); });
  cache = { at: Date.now(), pairs };
  return pairs;
}

/** Add-on products for one product. */
async function forProduct(product, exclude = []) {
  if (!settings.on('upsell_enabled') || !product) return [];
  const max = Math.max(0, Math.min(6, settings.num('upsell_max') || 3));
  const skip = new Set([product.slug, ...exclude]);
  const ok = (p) => p && p.inStock && !skip.has(p.slug);
  const out = [];
  const push = (p) => { if (ok(p) && out.length < max) { out.push(p); skip.add(p.slug); } };
  ((await addonMap())[product.slug] || []).forEach((s) => push(catalog.bySlug[s]));
  if (settings.on('upsell_auto')) {
    ((await boughtTogether())[product.slug] || []).forEach((s) => push(catalog.bySlug[s]));
    catalog.products.filter((p) => ok(p) && p.price <= product.price).sort((a, b) => a.price - b.price).forEach(push);
  }
  return out;
}

/** Add-ons for a cart: suggestions for the items in it, excluding what is already there. */
async function forCart(cart) {
  const inCart = cart.items.map((i) => i.slug); const out = [];
  for (const i of cart.items) for (const p of await forProduct(i.product, [...inCart, ...out.map((x) => x.slug)])) out.push(p);
  return out.slice(0, Math.max(0, settings.num('upsell_max') || 3));
}

module.exports = { forProduct, forCart, defaultVariant: (p) => p.variants.find((v) => v.stock > 0) || p.variants[0] };
