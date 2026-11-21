const catalog = require('./catalog');
const settings = require('./settings');

const MAX_QTY = 10;
const clampQty = (q, stock = MAX_QTY) => Math.max(1, Math.min(MAX_QTY, stock, parseInt(q, 10) || 1));

/** returns 'ok' | 'notfound' | 'soldout' */
function addLine(lines, slug, sku, qty) {
  const p = catalog.bySlug[slug];
  const v = p && catalog.getVariant(p, sku || (p.variants.find((x) => x.stock > 0) || p.variants[0]).sku);
  if (!p || !v) return 'notfound';
  if (v.stock <= 0) return 'soldout';
  const line = lines.find((l) => l.sku === v.sku);
  if (line) line.qty = clampQty(line.qty + qty, v.stock); else lines.push({ slug, sku: v.sku, qty: clampQty(qty, v.stock) });
  return 'ok';
}

function hydrate(lines = []) {
  const items = [];
  for (const l of lines) {
    const product = catalog.bySlug[l.slug];
    const variant = product && catalog.getVariant(product, l.sku);
    if (!variant) continue;
    const qty = Math.min(l.qty, Math.max(variant.stock, 0));
    items.push({ slug: l.slug, sku: l.sku, qty: qty || l.qty, product, variant, unit: variant.price, mrp: variant.mrp, total: variant.price * (qty || l.qty), soldOut: variant.stock <= 0 || l.qty > variant.stock });
  }
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const mrpTotal = items.reduce((s, i) => s + i.mrp * i.qty, 0);
  return { items, count: items.reduce((s, i) => s + i.qty, 0), subtotal, mrpTotal, savings: mrpTotal - subtotal,
    shipping: items.length ? settings.num('shipping_fee') : 0, hasSoldOut: items.some((i) => i.soldOut) };
}

/** All money math lives here (server side). `discount` comes from a validated coupon. */
function priceOrder(cart, method, discount = 0) {
  const codFee = method === 'prepaid' ? 0 : settings.num('cod_fee');
  const total = Math.max(0, cart.subtotal - discount) + cart.shipping + codFee;
  const pct = Math.min(90, Math.max(5, settings.num('partial_cod_percent') || 20));
  let payNow = 0;
  if (method === 'prepaid') payNow = total; else if (method === 'partial_cod') payNow = Math.max(1, Math.ceil((total * pct) / 100));
  return { subtotal: cart.subtotal, discount, shipping: cart.shipping, codFee, total, payNow, dueOnDelivery: total - payNow };
}

module.exports = { MAX_QTY, clampQty, addLine, hydrate, priceOrder };
