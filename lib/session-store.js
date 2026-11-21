// express-session store backed by the same libSQL database (survives restarts / serverless).
const session = require('express-session');
const db = require('./db');
class DbStore extends session.Store {
  get(sid, cb) {
    db.one('SELECT data, expires FROM sessions WHERE sid=?', [sid])
      .then((r) => cb(null, r && r.expires > Date.now() ? JSON.parse(r.data) : null)).catch(cb);
  }
  set(sid, sess, cb) {
    const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 864e5 * 7;
    db.run('INSERT INTO sessions(sid,data,expires) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires',
      [sid, JSON.stringify(sess), exp]).then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  destroy(sid, cb) { db.run('DELETE FROM sessions WHERE sid=?', [sid]).then(() => cb && cb(null)).catch((e) => cb && cb(e)); }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
setInterval(() => db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]).catch(() => {}), 36e5).unref();
module.exports = DbStore;
