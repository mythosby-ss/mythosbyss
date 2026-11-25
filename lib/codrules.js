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

/**
 * Which payment methods are allowed.
 * @param orderValue  cart value after coupon (before prepaid discount / COD fee)
 * @param pincode     delivery pincode (optional: unknown pincode skips pincode rules)
 * @param phone       verified customer phone (optional)
 * @returns { serviceable, pincodeMessage, methods: { prepaid|partial_cod|cod: { ok, reason } } }
 */
async function paymentOptions({ orderValue, pincode, phone }) {
  const online = rzp.enabled();
  const pin = pincode ? await pincodeInfo(pincode) : null;
  const risk = await phoneRisk(phone);
  const m = {
    prepaid: { ok: online, reason: online ? '' : 'Online payment is temporarily unavailable.' },
    partial_cod: { ok: true, reason: '' },
    cod: { ok: true, reason: '' }
  };
  const block = (k, reason) => { if (m[k].ok) m[k] = { ok: false, reason }; };

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
  return { serviceable, pincodeMessage, methods: m, risk };
}

/** The method to pre-select: the configured default if allowed, otherwise the first allowed one. */
function defaultMethod(methods) {
  const pref = [settings.get('default_payment_method'), 'partial_cod', 'prepaid', 'cod'];
  return pref.find((k) => methods[k] && methods[k].ok) || null;
}

module.exports = { pincodeInfo, phoneRisk, paymentOptions, defaultMethod };
