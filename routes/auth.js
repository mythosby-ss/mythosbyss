// Customer login: OTP on WhatsApp (no passwords). Browsing is open; login is required before placing an order.
// OTP delivery goes through lib/otp.js (OTP_PROVIDER): WhatsApp in production, a static code in development.
const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../lib/db');
const otpProvider = require('../lib/otp');
const { isValidPhone } = require('../lib/validate');
const { safeEqual } = require('../lib/orders');

const OTP_TTL = 5 * 60 * 1000;
const ipLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { ok: false, message: 'Too many attempts. Please try again in a few minutes.' } });
const hash = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${process.env.SESSION_SECRET || 'dev'}`).digest('hex');
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/account');

router.get('/login', (req, res) => {
  if (res.locals.customer) return res.redirect(safeNext(req.query.next));
  const devCode = otpProvider.provider().name === 'dev' ? otpProvider.provider().newCode() : null;
  res.render('login', { pageTitle: 'Log in | MythosBySS', noindex: true, next: safeNext(req.query.next), devCode });
});

router.post('/login/request', ipLimit, async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    if (!isValidPhone(phone)) return res.status(422).json({ ok: false, message: 'Enter a valid 10-digit WhatsApp number.' });
    const [c, recent] = await Promise.all([ // both checks in parallel (one round trip of waiting instead of two)
      db.one('SELECT blocked FROM customers WHERE phone=?', [phone]),
      db.val('SELECT COUNT(*) FROM otp_codes WHERE phone=? AND created_at > ?', [phone, Date.now() - 15 * 60 * 1000])]);
    if (c && c.blocked) return res.status(403).json({ ok: false, message: 'This number cannot place orders. Please contact support.' });
    if (recent >= 3) return res.status(429).json({ ok: false, message: 'Too many codes requested. Please wait 15 minutes.' });
    const provider = otpProvider.provider();
    const code = provider.newCode();
    await db.run('INSERT INTO otp_codes(phone,code_hash,expires_at,created_at) VALUES(?,?,?,?)', [phone, hash(phone, code), Date.now() + OTP_TTL, Date.now()]);
    const r = await provider.send(phone, code);
    if (!r.ok) { console.error('[otp] send failed:', r.error); return res.status(502).json({ ok: false, message: 'We could not send the code right now. Please try again in a minute.' }); }
    const dev = r.simulated && process.env.NODE_ENV !== 'production';
    res.json({ ok: true, message: dev ? 'Development mode: no message was sent.' : 'We sent a 6-digit code to your WhatsApp.', devOtp: dev ? code : undefined });
  } catch (e) { next(e); }
});

router.post('/login/verify', ipLimit, async (req, res, next) => {
  try {
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    const otp = String(req.body.otp || '').replace(/\D/g, '');
    const row = await db.one('SELECT * FROM otp_codes WHERE phone=? AND used=0 ORDER BY id DESC LIMIT 1', [phone]);
    if (!row || row.expires_at < Date.now()) return res.status(400).json({ ok: false, message: 'This code has expired. Please request a new one.' });
    if (row.attempts >= 5) return res.status(429).json({ ok: false, message: 'Too many wrong attempts. Please request a new code.' });
    const good = safeEqual(hash(phone, otp), row.code_hash);
    await db.run('UPDATE otp_codes SET attempts=attempts+1, used=? WHERE id=?', [good ? 1 : 0, row.id]); // count the attempt (+ mark used) in one write
    if (!good) return res.status(400).json({ ok: false, message: 'That code is not correct.' });

    const now = db.nowIso();
    const name = String(req.body.name || '').trim().slice(0, 80);
    // create or update the customer in one statement
    const c = await db.one(`INSERT INTO customers(phone,name,created_at,last_login) VALUES(?,?,?,?)
      ON CONFLICT(phone) DO UPDATE SET last_login=excluded.last_login, name=COALESCE(NULLIF(customers.name,''), excluded.name) RETURNING id`, [phone, name || null, now, now]);

    const keep = { cart: req.session.cart, buyNow: req.session.buyNow, attr: req.session.attr, coupon: req.session.coupon, fbc: req.session.fbc };
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
