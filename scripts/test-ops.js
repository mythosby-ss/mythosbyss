// Tests for the ops pieces: owner emails (new order + daily report), "returned" status, ops CSV export, logistics escalation.
// SAFE: temporary COPY of data/mythosbyss.db (never Turso / production), .env ignored, all network calls blocked,
// emails rendered to JSON only (MAIL_TRANSPORT=json) - nothing is sent to anyone.
//   node scripts/test-ops.js      (or: npm run test:ops)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'data', 'mythosbyss.db');
if (!fs.existsSync(src)) { console.error('Needs a local database at data/mythosbyss.db'); process.exit(1); }
const copy = path.join(os.tmpdir(), `mythosbyss-opstest-${Date.now()}.db`);
fs.copyFileSync(src, copy);
Object.assign(process.env, { NODE_ENV: 'test', DB_URL: 'file:' + copy, DB_TOKEN: '', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', MAIL_TRANSPORT: 'json', OWNER_EMAIL: '', SMTP_HOST: '', SITE_URL: 'https://example.test' });
require('dotenv').config = () => ({});
global.fetch = () => Promise.reject(new Error('network blocked in tests'));

const db = require('../lib/db');
const settings = require('../lib/settings');
const orders = require('../lib/orders');
const ownerMail = require('../lib/owner-mail');
const opsexport = require('../lib/opsexport');
const { parse } = require('../lib/opscsv');
const esc = require('../lib/ops-escalation');

let pass = 0; let fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', e.message); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date().toISOString(); const yday = new Date(Date.now() - 864e5).toISOString();
const logs = (tpl) => db.q('SELECT * FROM notification_logs WHERE template=? ORDER BY id', [tpl]);

async function order(id, f) {
  const o = { status: 'confirmed', payment_method: 'prepaid', payment_status: 'paid', total: 1000, pay_now: 0, due_on_delivery: 0, created_at: now, name: 'Test Customer', phone: '9000000001',
    address: 'Flat 1, Test Road, Landmark: Near Test Temple', city: 'Testpur', state: 'Delhi', pincode: '110001', ...f };
  const cols = Object.keys(o);
  await db.run(`INSERT INTO orders(id,${cols.join(',')},updated_at) VALUES(?,${cols.map(() => '?').join(',')},?)`, [id, ...Object.values(o), now]);
  await db.run('INSERT INTO order_items(order_id,product_slug,product_name,variant_label,qty,unit_price) VALUES(?,?,?,?,?,?)', [id, 'test-tawa', 'Test Tawa', '', 1, o.total]);
}

(async () => {
  await require('../lib/seed')();
  await settings.load();
  for (const tb of ['orders', 'order_items', 'refunds', 'notification_logs', 'daily_ad_spend', 'ad_metrics']) await db.run(`DELETE FROM ${tb}`);
  await settings.set('owner_email', 'owner@example.test');
  ownerMail.RETRY_MS.splice(0, 3, 0, 5, 5); // fast retries in tests

  await order('T1', { payment_method: 'prepaid', total: 1000, pay_now: 1000 });
  await order('T2', { payment_method: 'partial_cod', payment_status: 'advance_paid', total: 900, pay_now: 199, due_on_delivery: 701 });
  await order('T3', { payment_method: 'cod', status: 'pending_confirmation', payment_status: 'cod_pending', total: 500, due_on_delivery: 500 });
  await order('T4', { status: 'awaiting_payment', payment_status: 'pending', total: 700 }); // unpaid attempt: not an order
  await order('T5', { status: 'cancelled', payment_status: 'failed', total: 650 }); // failed payment: not an order
  await order('T6', { status: 'delivered', created_at: yday, delivered_at: now, total: 800, courier: 'Delhivery', awb: 'AWB6' });
  await order('T7', { status: 'rto', created_at: yday, cancelled_at: now, total: 1200, courier_charge: 60, rto_charge: 60, courier: 'Delhivery', awb: 'AWB7', ndr_count: 2, ndr_reason: 'Customer not available' });
  await order('T8', { status: 'rto', created_at: yday, cancelled_at: now, total: 600, courier_charge: 50, awb: 'AWB8' }); // RTO charge not entered yet
  await order('T9', { status: 'returned', created_at: yday, delivered_at: yday, returned_at: now, total: 500, reverse_pickup_charge: 80, awb: 'AWB9' });
  await db.run('INSERT INTO refunds(order_id,amount,reason,method,status,created_at) VALUES(?,?,?,?,?,?)', ['T9', 500, 'return', 'manual', 'processed', now]);
  await order('T10', { status: 'shipped', created_at: yday, awb: 'AWB10' });
  await order('T11', { status: 'ndr', created_at: yday, awb: 'AWB11' });

  console.log('\nA. New-order email');
  await t('off by default: no email', async () => {
    assert.strictEqual(settings.get('owner_email_new_order'), '0');
    ownerMail.newOrder('T3'); await wait(50); assert.strictEqual((await logs('owner_new_order')).length, 0);
  });
  await t('on: returns instantly (does not slow checkout) and sends once in the background', async () => {
    await settings.set('owner_email_new_order', '1');
    const t0 = process.hrtime.bigint(); ownerMail.newOrder('T3'); ownerMail.newOrder('T3');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6; assert.ok(ms < 5, `took ${ms} ms`);
    await wait(150); ownerMail.newOrder('T3'); await wait(150);
    const l = await logs('owner_new_order'); assert.strictEqual(l.length, 1); assert.strictEqual(l[0].status, 'simulated');
  });
  await t('subject, body, payment type; no phone or street address', async () => {
    const o = await db.one("SELECT * FROM orders WHERE id='T2'");
    const m = ownerMail.newOrderMessage(o, [{ product_name: 'Test Tawa', variant_label: '', qty: 2 }]);
    assert.strictEqual(m.subject, 'New order #T2 – Test Tawa – ₹900');
    assert.ok(m.text.startsWith('You have received the order Test Tawa × 2 of ₹900.'), m.text);
    assert.ok(/Partial COD \(advance ₹199 paid, ₹701 on delivery\)/.test(m.text));
    assert.ok(/Testpur, 110001/.test(m.text) && /\/admin\/orders\/T2/.test(m.text));
    assert.ok(!/9000000001|Flat 1|Test Road/.test(m.text + m.html));
  });
  await t('send failure: 3 tries, then logged as failed', async () => {
    process.env.MAIL_TRANSPORT = ''; Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: 'x', SMTP_PASS: 'x' }); require('../lib/mailer')._reset();
    ownerMail.newOrder('T1'); await wait(1500);
    const l = (await logs('owner_new_order')).filter((x) => x.order_id === 'T1');
    assert.strictEqual(l.length, 1); assert.strictEqual(l[0].status, 'failed'); assert.strictEqual(JSON.parse(l[0].payload).try, 3);
    process.env.MAIL_TRANSPORT = 'json'; require('../lib/mailer')._reset();
  });

  console.log('\nB. Daily report');
  const d = await ownerMail.dailyData();
  await t("today's orders exclude unpaid/failed attempts, split by payment type", () => {
    assert.deepStrictEqual([d.orders.n, d.orders.v], [3, 2400]);
    assert.deepStrictEqual([d.orders.prepaid.n, d.orders.partial.n, d.orders.cod.n], [1, 1, 1]);
  });
  await t('delivered today', () => assert.deepStrictEqual([d.delivered.n, d.delivered.v], [1, 800]));
  await t('RTO: count, loss = forward + RTO + COD fee, flags missing charges', () => assert.deepStrictEqual([d.rto.n, d.rto.loss, d.rto.missing], [2, 170, 1]));
  await t('returns: loss = reverse pickup + refunds', () => assert.deepStrictEqual([d.returns.n, d.returns.loss], [1, 580]));
  await t('loss today and month to date', () => { assert.strictEqual(d.lossToday, 750); assert.ok(d.lossMonth >= 750); });
  await t('pending confirmation and in transit', () => assert.deepStrictEqual([d.pending, d.transit], [1, 2]));
  await t('ad spend "not available" when there is no data', () => assert.ok(/Ad spend today: not available/.test(ownerMail.dailyMessage(d).text)));
  await t('ad spend from admin entry when present', async () => {
    await db.run('INSERT INTO daily_ad_spend(day,amount,updated_at) VALUES(?,?,?)', [ownerMail.istDay(), 450, now]);
    const m = ownerMail.dailyMessage(await ownerMail.dailyData()); assert.ok(/Ad spend today: ₹450 \(entered in admin\)/.test(m.text), m.text);
  });
  await t('subject "Mythos daily report – <date>" and charges-missing note', () => {
    const m = ownerMail.dailyMessage(d); assert.ok(/^Mythos daily report – \d{1,2} \w{3} \d{4}$/.test(m.subject), m.subject);
    assert.ok(/charges not entered for 1 order/.test(m.text));
  });
  await t('scheduler: off -> nothing; on -> once per day only', async () => {
    assert.strictEqual((await ownerMail.tick()).skipped, 'off');
    await settings.set('owner_email_daily', '1'); await settings.set('daily_report_time', '00:00'); await settings.set('owner_report_last_day', '');
    const r1 = await ownerMail.tick(); assert.ok(r1.ok, JSON.stringify(r1));
    assert.strictEqual((await ownerMail.tick()).skipped, 'already sent');
    assert.strictEqual(settings.get('owner_report_last_day'), ownerMail.istDay());
    assert.strictEqual((await logs('owner_daily_report')).length, 1);
  });
  await t('scheduler waits until the report time', async () => {
    await settings.set('owner_report_last_day', ''); await settings.set('daily_report_time', '23:59');
    const r = await ownerMail.tick(); const ist = new Date(Date.now() + 330 * 60000);
    if (ist.getUTCHours() * 60 + ist.getUTCMinutes() < 23 * 60 + 59) assert.strictEqual(r.skipped, 'too early');
  });
  await t('test emails work while switched off and are marked [TEST]', async () => {
    await settings.set('owner_email_new_order', '0'); await settings.set('owner_email_daily', '0');
    const a = await ownerMail.sendTest('order'); const b = await ownerMail.sendTest('daily');
    assert.ok(a.ok && b.ok); assert.ok(/\[TEST\] New order #/.test(JSON.parse(a.json).subject)); assert.ok(/\[TEST\] Mythos daily report/.test(JSON.parse(b.json).subject));
  });

  console.log('\nReturned status');
  await t('delivered -> returned sets returned_at', async () => {
    await order('T12', { status: 'delivered', created_at: yday, delivered_at: yday });
    const o = await orders.setStatus('T12', 'returned', { note: 'Customer return' }); assert.strictEqual(o.status, 'returned'); assert.ok(o.returned_at);
  });
  await t('returned is final; shipped cannot jump to returned', async () => {
    await assert.rejects(orders.setStatus('T12', 'delivered')); await assert.rejects(orders.setStatus('T10', 'returned'));
  });

  console.log('\nOps export (columns exactly as ops/README.md)');
  const readme = fs.readFileSync(path.join(ROOT, 'ops', 'README.md'), 'utf8');
  const spec = (file) => readme.split('\n').find((l) => l.startsWith('| `' + file + '`')).split('|')[3].split(',').map((c) => c.trim().replace(/\s*\(.*$/, ''));
  for (const n of ['orders', 'products', 'payments', 'shipments']) {
    await t(`${n}.csv header matches README`, async () => assert.deepStrictEqual((await opsexport.csv(n)).split('\n')[0].split(','), spec(n + '.csv')));
  }
  const rows = parse(await opsexport.csv('orders'));
  const row = (id) => rows.find((r) => r.order_id === id);
  await t('unpaid/failed attempts are left out', () => { assert.ok(!row('T4') && !row('T5')); assert.ok(row('T1') && row('T3')); });
  await t('advance_paid, status mapping, address split', () => {
    assert.strictEqual(row('T2').advance_paid, '199'); assert.strictEqual(row('T3').advance_paid, '0');
    assert.strictEqual(row('T11').status, 'shipped'); assert.strictEqual(row('T9').status, 'returned');
    assert.deepStrictEqual([row('T1').address_line1, row('T1').address_line2, row('T1').landmark], ['Flat 1', 'Test Road', 'Near Test Temple']);
  });
  await t('shipments.csv: attempts, NDR reason, charges (empty = not entered)', async () => {
    const s = parse(await opsexport.csv('shipments')); const r7 = s.find((x) => x.awb === 'AWB7'); const r8 = s.find((x) => x.awb === 'AWB8');
    assert.deepStrictEqual([r7.attempts, r7.ndr_reason, r7.forward_charge, r7.rto_charge], ['2', 'Customer not available', '60', '60']);
    assert.strictEqual(r8.rto_charge, '');
  });
  await t('CSV cells cannot run as spreadsheet formulas', async () => {
    await db.run("UPDATE orders SET name='=HYPERLINK(\"x\")' WHERE id='T1'");
    assert.ok(parse(await opsexport.csv('orders')).find((r) => r.order_id === 'T1').customer_name.startsWith("'="));
  });

  console.log('\nLogistics escalation');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ops-'));
  fs.mkdirSync(path.join(tmp, 'data')); fs.mkdirSync(path.join(tmp, 'tickets', 'rto'), { recursive: true });
  const setOps = (auto) => fs.writeFileSync(path.join(tmp, 'data', 'settings.csv'), `key,value\nallow_auto_send,${auto}\nlogistics_escalation_email,kam@courier.example\n`);
  const ticket = path.join(tmp, 'tickets', 'rto', 'AWB7.md');
  fs.writeFileSync(ticket, '# Ticket AWB7 — Order T7\nStatus: OPEN\n\n## Escalation draft\nSubject: NDR escalation – AWB AWB7 – Order T7 – FAKE ATTEMPT\n\nPlease re-attempt tomorrow 10-1.\nThanks\n\n## Follow-up log\n| Date | Action | Logistics reply | Next step |\n|---|---|---|---|\n| 2026-01-01 | Opened | | |\n');
  await t('refuses unless allow_auto_send = yes (and sends nothing)', async () => {
    setOps('no'); const r = await esc.sendLogisticsEscalation('AWB7', { root: tmp }); assert.ok(r.refused); assert.ok(!/Escalation email/.test(fs.readFileSync(ticket, 'utf8')));
  });
  await t('sends the draft to logistics_escalation_email and logs it in the ticket', async () => {
    setOps('yes'); const r = await esc.sendLogisticsEscalation('AWB7', { root: tmp });
    assert.ok(r.ok, r.error); assert.strictEqual(r.to, 'kam@courier.example'); assert.ok(/FAKE ATTEMPT/.test(r.subject));
    const md = fs.readFileSync(ticket, 'utf8'); assert.ok(/\| \d{4}-\d\d-\d\d \| Escalation email sent to kam@courier\.example/.test(md), md);
    assert.ok(md.indexOf('Opened') < md.indexOf('Escalation email sent'));
  });
  await t('rejects bad AWB / missing ticket / missing draft', async () => {
    assert.ok(!(await esc.sendLogisticsEscalation('../x', { root: tmp })).ok);
    assert.ok(!(await esc.sendLogisticsEscalation('NOPE123', { root: tmp })).ok);
    fs.writeFileSync(path.join(tmp, 'tickets', 'rto', 'AWB8.md'), '# Ticket AWB8\n');
    assert.ok(/no "## Escalation draft"/.test((await esc.sendLogisticsEscalation('AWB8', { root: tmp })).error));
  });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  try { fs.unlinkSync(copy); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
