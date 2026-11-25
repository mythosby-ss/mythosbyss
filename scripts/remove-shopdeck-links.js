// Finds (and optionally removes) every Shopdeck link stored in the database, so the site never depends on Shopdeck.
// Product images: if photos for that product already exist in public/images/products (file name starts with the
// product's slug), those are used. Otherwise the Shopdeck images are downloaded, compressed and saved to
// public/images/products (with a .webp copy), so they deploy with the app. The database is updated to point at them.
// Before writing, the old values are saved to data/backups/ so the change can be undone.
//
//   node scripts/remove-shopdeck-links.js          -> report only (read-only). Lists every table/column/row with a Shopdeck link.
//   node scripts/remove-shopdeck-links.js --fix    -> downloads those images and rewrites the database values.
//
// Uses the database in .env. Run the report first. Take a Turso backup before --fix (Turso dashboard -> Branch/Backup).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../lib/db');
const images = require('../lib/images');
const imgstore = require('../lib/imgstore');

// Shopdeck's storefront and image CDN hosts (the CDN host was in this site's old security policy)
const HOSTS = /https?:\/\/[^\s"'<>,)]*(?:d2lxx579h3vopi\.cloudfront\.net|shopdeck|dukaan)[^\s"'<>,)]*/gi;
const FIX = process.argv.includes('--fix');
const BACKUP = path.join(__dirname, '..', 'data', 'backups', `shopdeck-links-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`);

const PRODUCTS_DIR = path.join(__dirname, '..', 'public', 'images', 'products');
const localFiles = () => fs.readdirSync(PRODUCTS_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();

async function localize(url, name) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = Buffer.from(await r.arrayBuffer());
  // the format is read from the file itself (Shopdeck sends some images as "application/octet-stream")
  const ext = raw[0] === 0xff && raw[1] === 0xd8 ? 'jpg' : raw[0] === 0x89 && raw[1] === 0x50 ? 'png' : raw.slice(0, 4).toString() === 'RIFF' && raw.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;
  if (!ext) throw new Error(`not a JPG/PNG/WEBP image (${r.headers.get('content-type') || 'unknown type'})`);
  const buf = await images.optimize(raw);
  if (!name) return imgstore.saveLocal(buf, 'shopdeck-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 16), ext);
  fs.writeFileSync(path.join(PRODUCTS_DIR, `${name}.${ext}`), buf);
  const w = await images.toWebp(buf); if (w && w.length < buf.length) fs.writeFileSync(path.join(PRODUCTS_DIR, `${name}.webp`), w);
  return `/images/products/${name}.${ext}`;
}

(async () => {
  const tables = (await db.q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions','events','otp_codes')")).map((r) => r.name);
  const done = {}; let found = 0; let fixed = 0; let usedLocal = 0; const failed = []; const backup = [];
  const slugs = Object.fromEntries((await db.q('SELECT rowid AS r, slug FROM products')).map((x) => [x.r, x.slug]));
  for (const t of tables) {
    const cols = (await db.q(`PRAGMA table_info(${t})`)).filter((c) => !c.type || /TEXT|CHAR|CLOB/i.test(c.type)).map((c) => c.name);
    for (const col of cols) {
      const rows = await db.q(`SELECT rowid AS _rid, "${col}" AS v FROM ${t} WHERE "${col}" LIKE '%cloudfront.net%' OR "${col}" LIKE '%shopdeck%' OR "${col}" LIKE '%dukaan%'`);
      for (const row of rows) {
        const urls = [...new Set(String(row.v).match(HOSTS) || [])]; if (!urls.length) continue;
        found += urls.length;
        console.log(`${t}.${col} (row ${row._rid}): ${urls.length} Shopdeck link(s), e.g. ${urls[0].slice(0, 100)}`);
        if (!FIX) continue;
        let v = String(row.v);
        const slug = t === 'products' && col === 'images' ? slugs[row._rid] : null;
        const own = slug ? localFiles().filter((f) => f.startsWith(slug + '-') && !/-sd(\d+|-[0-9a-f]{8})\.\w+$/.test(f)) : [];
        if (own.length) { // photos already in public/images/products for this product: use those
          v = JSON.stringify(own.map((f) => `/images/products/${f}`)); usedLocal++; fixed += urls.length;
          console.log(`   -> using ${own.length} photo(s) already in public/images/products`);
        } else {
          for (const u of urls) {
            try { done[u] = done[u] || await localize(u, slug ? `${slug}-sd-${crypto.createHash('sha1').update(u).digest('hex').slice(0, 8)}` : null); v = v.split(u).join(done[u]); fixed++; }
            catch (e) { failed.push(`${t}.${col} row ${row._rid}: ${u.slice(0, 100)} (${e.message})`); }
          }
        }
        if (v !== row.v) {
          backup.push({ table: t, column: col, rowid: row._rid, old: row.v });
          fs.mkdirSync(path.join(__dirname, '..', 'data', 'backups'), { recursive: true });
          fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 1)); // written before each update, so it is always complete
          await db.run(`UPDATE ${t} SET "${col}"=? WHERE rowid=?`, [v, row._rid]);
        }
      }
    }
  }
  console.log(`\n${found} Shopdeck link(s) found.${FIX ? ` ${fixed} replaced with images on your own server (${usedLocal} product(s) used photos already in public/images/products). Old values saved in ${path.relative(process.cwd(), BACKUP)}.` : found ? ' Run with --fix to download and replace them.' : ' Nothing to do.'}`);
  if (failed.length) { console.log(`\nCould not replace (fix these by hand in admin, e.g. upload the photo again):\n- ${failed.join('\n- ')}`); process.exitCode = 1; }
  if (FIX && fixed) console.log('\nDone. Restart the server so the catalogue reloads. Run again without --fix to confirm 0 links remain.');
})().catch((e) => { console.error(e.message); process.exit(1); });
