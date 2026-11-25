// One-time (re-runnable) compression of images already in public/images: products, uploads, reviews.
// Keeps file names and formats, so nothing in the database changes. Originals are copied to data/image-originals/.
// Also creates a smaller .webp copy next to every JPG/PNG (browsers get the WebP; WhatsApp / Meta keep the JPG/PNG).
// Usage: npm run images:optimize
const fs = require('fs');
const path = require('path');
const { optimize, toWebp, uploadDir } = require('../lib/images');

const ROOT = path.join(__dirname, '..', 'public', 'images');
const BACKUP = path.join(__dirname, '..', 'data', 'image-originals');
const DIRS = ['products', 'uploads', 'reviews'];
const MIN_BYTES = 150 * 1024; // skip files that are already small

(async () => {
  let before = 0; let after = 0; let changed = 0;
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir); if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
      const file = path.join(abs, name); const buf = fs.readFileSync(file);
      before += buf.length;
      if (buf.length < MIN_BYTES) { after += buf.length; continue; }
      const out = await optimize(buf);
      if (out.length < buf.length * 0.95) {
        const bak = path.join(BACKUP, dir, name);
        if (!fs.existsSync(bak)) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.writeFileSync(bak, buf); }
        fs.writeFileSync(file, out); changed++;
        console.log(`${dir}/${name}: ${(buf.length / 1024).toFixed(0)} KB -> ${(out.length / 1024).toFixed(0)} KB`);
        after += out.length;
      } else after += buf.length;
    }
  }
  // WebP copies
  let webps = 0; let saved = 0;
  for (const abs of [...DIRS.map((d) => path.join(ROOT, d)), uploadDir()]) {
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (!/\.(jpe?g|png)$/i.test(name)) continue;
      const w = path.join(abs, name.replace(/\.(jpe?g|png)$/i, '.webp')); if (fs.existsSync(w)) continue;
      const buf = fs.readFileSync(path.join(abs, name)); const out = await toWebp(buf);
      if (out && out.length < buf.length) { fs.writeFileSync(w, out); webps++; saved += buf.length - out.length; }
    }
  }
  console.log(`${webps} WebP cop${webps === 1 ? 'y' : 'ies'} created (${(saved / 1048576).toFixed(1)} MB smaller than the JPG/PNG).`);
  console.log(`\n${changed} image(s) optimised. Total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB. Originals: data/image-originals/`);
})();
