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
  const offers = quantityOffers(items);
  const offerDiscount = offers.reduce((s, o) => s + o.off, 0);
  const net = subtotal - offerDiscount; // value after quantity offers, before coupon
  // Free delivery above a threshold; below it the shipping fee applies (Admin > Settings: shipping fee)
  const fee = settings.num('shipping_fee'); const threshold = settings.num('free_shipping_threshold');
  const freeShip = items.length && fee > 0 && threshold > 0 ? { threshold, fee, remaining: Math.max(0, threshold - net), pct: Math.min(100, Math.round((net / threshold) * 100)) } : null;
  const shipping = !items.length || (freeShip && freeShip.remaining === 0) ? 0 : fee;
  return { items, count: items.reduce((s, i) => s + i.qty, 0), subtotal, mrpTotal, savings: mrpTotal - subtotal, offers, offerDiscount, net,
    shipping, freeShip, hasSoldOut: items.some((i) => i.soldOut) };
}

/** Quantity offer tiers from settings, e.g. "2:30, 3:75" -> [{ qty: 2, off: 30 }, { qty: 3, off: 75 }] */
function offerTiers() {
  return String(settings.get('qty_offer_tiers') || '').split(/[,;\n]+/).map((t) => t.split(':').map((x) => Number(String(x).replace(/[^\d.]/g, ''))))
    .filter(([q, off]) => q >= 2 && off > 0).map(([qty, off]) => ({ qty: Math.round(qty), off: Math.round(off) })).sort((a, b) => a.qty - b.qty);
}
/** Best tier per product (all its variants together), capped at the product's line value. */
function quantityOffers(items) {
  const tiers = offerTiers(); if (!tiers.length) return [];
  const bundles = settings.on('qty_offer_on_bundles'); const by = {};
  for (const i of items) {
    if (i.soldOut || (i.variant.isBundle && !bundles)) continue;
    const g = (by[i.slug] = by[i.slug] || { slug: i.slug, name: i.product.name, qty: 0, value: 0 }); g.qty += i.qty; g.value += i.total;
  }
  return Object.values(by).map((g) => { const t = tiers.filter((x) => g.qty >= x.qty).pop(); return t ? { ...g, tier: t, off: Math.min(t.off, g.value) } : null; }).filter(Boolean);
}

/** ₹ off for paying fully online (Admin > Settings > COD & RTO rules). */
const prepaidDiscount = () => Math.max(0, Math.round(settings.num('prepaid_discount')));

/** Advance paid online for partial COD: a fixed ₹ amount (default ₹99) or a % of the total. */
function partialAdvance(total) {
  if (settings.get('partial_cod_type') === 'percent') {
    const pct = Math.min(90, Math.max(5, settings.num('partial_cod_percent') || 20));
    return Math.min(total, Math.max(1, Math.ceil((total * pct) / 100)));
  }
  return Math.min(total, Math.max(1, Math.round(settings.num('partial_cod_amount') || 99)));
}

/**
 * All money math lives here (server side). `discount` comes from a validated coupon.
 * Prepaid orders get the prepaid discount; COD and partial COD pay the COD fee (if set).
 */
function priceOrder(cart, method, discount = 0, advance = null) { // advance: ₹ set by the payment tier (lib/codrules cartRule), null = normal
  const codFee = method === 'prepaid' ? 0 : settings.num('cod_fee');
  const afterCoupon = Math.max(0, cart.net - discount);
  const prepaidOff = method === 'prepaid' ? Math.min(prepaidDiscount(), afterCoupon) : 0;
  const total = afterCoupon - prepaidOff + cart.shipping + codFee;
  let payNow = 0;
  if (method === 'prepaid') payNow = total; else if (method === 'partial_cod') payNow = advance > 0 ? Math.min(total, advance) : partialAdvance(total);
  return { subtotal: cart.subtotal, offerDiscount: cart.offerDiscount, discount, prepaidDiscount: prepaidOff, shipping: cart.shipping, codFee, total, payNow, dueOnDelivery: total - payNow };
}

module.exports = { MAX_QTY, clampQty, addLine, hydrate, priceOrder, prepaidDiscount, partialAdvance, offerTiers };
