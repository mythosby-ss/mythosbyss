const catalog = require('./catalog');

const MAX_QTY = 10;
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const SHIPPING_FEE = () => num(process.env.SHIPPING_FEE, 0);
const COD_FEE = () => num(process.env.COD_FEE, 0);
const PARTIAL_PERCENT = () => Math.min(90, Math.max(5, num(process.env.PARTIAL_COD_PERCENT, 20)));

function clampQty(q) { return Math.min(MAX_QTY, Math.max(1, parseInt(q, 10) || 1)); }

function addLine(lines, slug, sku, qty) {
  const p = catalog.bySlug[slug];
  const v = p && catalog.getVariant(p, sku || p.variants[0].sku);
  if (!p || !v) return false;
  const line = lines.find((l) => l.sku === v.sku);
  if (line) line.qty = clampQty(line.qty + qty); else lines.push({ slug, sku: v.sku, qty: clampQty(qty) });
  return true;
}

function hydrate(lines = []) {
  const items = [];
  for (const l of lines) {
    const product = catalog.bySlug[l.slug];
    const variant = product && catalog.getVariant(product, l.sku);
    if (!variant) continue;
    items.push({ slug: l.slug, sku: l.sku, qty: l.qty, product, variant, unit: variant.price, mrp: variant.mrp, total: variant.price * l.qty });
  }
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const mrpTotal = items.reduce((s, i) => s + i.mrp * i.qty, 0);
  const count = items.reduce((s, i) => s + i.qty, 0);
  const shipping = items.length ? SHIPPING_FEE() : 0;
  return { items, count, subtotal, mrpTotal, savings: mrpTotal - subtotal, shipping };
}

/** Server-side money math for all 3 payment modes. Never trust client totals. */
function priceOrder(cart, method) {
  const base = cart.subtotal + cart.shipping;
  const codFee = method === 'prepaid' ? 0 : COD_FEE();
  const total = base + codFee;
  let payNow = 0;
  if (method === 'prepaid') payNow = total;
  else if (method === 'partial_cod') payNow = Math.max(1, Math.ceil((total * PARTIAL_PERCENT()) / 100));
  return { subtotal: cart.subtotal, shipping: cart.shipping, codFee, total, payNow, dueOnDelivery: total - payNow };
}

module.exports = { MAX_QTY, clampQty, addLine, hydrate, priceOrder, PARTIAL_PERCENT, COD_FEE };
