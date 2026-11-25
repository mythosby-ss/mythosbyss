// Load test: virtual users doing  home -> product -> add to cart -> checkout -> (OTP login) -> checkout page.
// No order is ever placed and no payment is started. Dependency-free (Node 18+).
//
// SAFETY: only runs against localhost, unless you name a staging host explicitly with LOADTEST_ALLOW_HOST.
//         It refuses mythosbyss.com in any case. Start the safe server first: node scripts/loadtest/server.js
//
// Usage: node scripts/loadtest/run.js [--url http://localhost:4100] [--stages 30s:100,120s:100,30s:200,300s:200] [--think 1-3]
//   stages: "duration:users" steps; users ramp linearly to the target during each step
//   think:  seconds a user waits between steps (random in the range); 0 = no waiting (stress)
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:4100').replace(/\/$/, '');
const host = new URL(BASE).hostname;
if (/mythosbyss\.com$/i.test(host) || !(['localhost', '127.0.0.1'].includes(host) || host === process.env.LOADTEST_ALLOW_HOST)) {
  console.error(`Refusing to load-test "${host}". Only localhost, or a staging host set in LOADTEST_ALLOW_HOST (never the live site).`); process.exit(1);
}
const stages = arg('stages', '30s:100,120s:100,30s:200,300s:200').split(',').map((s) => { const [d, u] = s.split(':'); return { ms: parseFloat(d) * (d.endsWith('m') ? 60000 : 1000), users: Number(u) }; });
const [thinkMin, thinkMax = thinkMin] = arg('think', '1-3').split('-').map(Number);
const think = () => new Promise((r) => setTimeout(r, (thinkMin + Math.random() * (thinkMax - thinkMin)) * 1000));

// ---- results ----
const results = []; // { t, step, ms, ok, users }
let activeUsers = 0; const t0 = Date.now();
const record = (step, ms, ok, status) => results.push({ t: Date.now() - t0, step, ms, ok, status, users: activeUsers });

// ---- one virtual user = one browser (cookie jar, own IP for rate limits) ----
let seq = 0;
async function visit(vu) {
  const jar = {}; const ip = `10.${(vu >> 8) & 255}.${vu & 255}.${(seq++ % 250) + 1}`;
  const phone = String(7000000000 + Math.floor(Math.random() * 2999999999)).slice(0, 10).replace(/^[0-5]/, '7');
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(step, method, path, { body, json, expect = [200] } = {}) {
    const headers = { 'x-forwarded-for': ip, 'x-forwarded-proto': 'https', 'user-agent': 'mythosbyss-loadtest', cookie: cookie(), accept: json ? 'application/json' : 'text/html' };
    if (body) { headers['content-type'] = 'application/json'; if (jar.csrf) headers['x-csrf-token'] = jar.csrf; }
    const t = performance.now();
    try {
      const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
      const text = await r.text(); const ms = performance.now() - t;
      const m = text.match(/name="csrf-token" content="([a-f0-9]+)"/); if (m) jar.csrf = m[1];
      const ok = expect.includes(r.status); record(step, ms, ok, r.status);
      return { ok, status: r.status, text };
    } catch (e) { record(step, performance.now() - t, false, e.name === 'TimeoutError' ? 'timeout' : 'neterr'); return { ok: false }; }
  }
  const home = await req('home', 'GET', '/'); if (!home.ok) return;
  const slugs = [...new Set([...home.text.matchAll(/href="\/products\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
  await think();
  const slug = slugs[Math.floor(Math.random() * slugs.length)] || 'genius-pencil-box';
  const prod = await req('product', 'GET', `/products/${slug}`); if (!prod.ok) return;
  const sku = ((prod.text.match(/name="sku" value="([^"]+)"/) || [])[1]);
  await think();
  if (!(await req('add_to_cart', 'POST', '/cart/add', { body: { slug, sku, qty: 1 }, json: true })).ok) return;
  await think();
  await req('checkout_redirect', 'GET', '/checkout', { expect: [302] }); // not logged in yet -> /login
  await req('login_page', 'GET', '/login?next=/checkout');
  await think();
  if (!(await req('otp_request', 'POST', '/login/request', { body: { phone }, json: true })).ok) return;
  await think();
  const v = await req('otp_verify', 'POST', '/login/verify', { body: { phone, otp: '123456', name: 'Load Test', next: '/checkout' }, json: true });
  if (!v.ok) return; try { jar.csrf = JSON.parse(v.text).csrf || jar.csrf; } catch (_) {}
  await req('checkout', 'GET', '/checkout');
  await think();
}

// ---- scheduler: keep N virtual users looping ----
let target = 0; let nextId = 0; const running = new Set();
function spawn() { const id = nextId++; running.add(id); activeUsers = running.size; (async () => { while (running.has(id)) { await visit(id); if (id >= target) break; } running.delete(id); activeUsers = running.size; })(); }
const total = stages.reduce((s, x) => s + x.ms, 0);
const timer = setInterval(() => {
  const el = Date.now() - t0; let acc = 0; let prev = 0; target = 0;
  for (const s of stages) { if (el < acc + s.ms) { target = Math.round(prev + (s.users - prev) * ((el - acc) / s.ms)); break; } acc += s.ms; prev = s.users; target = s.users; }
  while (running.size < target) spawn();
  for (const id of [...running]) if (running.size > target && id >= target) running.delete(id);
}, 250);
const progress = setInterval(() => { const last = results.filter((r) => r.t > Date.now() - t0 - 10000); const err = last.filter((r) => !r.ok).length; process.stdout.write(`[${Math.round((Date.now() - t0) / 1000)}s] users ${activeUsers} | ${(last.length / 10).toFixed(1)} req/s | errors ${err}\n`); }, 10000);

setTimeout(() => { clearInterval(timer); clearInterval(progress); running.clear(); setTimeout(report, 3000); }, total);

// ---- report ----
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
function table(rows, label) {
  console.log(`\n=== ${label}: ${rows.length} requests, ${(rows.filter((r) => !r.ok).length / Math.max(1, rows.length) * 100).toFixed(2)}% errors ===`);
  console.log('step                count     p50     p95     p99   errors');
  const steps = [...new Set(rows.map((r) => r.step))];
  for (const s of steps) { const x = rows.filter((r) => r.step === s); const ms = x.map((r) => r.ms); const e = x.filter((r) => !r.ok);
    console.log(`${s.padEnd(18)} ${String(x.length).padStart(6)} ${pct(ms, 50).toFixed(0).padStart(6)}ms ${pct(ms, 95).toFixed(0).padStart(6)}ms ${pct(ms, 99).toFixed(0).padStart(6)}ms   ${e.length}${e.length ? ' (' + [...new Set(e.map((r) => r.status))].join(',') + ')' : ''}`); }
  const pages = rows.filter((r) => r.step !== 'checkout').map((r) => r.ms); const co = rows.filter((r) => r.step === 'checkout').map((r) => r.ms);
  console.log(`PAGES p95 ${pct(pages, 95).toFixed(0)}ms (target < 1000) | CHECKOUT p95 ${pct(co, 95).toFixed(0)}ms (target < 2000)`);
}
function report() {
  // steady-state windows: the last step of each "hold" stage
  let acc = 0; const windows = [];
  stages.forEach((s, i) => { if (i && s.users === stages[i - 1].users) windows.push({ from: acc, to: acc + s.ms, users: s.users }); acc += s.ms; });
  for (const w of windows) table(results.filter((r) => r.t >= w.from && r.t < w.to), `steady ${w.users} users`);
  table(results, 'whole run');
  process.exit(0);
}
