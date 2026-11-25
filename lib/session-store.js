// express-session store backed by the same libSQL database (survives restarts and deploys).
// Speed: "touch" (sent on every request that didn't change the session) only bumps the expiry, and at most once
// an hour per session, instead of rewriting the whole session row on every page view.
const session = require('express-session');
const db = require('./db');
const TOUCH_EVERY = 60 * 60 * 1000;
const touched = new Map(); // sid -> last time the expiry was written
class DbStore extends session.Store {
  get(sid, cb) {
    db.one('SELECT data, expires FROM sessions WHERE sid=?', [sid])
      .then((r) => cb(null, r && r.expires > Date.now() ? JSON.parse(r.data) : null)).catch(cb);
  }
  set(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5 * 7;
    touched.set(sid, Date.now());
    db.run('INSERT INTO sessions(sid,data,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires',
      [sid, JSON.stringify(sess), exp]).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) { touched.delete(sid); db.run('DELETE FROM sessions WHERE sid=?', [sid]).then(() => cb && cb(null)).catch((e) => cb && cb(e)); }
  touch(sid, sess, cb) {
    if (Date.now() - (touched.get(sid) || 0) < TOUCH_EVERY) return cb && cb(null);
    touched.set(sid, Date.now());
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5 * 7;
    db.run('UPDATE sessions SET expires=? WHERE sid=?', [exp, sid]).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
}
setInterval(() => {
  db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {});
  const old = Date.now() - TOUCH_EVERY; for (const [k, t] of touched) if (t < old) touched.delete(k);
}, 36e5).unref();
module.exports = DbStore;
