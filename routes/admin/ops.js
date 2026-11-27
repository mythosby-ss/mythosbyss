// Admin > Settings > Ops & owner emails: turn the owner emails on/off, send test emails, and download the ops data CSVs.
const router = require('express').Router();
const db = require('../../lib/db');
const settings = require('../../lib/settings');
const mailer = require('../../lib/mailer');
const ownerMail = require('../../lib/owner-mail');
const opsexport = require('../../lib/opsexport');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/settings/ops', async (req, res) => {
  const logs = await db.q("SELECT template, status, error, payload, created_at FROM notification_logs WHERE template LIKE 'owner_%' ORDER BY id DESC LIMIT 15");
  res.render('admin/settings-ops', { title: 'Ops & owner emails', s: settings.all(), smtp: mailer.configured(), to: ownerMail.recipient(), logs, exportNames: opsexport.NAMES, cron: Boolean(process.env.CRON_SECRET) });
});

router.post('/settings/ops', async (req, res) => {
  const b = req.body;
  const email = String(b.owner_email || '').trim().slice(0, 120);
  if (email && !EMAIL.test(email)) { res.flash('Enter a valid email address (or leave it empty to use OWNER_EMAIL from .env).', 'err'); return res.redirect('/admin/settings/ops'); }
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.daily_report_time || '')) ? b.daily_report_time : '22:00';
  await settings.set('owner_email', email);
  await settings.set('daily_report_time', time);
  await settings.set('owner_email_new_order', b.owner_email_new_order ? '1' : '0');
  await settings.set('owner_email_daily', b.owner_email_daily ? '1' : '0');
  res.flash('Saved.'); res.redirect('/admin/settings/ops');
});

router.post('/settings/ops/test/:kind', async (req, res) => {
  const kind = req.params.kind === 'daily' ? 'daily' : 'order';
  const r = await ownerMail.sendTest(kind);
  res.flash(r.ok ? `Test ${kind === 'daily' ? 'daily report' : 'new-order email'} sent to ${ownerMail.recipient()}.` : `Not sent: ${r.error}`, r.ok ? 'ok' : 'err');
  res.redirect('/admin/settings/ops');
});

router.get('/ops/export/:name.csv', async (req, res, next) => {
  try {
    if (!opsexport.NAMES.includes(req.params.name)) return next();
    const days = Math.min(730, Math.max(1, Number(req.query.days) || 180));
    const body = await opsexport.csv(req.params.name, { days });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${req.params.name}.csv"`, 'Cache-Control': 'no-store' });
    res.send(body);
  } catch (e) { next(e); }
});

module.exports = router;
