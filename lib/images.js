// Image optimisation for faster mobile pages: resize to max 1400px wide and re-compress, keeping the same format
// (JPG/PNG stay JPG/PNG so WhatsApp and Meta catalogue can still use them). Never makes a file bigger.
const sharp = require('sharp');

const MAX_WIDTH = 1400;

/** @returns {Promise<Buffer>} optimised buffer (or the original if optimising does not help / fails) */
async function optimize(buffer) {
  try {
    const img = sharp(buffer, { failOn: 'none' }).rotate(); // apply EXIF orientation
    const meta = await img.metadata();
    const pipe = meta.width > MAX_WIDTH ? img.resize({ width: MAX_WIDTH, withoutEnlargement: true }) : img;
    let out;
    if (meta.format === 'jpeg') out = await pipe.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    else if (meta.format === 'png') out = await pipe.png({ compressionLevel: 9, palette: true, quality: 82, effort: 8 }).toBuffer();
    else if (meta.format === 'webp') out = await pipe.webp({ quality: 80 }).toBuffer();
    else return buffer;
    return out.length < buffer.length ? out : buffer;
  } catch (e) {
    console.error('[images] optimise failed, keeping original:', e.message);
    return buffer;
  }
}

/** WebP copy (served to browsers via <picture>; the JPG/PNG stays for WhatsApp, Meta catalogue and old browsers) */
async function toWebp(buffer) {
  try { return await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toBuffer(); }
  catch (e) { console.error('[images] webp failed:', e.message); return null; }
}

// Where uploaded images are stored. On Hostinger, set UPLOAD_DIR in .env to a folder OUTSIDE the app folder,
// so a redeploy cannot delete uploaded photos. They are still served at /images/uploads/...
const path = require('path');
const fs = require('fs');
const PUBLIC_IMAGES = path.join(__dirname, '..', 'public', 'images');
const uploadDir = () => process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(PUBLIC_IMAGES, 'uploads');
const fileFor = (url) => (url.startsWith('/images/uploads/') ? path.join(uploadDir(), url.slice(16)) : path.join(PUBLIC_IMAGES, url.slice(8)));

/** '/images/x.png' -> '/images/x.webp' when that WebP file exists, else null (checked once, then remembered) */
const webpSeen = new Map();
function webpUrl(url) {
  if (typeof url !== 'string' || !/^\/images\/[^?#]+\.(jpe?g|png)$/i.test(url) || url.includes('..')) return null;
  if (!webpSeen.has(url)) { const w = url.replace(/\.(jpe?g|png)$/i, '.webp'); webpSeen.set(url, fs.existsSync(fileFor(w)) ? w : null); if (webpSeen.size > 20000) webpSeen.clear(); }
  return webpSeen.get(url);
}

module.exports = { optimize, toWebp, webpUrl, uploadDir, MAX_WIDTH };
