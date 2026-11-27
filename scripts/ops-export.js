// Export ops data for the Claude Code agents: ops/data/orders.csv, products.csv, payments.csv, shipments.csv (columns: ops/README.md).
// Read-only (SELECT queries only). Uses the database from .env, like the website.
//   npm run ops:export                     last 180 days of orders into ops/data/
//   npm run ops:export -- --days 30        last 30 days
//   npm run ops:export -- --out ops/data/sample-check
//   npm run ops:export -- --no-shipments   keep the shipments.csv written by npm run ops:shipway
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const days = Math.max(1, Number(arg('--days', 180)) || 180);
const out = path.resolve(arg('--out', path.join(__dirname, '..', 'ops', 'data')));

(async () => {
  const settings = require('../lib/settings'); const catalog = require('../lib/catalog'); const ex = require('../lib/opsexport');
  await settings.load(); await catalog.refresh();
  fs.mkdirSync(out, { recursive: true });
  const names = ex.NAMES.filter((n) => !(n === 'shipments' && process.argv.includes('--no-shipments')));
  for (const n of names) {
    const body = await ex.csv(n, { days });
    fs.writeFileSync(path.join(out, n + '.csv'), body);
    console.log(`${n}.csv  ${body.trim().split('\n').length - 1} rows`);
  }
  console.log(`Saved in ${path.relative(process.cwd(), out) || '.'}/ (last ${days} days). payments.csv gateway_fee is an estimate from pg_fee_percent.`);
  process.exit(0);
})().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
