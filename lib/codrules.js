// COD / RTO protection rules. One place decides which payment methods an order may use.
// Every rule is configurable in Admin > Settings > COD & RTO rules (values live in lib/settings.js).
const db = require('./db');
const settings = require('./settings');
const rzp = require('./razorpay');
const { isValidPincode } = require('./validate');

const rs = (n) => '₹' + Number(n).toLocaleString('en-IN');

/** Serviceability + COD status of a pincode. */
async function pincodeInfo(pincode) {
  const pin = String(pincode || '').trim();
  if (!isValidPincode(pin)) return { valid: false, serviceable: false, codBlocked: false };
  const row = await db.one('SELECT * FROM pincodes WHERE pincode=?', [pin]);
  const serviceable = settings.get('pincode_mode') === 'list' ? Boolean(row && row.serviceable) : !(row && !row.serviceable);
  return { valid: true, serviceable, codBlocked: Boolean(row && row.cod_blocked) };
}

/** RTO history and manual COD blacklist for a phone number. */
async function phoneRisk(phone) {
  const p = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!p) return { rtoCount: 0, blacklisted: false, codBlocked: false };
  const rtoCount = await db.val("SELECT COUNT(*) FROM orders WHERE phone=? AND status='rto'", [p]);
  const blacklisted = Boolean(await db.val('SELECT COUNT(*) FROM phone_rules WHERE phone=? AND cod_blocked=1', [p]));
  const threshold = settings.num('rto_block_threshold');
  return { rtoCount, blacklisted, codBlocked: blacklisted || (threshold > 0 && rtoCount >= threshold) };
}

const kg = (n) => `${Number(n.toFixed(2))} kg`;
/** "2:249, 3:299" -> [{ upTo: 2, advance: 249 }, { upTo: 3, advance: 299 }] (sorted by weight) */
function advanceTable() {
  return String(settings.get('pay_rule_high_advance_table') || '').split(',').map((x) => x.split(':').map((y) => Number(String(y).trim())))
    .filter(([w, a]) => w > 0 && a > 0).map(([upTo, advance]) => ({ upTo, advance: Math.round(advance) })).sort((a, b) => a.upTo - b.upTo);
}

/** Chargeable weight of one product: what was saved in admin, else the default (Admin > Settings > COD & RTO rules). */
const productWeight = (p) => (p && Number(p.chargeableWeight) > 0 ? Number(p.chargeableWeight) : Math.max(0, settings.num('default_weight_kg')));
/** max(dead weight, L x B x H / 5000), rounded to 10 g. null when nothing was entered. */
function chargeableWeight({ weightKg, lengthCm, breadthCm, heightCm }) {
  const dead = Number(weightKg) || 0; const vol = (Number(lengthCm) || 0) * (Number(breadthCm) || 0) * (Number(heightCm) || 0) / 5000;
  const w = Math.max(dead, vol); return w > 0 ? Math.round(w * 100) / 100 : null;
}

/**
 * Payment tier for a cart from its total and total chargeable weight (strictest rule wins):
 *   low          total < 800  AND weight <= 1 kg  -> COD, partial COD (normal advance), prepaid
 *   mid          total 800-1000 OR weight 1-2 kg  -> partial COD (advance ₹199), prepaid
 *   high         total > 1000 OR weight > 2 kg    -> prepaid, or partial COD with the weight-table advance (toggle)
 *   prepaid_only weight > 3 kg OR a product set to "prepaid only"
 * All numbers come from settings. Returns { tier, weight, cod, partial, advance (null = normal advance), codReason, partialReason }.
 */
function cartRule(items, total) {
  const weight = Math.round(items.reduce((s, i) => s + productWeight(i.product) * i.qty, 0) * 100) / 100;
  const base = { tier: 'low', weight, cod: true, partial: true, advance: null, codReason: '', partialReason: '' };
  if (!settings.on('pay_rules_enabled') || !items.length) return base;
  const n = (k) => settings.num(k);
  const onlyOnline = items.filter((i) => i.product && i.product.paymentMode === 'prepaid_only').map((i) => i.product.name);
  if (onlyOnline.length) {
    const why = `${onlyOnline.length === 1 ? onlyOnline[0] + ' is' : 'Some items in your cart are'} available with online payment only.`;
    return { ...base, tier: 'prepaid_only', cod: false, partial: false, codReason: why, partialReason: why };
  }
  if (n('pay_rule_prepaid_only_weight') > 0 && weight > n('pay_rule_prepaid_only_weight')) {
    const why = `Your order weighs ${kg(weight)}. Orders over ${kg(n('pay_rule_prepaid_only_weight'))} can only be paid online.`;
    return { ...base, tier: 'prepaid_only', cod: false, partial: false, codReason: why, partialReason: why };
  }
  if (total > n('pay_rule_mid_max_total') || weight > n('pay_rule_mid_max_weight')) {
    const codReason = total > n('pay_rule_mid_max_total') ? `Cash on delivery is available on orders up to ${rs(n('pay_rule_mid_max_total'))}.`
      : `Cash on delivery is available on orders up to ${kg(n('pay_rule_mid_max_weight'))} (yours is ${kg(weight)}).`;
    const row = settings.on('pay_rule_high_partial') ? advanceTable().find((r) => weight <= r.upTo) : null;
    return { ...base, tier: 'high', cod: false, partial: Boolean(row), advance: row ? row.advance : null, codReason,
      partialReason: row ? '' : `Partial COD is not available for this order (${kg(weight)}, ${rs(total)}).` };
  }
  if (total >= n('pay_rule_cod_below_total') || weight > n('pay_rule_cod_max_weight')) {
    const codReason = total >= n('pay_rule_cod_below_total') ? `Full cash on delivery is available on orders below ${rs(n('pay_rule_cod_below_total'))}.`
      : `Full cash on delivery is available on orders up to ${kg(n('pay_rule_cod_max_weight'))} (yours is ${kg(weight)}).`;
    return { ...base, tier: 'mid', cod: false, advance: Math.max(1, Math.round(n('pay_rule_mid_advance'))), codReason };
  }
  return base;
}

/**
 * Which payment methods are allowed.
 * @param orderValue  cart value after coupon (before prepaid discount / COD fee)
 * @param pincode     delivery pincode (optional: unknown pincode skips pincode rules)
 * @param phone       verified customer phone (optional)
 * @param items       cart items (for the weight / total tiers in cartRule; optional)
 * @returns { serviceable, pincodeMessage, methods: { prepaid|partial_cod|cod: { ok, reason } }, rule }
 */
async function paymentOptions({ orderValue, pincode, phone, items = [] }) {
  const online = rzp.enabled();
  const pin = pincode ? await pincodeInfo(pincode) : null;
  const risk = await phoneRisk(phone);
  const m = {
    prepaid: { ok: online, reason: online ? '' : 'Online payment is temporarily unavailable.' },
    partial_cod: { ok: true, reason: '' },
    cod: { ok: true, reason: '' }
  };
  const block = (k, reason) => { if (m[k].ok) m[k] = { ok: false, reason }; };

  // Cart total + weight tiers first (their message is the clearest), then the existing rules on top
  const rule = cartRule(items, orderValue);
  if (!rule.cod) block('cod', rule.codReason);
  if (!rule.partial) block('partial_cod', rule.partialReason);

  // Full COD rules
  const min = settings.num('cod_min_order'); const max = settings.num('cod_max_order');
  if (!settings.on('cod_enabled')) block('cod', 'Cash on delivery is not available right now.');
  if (min > 0 && orderValue < min) block('cod', `Cash on delivery is available on orders of ${rs(min)} or more.`);
  if (max > 0 && orderValue > max) block('cod', `Cash on delivery is available on orders up to ${rs(max)}. Please pay online.`);
  const riskyPin = Boolean(pin && pin.codBlocked);
  if (riskyPin) block('cod', `Cash on delivery is not available for pincode ${pin && String(pincode).trim()}.`);
  if (risk.codBlocked) block('cod', 'Cash on delivery is not available for this account.');

  // Partial COD rules
  if (!settings.on('partial_cod_enabled')) block('partial_cod', 'Partial COD is not available right now.');
  if (!online) block('partial_cod', 'Partial COD needs online payment, which is temporarily unavailable.');
  if ((riskyPin || risk.codBlocked) && !settings.on('risk_allow_partial')) block('partial_cod', 'Only online payment is available for this order.');

  let serviceable = true; let pincodeMessage = '';
  if (pin) {
    if (!pin.valid) { serviceable = false; pincodeMessage = 'Enter a valid 6-digit pincode.'; }
    else if (!pin.serviceable) { serviceable = false; pincodeMessage = `Sorry, we do not deliver to ${String(pincode).trim()} yet.`; }
  }
  if (!serviceable) for (const k of Object.keys(m)) block(k, pincodeMessage);
  return { serviceable, pincodeMessage, methods: m, risk, rule };
}

/** Checkout message when cash on delivery is not available: why, and how much paying online saves vs the other option. */
function payNote(methods, pricing) {
  if (methods.cod.ok || !methods.prepaid.ok) return null;
  const compare = methods.partial_cod.ok ? pricing.partial_cod : pricing.cod; // what they would otherwise pay
  return { reason: methods.cod.reason, save: Math.max(0, Math.round(compare.total - pricing.prepaid.total)), onlyOnline: !methods.partial_cod.ok };
}

/** The method to pre-select: the configured default if allowed, otherwise the first allowed one. */
function defaultMethod(methods) {
  const pref = [settings.get('default_payment_method'), 'partial_cod', 'prepaid', 'cod'];
  return pref.find((k) => methods[k] && methods[k].ok) || null;
}

module.exports = { pincodeInfo, phoneRisk, paymentOptions, defaultMethod, payNote, cartRule, chargeableWeight, productWeight, advanceTable };
