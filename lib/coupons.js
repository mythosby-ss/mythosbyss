const db = require('./db');
async function validate(code, subtotal) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return { ok: false, message: 'Enter a coupon code.' };
  const c = await db.one('SELECT * FROM coupons WHERE code=?', [code]);
  if (!c || !c.active) return { ok: false, message: 'This coupon is not valid.' };
  if (c.expires_on && c.expires_on < new Date().toISOString().slice(0, 10)) return { ok: false, message: 'This coupon has expired.' };
  if (subtotal < (c.min_order || 0)) return { ok: false, message: `Add items worth \u20B9${Math.ceil(c.min_order - subtotal)} more to use ${code}.` };
  let d = c.type === 'flat' ? c.value : (subtotal * c.value) / 100;
  if (c.max_discount) d = Math.min(d, c.max_discount);
  d = Math.min(Math.round(d), subtotal);
  return { ok: true, code, discount: d, title: c.title, message: `${code} applied. You save \u20B9${d}.` };
}
module.exports = { validate };
