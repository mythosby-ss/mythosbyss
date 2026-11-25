// Load-test server: the real app, but SAFE to hammer.
//  - Runs on a COPY of a local SQLite database (never Turso / production). Refuses to start otherwise.
//  - Every outgoing network call is blocked: Razorpay is stubbed, Meta CAPI / WhatsApp / Google Drive fetches are refused.
//  - Login OTP uses a fixed code (no SMS / WhatsApp), so virtual users can log in.
//  - Logs event-loop delay, memory and database query count/time every 10 s.
//
// Usage: node scripts/loadtest/server.js --db data/mythosbyss.db [--port 4100] [--db-latency 0]
//   --db-latency N   add N ms to every DB query, to imitate a remote database (e.g. Turso) — optional
const fs = require('fs');
const os = require('os');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '..', '..');
const src = path.resolve(arg('db', path.join(ROOT, 'data', 'mythosbyss.db')));
if (!fs.existsSync(src)) { console.error('Database file not found:', src); process.exit(1); }
const copy = path.join(os.tmpdir(), `mythosbyss-loadtest-${Date.now()}.db`);
fs.copyFileSync(src, copy);
const latency = Number(arg('db-latency', 0)) || 0;

// Environment: production mode, local DB copy only, no third-party credentials at all
Object.assign(process.env, {
  NODE_ENV: 'production', PORT: arg('port', '4100'), SESSION_SECRET: 'loadtest-only-secret', SITE_URL: 'http://localhost:' + arg('port', '4100'),
  DB_URL: 'file:' + copy, TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', DB_TOKEN: '',
  RAZORPAY_KEY_ID: 'rzp_test_loadtest', RAZORPAY_KEY_SECRET: 'loadtest', RAZORPAY_WEBHOOK_SECRET: '',
  WHATSAPP_TOKEN: '', WHATSAPP_PHONE_ID: '', META_CAPI_TOKEN: '', META_PIXEL_ID: '', META_TEST_EVENT_CODE: '', GA4_API_SECRET: '',
  GOOGLE_SERVICE_ACCOUNT_JSON: '', DRIVE_API_KEY: '', SHIPPING_PROVIDER: 'manual', OTP_PROVIDER: 'whatsapp'
});
require('dotenv').config = () => ({}); // do not let the real .env override the safe values above

// Block every outgoing HTTP call
const realFetch = global.fetch;
global.fetch = (url, opts) => {
  const u = new URL(String(url));
  if (['localhost', '127.0.0.1'].includes(u.hostname)) return realFetch(url, opts);
  return Promise.reject(new Error(`[loadtest] outgoing call blocked: ${u.hostname}`));
};
const stub = (rel, exports) => { const p = require.resolve(path.join(ROOT, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub('lib/razorpay.js', { enabled: () => true, get: () => ({ orders: { create: async (o) => ({ id: 'order_LOADTEST' + Date.now(), amount: o.amount }) }, payments: { refund: async () => ({ id: 'rfnd_LOADTEST' }) } }) });
stub('lib/otp.js', { provider: () => ({ name: 'loadtest', newCode: () => '123456', send: async () => ({ ok: true, simulated: true }) }) });

// DB instrumentation (+ optional artificial latency)
const db = require(path.join(ROOT, 'lib', 'db'));
if (!String(process.env.DB_URL).startsWith('file:')) { console.error('Refusing: not a local file database.'); process.exit(1); }
const stats = { queries: 0, ms: 0 };
const exec = db.client.execute.bind(db.client);
db.client.execute = async (q) => { const t = performance.now(); if (latency) await new Promise((r) => setTimeout(r, latency)); try { return await exec(q); } finally { stats.queries++; stats.ms += performance.now() - t; } };
const batch = db.client.batch.bind(db.client);
db.client.batch = async (...a) => { const t = performance.now(); if (latency) await new Promise((r) => setTimeout(r, latency)); try { return await batch(...a); } finally { stats.queries++; stats.ms += performance.now() - t; } };

const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
setInterval(() => {
  const m = process.memoryUsage();
  console.log(`[monitor] loop p99 ${(loop.percentile(99) / 1e6).toFixed(0)}ms max ${(loop.max / 1e6).toFixed(0)}ms | heap ${(m.heapUsed / 1048576).toFixed(0)}MB rss ${(m.rss / 1048576).toFixed(0)}MB | db ${stats.queries} queries/10s, avg ${(stats.ms / Math.max(1, stats.queries)).toFixed(1)}ms`);
  loop.reset(); stats.queries = 0; stats.ms = 0;
}, 10000).unref();

process.on('exit', () => { try { fs.unlinkSync(copy); } catch (_) {} });
process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
console.log(`[loadtest] DB copy: ${copy}${latency ? ` | +${latency}ms per query` : ''} | all outgoing calls blocked`);
require(path.join(ROOT, 'server.js'));
