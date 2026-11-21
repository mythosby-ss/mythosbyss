const crypto = require('crypto');

module.exports = function verifyCsrf(req, res, next) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const expected = req.session.csrf || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ ok: false, message: 'Session expired. Please refresh the page and try again.' });
  }
  next();
};
