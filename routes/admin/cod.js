// Admin > Settings > COD & RTO rules: prepaid discount, partial COD, COD limits, pincode rules, phone blacklist.
const router = require('express').Router();
const db = require('../../lib/db');
const settings = require('../../lib/settings');
const { isValidPincode } = require('../../lib/validate');

const money = (v) => String(Math.max(0, Math.round(Number(v) || 0)));
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);
const kg = (v) => String(Math.max(0, Math.round((Number(v) || 0) * 100) / 100));

router.get('/settings/cod', async (req, res, next) => {
  try {
    const q = String(req.query.pin || '').replace(/\D/g, '').slice(0, 6);
    const pinWhere = q ? 'WHERE pincode LIKE ?' : ''; const pinArgs = q ? [q + '%'] : [];
    const pins = await db.q(`SELECT * FROM pincodes ${pinWhere} ORDER BY updated_at DESC LIMIT 300`, pinArgs);
    const pinCounts = await db.one('SELECT COUNT(*) total, SUM(cod_blocked=1) cod_blocked, SUM(serviceable=0) not_serviceable, SUM(serviceable=1) serviceable FROM pincodes');
    const phones = await db.q(`SELECT r.*, (SELECT COUNT(*) FROM orders o WHERE o.phone=r.phone AND o.status='rto') rto,
      (SELECT COUNT(*) FROM orders o WHERE o.phone=r.phone) orders FROM phone_rules r ORDER BY r.created_at DESC LIMIT 300`);
    const rtoPhones = await db.q(`SELECT phone, MAX(name) name, SUM(status='rto') rto, COUNT(*) orders FROM orders
      GROUP BY phone HAVING SUM(status='rto') > 0 ORDER BY rto DESC, orders DESC LIMIT 50`);
    res.render('admin/settings-cod', { title: 'COD & RTO rules', s: settings.all(), pins, pinCounts, pinQuery: q, phones, rtoPhones });
  } catch (e) { next(e); }
});

router.post('/settings/cod', async (req, res) => {
  const b = req.body;
  const vals = {
    prepaid_discount: money(b.prepaid_discount),
    partial_cod_enabled: b.partial_cod_enabled ? '1' : '0',
    partial_cod_type: pick(b.partial_cod_type, ['fixed', 'percent'], 'fixed'),
    partial_cod_amount: String(Math.max(1, Number(money(b.partial_cod_amount)) || 99)),
    partial_cod_percent: String(Math.min(90, Math.max(5, Number(b.partial_cod_percent) || 20))),
    default_payment_method: pick(b.default_payment_method, ['partial_cod', 'prepaid', 'cod'], 'partial_cod'),
    cod_enabled: b.cod_enabled ? '1' : '0',
    cod_min_order: money(b.cod_min_order),
    cod_max_order: money(b.cod_max_order),
    cod_fee: money(b.cod_fee),
    pincode_mode: pick(b.pincode_mode, ['all', 'list'], 'all'),
    rto_block_threshold: String(Math.max(0, parseInt(b.rto_block_threshold, 10) || 0)),
    risk_allow_partial: b.risk_allow_partial ? '1' : '0',
    pay_rules_enabled: b.pay_rules_enabled ? '1' : '0',
    pay_rule_cod_below_total: money(b.pay_rule_cod_below_total),
    pay_rule_cod_max_weight: kg(b.pay_rule_cod_max_weight),
    pay_rule_mid_max_total: money(b.pay_rule_mid_max_total),
    pay_rule_mid_max_weight: kg(b.pay_rule_mid_max_weight),
    pay_rule_mid_advance: String(Math.max(1, Number(money(b.pay_rule_mid_advance)) || 199)),
    pay_rule_high_partial: b.pay_rule_high_partial ? '1' : '0',
    pay_rule_high_advance_table: String(b.pay_rule_high_advance_table || '').split(',').map((x) => x.split(':').map((y) => Number(String(y).trim())))
      .filter(([w, a]) => w > 0 && a > 0).map(([w, a]) => `${w}:${Math.round(a)}`).join(', '),
    pay_rule_prepaid_only_weight: kg(b.pay_rule_prepaid_only_weight),
    default_weight_kg: kg(b.default_weight_kg),
    address_require_landmark: b.address_require_landmark ? '1' : '0',
    delivery_days_text: String(b.delivery_days_text || '').trim().slice(0, 60) || '4-8 working days',
    confirm_autocancel_hours: String(Math.max(0, parseInt(b.confirm_autocancel_hours, 10) || 0)),
    confirm_message: String(b.confirm_message || '').replace(/\r/g, '').trim().slice(0, 1000) || settings.get('confirm_message')
  };
  for (const [k, v] of Object.entries(vals)) await settings.set(k, v);
  const warn = [];
  if (Number(vals.pay_rule_cod_below_total) > Number(vals.pay_rule_mid_max_total)) warn.push('the full-COD total is higher than the partial-COD total');
  if (Number(vals.pay_rule_cod_max_weight) > Number(vals.pay_rule_mid_max_weight) || (Number(vals.pay_rule_prepaid_only_weight) && Number(vals.pay_rule_mid_max_weight) > Number(vals.pay_rule_prepaid_only_weight))) warn.push('the weights should go up: full COD ≤ partial COD ≤ prepaid-only');
  if (warn.length) res.flash(`Saved, but check the cart rules: ${warn.join('; ')}.`, 'err'); else
  if (Number(vals.cod_max_order) && Number(vals.cod_min_order) > Number(vals.cod_max_order)) res.flash('Saved, but the COD minimum is higher than the maximum, so full COD will never be offered.', 'err');
  else res.flash('COD & RTO rules saved. They apply to new checkouts immediately.');
  res.redirect('/admin/settings/cod');
});

// Bulk pincode actions: paste pincodes separated by commas, spaces or new lines
const PIN_ACTIONS = {
  block_cod: ['INSERT INTO pincodes(pincode,serviceable,cod_blocked,note,updated_at) VALUES(?,1,1,?,?) ON CONFLICT(pincode) DO UPDATE SET cod_blocked=1, note=COALESCE(NULLIF(excluded.note,\'\'),note), updated_at=excluded.updated_at', 'COD blocked'],
  unblock_cod: ['UPDATE pincodes SET cod_blocked=0, updated_at=? WHERE pincode=?', 'COD allowed again'],
  serviceable: ['INSERT INTO pincodes(pincode,serviceable,cod_blocked,note,updated_at) VALUES(?,1,0,?,?) ON CONFLICT(pincode) DO UPDATE SET serviceable=1, note=COALESCE(NULLIF(excluded.note,\'\'),note), updated_at=excluded.updated_at', 'marked serviceable'],
  not_serviceable: ['INSERT INTO pincodes(pincode,serviceable,cod_blocked,note,updated_at) VALUES(?,0,0,?,?) ON CONFLICT(pincode) DO UPDATE SET serviceable=0, note=COALESCE(NULLIF(excluded.note,\'\'),note), updated_at=excluded.updated_at', 'marked not serviceable'],
  remove: ['DELETE FROM pincodes WHERE pincode=?', 'removed from the list']
};
router.post('/settings/cod/pincodes', async (req, res) => {
  const action = PIN_ACTIONS[req.body.action] ? req.body.action : null;
  const list = [...new Set(String(req.body.pincodes || '').split(/[^0-9]+/).filter(Boolean))];
  const good = list.filter(isValidPincode); const bad = list.filter((p) => !isValidPincode(p));
  if (!action || !good.length) { res.flash('Enter one or more valid 6-digit pincodes and choose an action.', 'err'); return res.redirect('/admin/settings/cod#pincodes'); }
  const note = String(req.body.note || '').trim().slice(0, 120); const now = db.nowIso();
  const [sql, label] = PIN_ACTIONS[action];
  const args = (p) => (action === 'remove' ? [p] : action === 'unblock_cod' ? [now, p] : [p, note, now]);
  for (let i = 0; i < good.length; i += 200) await db.batch(good.slice(i, i + 200).map((p) => [sql, args(p)]));
  res.flash(`${good.length} pincode(s) ${label}.${bad.length ? ` Skipped invalid: ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? '...' : ''}` : ''}`, bad.length ? 'err' : 'ok');
  res.redirect('/admin/settings/cod#pincodes');
});

// Phone COD blacklist
router.post('/settings/cod/phones', async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) { res.flash('Enter a valid 10-digit mobile number.', 'err'); return res.redirect('/admin/settings/cod#phones'); }
  if (req.body.remove) {
    await db.run('DELETE FROM phone_rules WHERE phone=?', [phone]);
    res.flash(`${phone} removed from the COD blacklist.`);
  } else {
    await db.run('INSERT INTO phone_rules(phone,cod_blocked,note,created_at) VALUES(?,1,?,?) ON CONFLICT(phone) DO UPDATE SET cod_blocked=1, note=excluded.note',
      [phone, String(req.body.note || '').trim().slice(0, 120), db.nowIso()]);
    res.flash(`${phone} can no longer use full COD${settings.on('risk_allow_partial') ? ' (partial COD and prepaid still allowed)' : ' (prepaid only)'}.`);
  }
  res.redirect('/admin/settings/cod#phones');
});

// Admin > Settings > Shipping & NDR
router.get('/settings/shipping', (req, res) => {
  const shipping = require('../../lib/shipping');
  res.render('admin/settings-shipping', { title: 'Shipping & NDR', s: settings.all(), provider: shipping.get(), providers: Object.values(shipping.providers),
    webhook: { ready: Boolean(process.env.SHIPPING_WEBHOOK_SECRET), url: (process.env.SITE_URL || '').replace(/\/$/, '') + '/webhooks/shipping' } });
});
router.post('/settings/shipping', async (req, res) => {
  const names = String(req.body.courier_names || '').split(',').map((c) => c.trim().slice(0, 40)).filter(Boolean).slice(0, 20).join(', ');
  await settings.set('courier_names', names);
  const msg = String(req.body.ndr_message || '').replace(/\r/g, '').trim().slice(0, 1000);
  if (msg) await settings.set('ndr_message', msg);
  res.flash('Shipping settings saved.'); res.redirect('/admin/settings/shipping');
});

module.exports = router;
