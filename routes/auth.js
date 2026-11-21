// Customer login: WhatsApp OTP (no passwords). OTP is delivered with an approved WhatsApp AUTHENTICATION template.
const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../lib/db');
const wa = require('../lib/whatsapp');
const { safeEqual } = require('../lib/orders');

const PHONE = /^[6-9]\d{9}$/;
const OTP_TTL = 5 * 60 * 1000;
const ipLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { ok: false, message: 'Too many attempts. Please try again in a few minutes.' } });
const hash = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${process.env.SESSION_SECRET || 'dev'}`).digest('hex');
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/account');

router.get('/login', (req, res) => {
  if (res.locals.customer) return res.redirect(safeNext(req.query.next));
  res.render('login', { pageTitle: 'Log in | MythosBySS', noindex: true, next: safeNext(req.query.next) });
});

router.post('/login/request', ipLimit, async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!PHONE.test(phone)) return res.status(422).json({ ok: false, message: 'Enter a valid 10-digit WhatsApp number.' });
    const c = await db.one('SELECT blocked FROM customers WHERE phone=?', [phone]);
    if (c && c.blocked) return res.status(403).json({ ok: false, message: 'This number cannot place orders. Please contact support.' });
    const recent = await db.val('SELECT COUNT(*) FROM otp_codes WHERE phone=? AND created_at > ?', [phone, Date.now() - 15 * 60 * 1000]);
    if (recent >= 3) return res.status(429).json({ ok: false, message: 'Too many codes requested. Please wait 15 minutes.' });
    const code = String(crypto.randomInt(100000, 1000000));
    await db.run('INSERT INTO otp_codes(phone,code_hash,expires_at,created_at) VALUES(?,?,?,?)', [phone, hash(phone, code), Date.now() + OTP_TTL, Date.now()]);
    const r = await wa.sendAndLog({ phone, template: wa.T.otp, body: [code], urlSuffix: code, otp: code });
    if (!r.ok) return res.status(502).json({ ok: false, message: 'We could not send the WhatsApp code right now. Please try again.' });
    const dev = r.simulated && process.env.NODE_ENV !== 'production';
    res.json({ ok: true, message: 'We sent a 6-digit code to your WhatsApp.', devOtp: dev ? code : undefined });
  } catch (e) { next(e); }
});

router.post('/login/verify', ipLimit, async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    const otp = String(req.body.otp || '').trim();
    const row = await db.one('SELECT * FROM otp_codes WHERE phone=? AND used=0 ORDER BY id DESC LIMIT 1', [phone]);
    if (!row || row.expires_at < Date.now()) return res.status(400).json({ ok: false, message: 'This code has expired. Please request a new one.' });
    if (row.attempts >= 5) return res.status(429).json({ ok: false, message: 'Too many wrong attempts. Please request a new code.' });
    await db.run('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?', [row.id]);
    if (!safeEqual(hash(phone, otp), row.code_hash)) return res.status(400).json({ ok: false, message: 'That code is not correct.' });
    await db.run('UPDATE otp_codes SET used=1 WHERE id=?', [row.id]);

    const now = db.nowIso();
    const name = String(req.body.name || '').trim().slice(0, 80);
    let c = await db.one('SELECT * FROM customers WHERE phone=?', [phone]);
    if (!c) { const r = await db.run('INSERT INTO customers(phone,name,created_at,last_login) VALUES(?,?,?,?)', [phone, name || null, now, now]); c = { id: r.id }; }
    else await db.run('UPDATE customers SET last_login=?, name=COALESCE(NULLIF(name,\'\'), ?) WHERE id=?', [now, name || null, c.id]);

    const keep = { cart: req.session.cart, buyNow: req.session.buyNow, attr: req.session.attr, coupon: req.session.coupon };
    req.session.regenerate((err) => {
      if (err) return next(err);
      Object.assign(req.session, keep);
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.customerId = c.id;
      req.session.save(() => res.json({ ok: true, redirect: safeNext(req.body.next), csrf: req.session.csrf }));
    });
  } catch (e) { next(e); }
});

router.post('/logout', (req, res) => { req.session.customerId = null; res.redirect('/'); });

module.exports = router;
