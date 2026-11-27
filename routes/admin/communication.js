const router = require('express').Router();
const db = require('../../lib/db');
const wa = require('../../lib/whatsapp');
const settings = require('../../lib/settings');
const notify = require('../../lib/notify');

const TEMPLATES = [
  { key: 'otp', category: 'AUTHENTICATION', purpose: 'Login code (copy-code button)', params: '{{1}} code' },
  { key: 'confirmed', category: 'UTILITY', purpose: 'Order confirmation', params: '{{1}} name, {{2}} order ID, {{3}} items, {{4}} qty, {{5}} total, {{6}} payment' },
  { key: 'shipped', category: 'UTILITY', purpose: 'Order shipped (+ Track button)', params: '{{1}} name, {{2}} order ID, {{3}} courier, {{4}} AWB; button suffix = order ID' },
  { key: 'out_for_delivery', category: 'UTILITY', purpose: 'Out for delivery', params: '{{1}} name, {{2}} order ID, {{3}} payment note' },
  { key: 'delivered', category: 'UTILITY', purpose: 'Delivered', params: '{{1}} name, {{2}} order ID' },
  { key: 'review', category: 'MARKETING', purpose: 'Thank-you + product image + review link', params: 'IMAGE header, {{1}} name, {{2}} product; button suffix = review token' }
];

router.get('/communication', async (req, res) => {
  const status = req.query.status || ''; const tpl = req.query.template || '';
  const where = ["template NOT LIKE '%otp%'"]; const args = [];
  if (status) { where.push('status=?'); args.push(status); } if (tpl) { where.push('template=?'); args.push(tpl); }
  const logs = await db.q(`SELECT * FROM notification_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`, args);
  const stats = await db.q("SELECT status, COUNT(*) n FROM notification_logs GROUP BY status");
  res.render('admin/communication', { title: 'Communication', configured: wa.configured(), enabled: wa.enabled(), templates: TEMPLATES.map((t) => ({ ...t, name: wa.T[t.key] })), logs, stats, f: { status, template: tpl }, rt: { site: process.env.SITE_URL || '' } });
});
router.post('/communication/toggle', async (req, res) => { await settings.set('whatsapp_enabled', req.body.enabled ? '1' : '0'); res.redirect('/admin/communication'); });
router.post('/communication/test', async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) { res.flash('Enter a valid 10-digit number.', 'err'); return res.redirect('/admin/communication'); }
  const r = await wa.sendAndLog({ phone, template: wa.T.delivered, body: ['Test', 'MBTEST123'] });
  res.flash(r.ok ? (r.simulated ? 'WhatsApp is not configured, so the message was only logged (simulated).' : 'Test message sent.') : `Failed: ${r.error}`, r.ok ? 'ok' : 'err');
  res.redirect('/admin/communication');
});
router.post('/communication/run-queue', async (req, res) => { await notify.processQueue(); res.flash('Scheduled messages processed.'); res.redirect('/admin/communication'); });

const FIELDS = ['store_name', 'announcement', 'support_email', 'shipping_fee', 'gst_percent', 'pg_fee_percent', 'review_delay_hours', 'home_state', 'low_stock_default', 'new_arrivals_min', 'new_arrivals_max', 'new_arrivals_days', 'new_arrivals_banner', 'new_arrivals_banner_sub'];
const NUM = { new_arrivals_min: [1, 24], new_arrivals_max: [1, 48], new_arrivals_days: [7, 365] };
router.get('/settings', (req, res) => res.render('admin/settings', { title: 'Settings', s: settings.all() }));
router.post('/settings', async (req, res) => {
  for (const k of FIELDS) {
    if (req.body[k] === undefined) continue;
    let v = String(req.body[k]).trim().slice(0, 200);
    if (NUM[k]) { const n = Math.round(Number(v)); v = String(Number.isFinite(n) ? Math.min(NUM[k][1], Math.max(NUM[k][0], n)) : settings.get(k)); }
    await settings.set(k, v);
  }
  res.flash('Settings saved.'); res.redirect('/admin/settings');
});
module.exports = router;
