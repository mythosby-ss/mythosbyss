// Tests for the checkout payment rules (lib/codrules.js cartRule + paymentOptions, lib/cart.js priceOrder).
// SAFE: runs on a temporary COPY of data/mythosbyss.db, ignores .env (never touches Turso / production),
// blocks every outgoing network call and uses fake Razorpay keys. Nothing is charged or sent.
//
//   node scripts/test-payment-rules.js            (or: npm run test:payments)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'data', 'mythosbyss.db');
if (!fs.existsSync(src)) { console.error('Needs a local database at data/mythosbyss.db'); process.exit(1); }
const copy = path.join(os.tmpdir(), `mythosbyss-paytest-${Date.now()}.db`);
fs.copyFileSync(src, copy);
Object.assign(process.env, { NODE_ENV: 'test', DB_URL: 'file:' + copy, DB_TOKEN: '', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', RAZORPAY_KEY_ID: 'rzp_test_fake', RAZORPAY_KEY_SECRET: 'fake' });
require('dotenv').config = () => ({}); // the real .env must not override the safe values above
global.fetch = () => Promise.reject(new Error('network blocked in tests'));

const db = require('../lib/db');
const settings = require('../lib/settings');
const codrules = require('../lib/codrules');
const cartLib = require('../lib/cart');

// The rules exactly as specified (so the test does not depend on what is saved in admin)
const SPEC = {
  pay_rules_enabled: '1', default_weight_kg: '0.5', pay_rule_cod_below_total: '800', pay_rule_cod_max_weight: '1',
  pay_rule_mid_max_total: '1000', pay_rule_mid_max_weight: '2', pay_rule_mid_advance: '199', pay_rule_high_partial: '1',
  pay_rule_high_advance_table: '3:299', pay_rule_prepaid_only_weight: '3',
  cod_enabled: '1', partial_cod_enabled: '1', partial_cod_type: 'fixed', partial_cod_amount: '99', cod_min_order: '0', cod_max_order: '0',
  risk_allow_partial: '1', rto_block_threshold: '0', pincode_mode: 'all', prepaid_discount: '40', cod_fee: '0'
};

const P = (name, kg, mode = 'auto') => ({ name, chargeableWeight: kg, paymentMode: mode });
const line = (product, qty = 1) => ({ product, qty });
const options = (items, total, extra = {}) => codrules.paymentOptions({ orderValue: total, items, ...extra });
const allowed = (o) => ['cod', 'partial_cod', 'prepaid'].filter((k) => o.methods[k].ok).join(' + ') || 'none';

let pass = 0; let fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.message); }
}

(async () => {
  await require('../lib/seed')();
  await settings.load();
  for (const [k, v] of Object.entries(SPEC)) await settings.set(k, v);
  await db.run("INSERT OR REPLACE INTO pincodes(pincode, serviceable, cod_blocked) VALUES('110001', 1, 1), ('999999', 0, 0)");
  await db.run("INSERT OR REPLACE INTO phone_rules(phone, cod_blocked) VALUES('9000000001', 1)");

  console.log('\nRule 1: total < ₹800 AND weight <= 1 kg -> full COD, partial COD, prepaid');
  await t('₹799, 1.0 kg -> all three, normal ₹99 advance', async () => {
    const o = await options([line(P('Bottle', 1))], 799);
    assert.strictEqual(allowed(o), 'cod + partial_cod + prepaid'); assert.strictEqual(o.rule.tier, 'low'); assert.strictEqual(o.rule.advance, null);
    assert.strictEqual(cartLib.priceOrder({ net: 799, shipping: 0, subtotal: 799, offerDiscount: 0 }, 'partial_cod', 0, o.rule.advance).payNow, 99);
  });
  await t('₹300, 0.2 kg -> all three', async () => assert.strictEqual(allowed(await options([line(P('Cup', 0.2))], 300)), 'cod + partial_cod + prepaid'));

  console.log('\nRule 2: total ₹800-1000 OR weight 1-2 kg -> partial COD (₹199 advance) + prepaid');
  await t('₹800 (lower edge), 0.5 kg -> partial ₹199 + prepaid', async () => {
    const o = await options([line(P('Jug', 0.5))], 800);
    assert.strictEqual(allowed(o), 'partial_cod + prepaid'); assert.strictEqual(o.rule.advance, 199);
    assert.match(o.methods.cod.reason, /below ₹800/);
  });
  await t('₹1,000 (upper edge), 0.5 kg -> partial ₹199 + prepaid', async () => assert.strictEqual((await options([line(P('Jug', 0.5))], 1000)).rule.advance, 199));
  await t('₹500, 1.5 kg -> partial ₹199 + prepaid (weight reason)', async () => {
    const o = await options([line(P('Casserole', 1.5))], 500);
    assert.strictEqual(allowed(o), 'partial_cod + prepaid'); assert.match(o.methods.cod.reason, /up to 1 kg \(yours is 1.5 kg\)/);
  });
  await t('₹500, exactly 2.0 kg -> still rule 2', async () => assert.strictEqual((await options([line(P('Set', 2))], 500)).rule.tier, 'mid'));
  await t('₹500, 3 × 0.4 kg = 1.2 kg (quantity counts) -> rule 2', async () => assert.strictEqual((await options([line(P('Cup', 0.4), 3)], 500)).rule.tier, 'mid'));
  await t('product with no weight uses default 0.5 kg: 3 units = 1.5 kg -> rule 2', async () => {
    const o = await options([line(P('Unweighed', null), 3)], 600); assert.strictEqual(o.rule.weight, 1.5); assert.strictEqual(o.rule.tier, 'mid');
  });
  await t('advance is charged at checkout: payNow = ₹199', async () => {
    const o = await options([line(P('Jug', 0.5))], 900);
    const a = cartLib.priceOrder({ net: 900, shipping: 0, subtotal: 900, offerDiscount: 0 }, 'partial_cod', 0, o.rule.advance);
    assert.strictEqual(a.payNow, 199); assert.strictEqual(a.dueOnDelivery, 701);
  });

  console.log('\nRule 3: total > ₹1000 OR weight > 2 kg -> prepaid, or partial COD with weight-table advance (toggle)');
  await t('₹1,001, 0.5 kg -> partial ₹299 + prepaid', async () => {
    const o = await options([line(P('Combo', 0.5))], 1001);
    assert.strictEqual(allowed(o), 'partial_cod + prepaid'); assert.strictEqual(o.rule.advance, 299); assert.match(o.methods.cod.reason, /up to ₹1,000/);
  });
  await t('₹500, 2.5 kg -> partial ₹299 + prepaid', async () => assert.strictEqual((await options([line(P('Jug set', 2.5))], 500)).rule.advance, 299));
  await t('₹500, exactly 3.0 kg -> partial ₹299 (2-3 kg row)', async () => assert.strictEqual((await options([line(P('Big set', 3))], 500)).rule.advance, 299));
  await t('table "2:249, 3:299": 1.5 kg + ₹1,200 -> ₹249; 2.5 kg -> ₹299', async () => {
    await settings.set('pay_rule_high_advance_table', '2:249, 3:299');
    assert.strictEqual((await options([line(P('A', 1.5))], 1200)).rule.advance, 249);
    assert.strictEqual((await options([line(P('B', 2.5))], 1200)).rule.advance, 299);
    await settings.set('pay_rule_high_advance_table', '3:299');
  });
  await t('toggle OFF -> prepaid only', async () => {
    await settings.set('pay_rule_high_partial', '0');
    const o = await options([line(P('Combo', 0.5))], 1500); assert.strictEqual(allowed(o), 'prepaid'); assert.match(o.methods.partial_cod.reason, /Partial COD is not available/);
    await settings.set('pay_rule_high_partial', '1');
  });

  console.log('\nRule 4: weight > 3 kg OR any product "prepaid only" -> prepaid only');
  await t('₹500, 3.01 kg -> prepaid only', async () => {
    const o = await options([line(P('Heavy', 3.01))], 500); assert.strictEqual(allowed(o), 'prepaid'); assert.match(o.methods.cod.reason, /over 3 kg/);
  });
  await t('₹300, 0.2 kg but product set to prepaid_only -> prepaid only, names the product', async () => {
    const o = await options([line(P('Glass Set', 0.2, 'prepaid_only')), line(P('Cup', 0.2))], 300);
    assert.strictEqual(allowed(o), 'prepaid'); assert.match(o.methods.cod.reason, /Glass Set is available with online payment only/);
  });
  await t('strictest wins: ₹1,200 AND 3.5 kg -> prepaid only (not rule 3)', async () => assert.strictEqual((await options([line(P('X', 3.5))], 1200)).rule.tier, 'prepaid_only'));

  console.log('\nChargeable weight = max(dead weight, L × B × H / 5000)');
  await t('0.4 kg in a 30×20×20 cm box -> 2.4 kg (box wins)', () => assert.strictEqual(codrules.chargeableWeight({ weightKg: 0.4, lengthCm: 30, breadthCm: 20, heightCm: 20 }), 2.4));
  await t('1.2 kg in a 10×10×10 cm box -> 1.2 kg (dead weight wins)', () => assert.strictEqual(codrules.chargeableWeight({ weightKg: 1.2, lengthCm: 10, breadthCm: 10, heightCm: 10 }), 1.2));
  await t('nothing entered -> null (default weight is used)', () => assert.strictEqual(codrules.chargeableWeight({}), null));

  console.log('\nExisting pincode / phone rules still apply on top');
  await t('rule-1 cart, COD-blocked pincode 110001 -> partial + prepaid', async () => {
    const o = await options([line(P('Cup', 0.2))], 300, { pincode: '110001' }); assert.strictEqual(allowed(o), 'partial_cod + prepaid'); assert.match(o.methods.cod.reason, /110001/);
  });
  await t('rule-1 cart, blacklisted phone -> no COD', async () => assert.strictEqual(allowed(await options([line(P('Cup', 0.2))], 300, { phone: '9000000001' })), 'partial_cod + prepaid'));
  await t('rule-1 cart, blacklisted phone + "allow partial when risky" OFF -> prepaid only', async () => {
    await settings.set('risk_allow_partial', '0');
    assert.strictEqual(allowed(await options([line(P('Cup', 0.2))], 300, { phone: '9000000001' })), 'prepaid');
    await settings.set('risk_allow_partial', '1');
  });
  await t('non-serviceable pincode 999999 -> nothing allowed', async () => {
    const o = await options([line(P('Cup', 0.2))], 300, { pincode: '999999' }); assert.strictEqual(o.serviceable, false); assert.strictEqual(allowed(o), 'none');
  });

  console.log('\nCustomer message: why COD is off + "Pay online & save ₹X"');
  await t('rule-2 cart, ₹40 prepaid discount -> "save ₹40"', async () => {
    const o = await options([line(P('Jug', 0.5))], 900); const cart = { net: 900, shipping: 0, subtotal: 900, offerDiscount: 0 };
    const pricing = Object.fromEntries(['prepaid', 'partial_cod', 'cod'].map((m) => [m, cartLib.priceOrder(cart, m, 0, o.rule.advance)]));
    const n = codrules.payNote(o.methods, pricing); assert.strictEqual(n.save, 40); assert.match(n.reason, /below ₹800/);
  });
  await t('with a ₹30 COD fee -> "save ₹70"', async () => {
    await settings.set('cod_fee', '30');
    const o = await options([line(P('Jug', 0.5))], 900); const cart = { net: 900, shipping: 0, subtotal: 900, offerDiscount: 0 };
    const pricing = Object.fromEntries(['prepaid', 'partial_cod', 'cod'].map((m) => [m, cartLib.priceOrder(cart, m, 0, o.rule.advance)]));
    assert.strictEqual(codrules.payNote(o.methods, pricing).save, 70);
    await settings.set('cod_fee', '0');
  });
  await t('rule-1 cart -> no message (COD is available)', async () => {
    const o = await options([line(P('Cup', 0.2))], 300); assert.strictEqual(codrules.payNote(o.methods, {}), null);
  });

  console.log('\nRules switched off in admin');
  await t('"Use these rules" OFF: ₹1,500, 5 kg -> all three again', async () => {
    await settings.set('pay_rules_enabled', '0');
    assert.strictEqual(allowed(await options([line(P('Heavy', 5))], 1500)), 'cod + partial_cod + prepaid');
    await settings.set('pay_rules_enabled', '1');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  fs.rmSync(copy, { force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
