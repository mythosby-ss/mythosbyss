// Old Shopdeck URLs -> new URLs (301), so Google rankings and old shared links keep working after the move.
//
//   1. node scripts/shopdeck-redirects.js            -> writes data/redirects/shopdeck-redirects.csv
//      Uses the database in .env (your live Turso DB, so matches use your real products). Read-only.
//      Each old URL gets the closest product / collection by name. Open the CSV and fix any wrong "new_path".
//   2. node scripts/shopdeck-redirects.js --import   -> saves the CSV rows as permanent redirects (slug_redirects table)
//
// Even without step 2 the site already redirects old Shopdeck URLs automatically (lib/redirects.js); importing just
// pins your checked answers so they never change when products are added.
// Input: data/redirects/shopdeck-urls.txt (one old path per line, e.g. /Pink-...-2L/catalogue/PD0XEGre/AWMbAu1g)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const catalog = require('../lib/catalog');
const redirects = require('../lib/redirects');

const DIR = path.join(__dirname, '..', 'data', 'redirects');
const CSV = path.join(DIR, 'shopdeck-redirects.csv');
const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const parse = (line) => { const out = []; let cur = ''; let q = false; for (let i = 0; i < line.length; i++) { const ch = line[i];
  if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
  else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };

(async () => {
  if (process.argv.includes('--import')) {
    if (!fs.existsSync(CSV)) throw new Error('Run without --import first to create ' + CSV);
    const rows = fs.readFileSync(CSV, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(parse)
      .filter(([from, to]) => from && from.startsWith('/') && to && to.startsWith('/') && !/^\/\//.test(to));
    await db.batch(rows.map(([from, to]) => ['INSERT OR REPLACE INTO slug_redirects(from_path,to_path) VALUES(?,?)', [decodeURIComponent(from).replace(/\/+$/, '').toLowerCase(), to]]));
    console.log(`Imported ${rows.length} redirects. Restart the server (or wait 5 minutes) for them to take effect.`);
    return;
  }
  await catalog.refresh();
  const paths = fs.readFileSync(path.join(DIR, 'shopdeck-urls.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/'));
  const lines = ['old_path,new_path,how,old_name,new_name'];
  let weak = 0;
  for (const p of paths) {
    if (p === '/') continue; // the home page stays the home page
    const to = await redirects.resolve(p);
    let name = ''; try { name = decodeURIComponent(p.split('/')[1] || '').replace(/-+/g, ' ').trim(); } catch (_) {}
    const prod = to && to.startsWith('/products/') ? catalog.bySlug[to.slice(10)] : null;
    const how = /\/catalogue\//i.test(p) ? (prod ? 'product match' : 'NO PRODUCT MATCH - check') : 'rule';
    if (how.startsWith('NO')) weak++;
    lines.push([p, to || '/', how, name, prod ? prod.name : ''].map(cell).join(','));
  }
  fs.writeFileSync(CSV, lines.join('\n') + '\n');
  console.log(`${lines.length - 1} old URLs written to ${path.relative(process.cwd(), CSV)} (${weak} without a product match: they go to a collection or /products).`);
  console.log('Check the new_path column, then run:  node scripts/shopdeck-redirects.js --import');
})().catch((e) => { console.error(e.message); process.exit(1); });
