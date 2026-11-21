// Stores an uploaded image (multer file) in Google Drive when configured, otherwise in public/images/uploads.
const fs = require('fs');
const path = require('path');
const drive = require('./drive');
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 ? ['jpg', 'image/jpeg'] : b[0] === 0x89 && b[1] === 0x50 ? ['png', 'image/png'] : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null);

/** returns a stored reference: 'drive:<id>' or a local '/images/uploads/...' path */
async function save(file, folderName, base) {
  const t = sniff(file.buffer); if (!t) throw new Error(`${file.originalname} is not a JPG, PNG or WEBP image.`);
  const name = `${base}-${Date.now().toString(36)}`;
  if (drive.enabled()) return 'drive:' + await drive.upload({ buffer: file.buffer, name: `${name}.${t[0]}`, mimeType: t[1], folderName });
  const dir = path.join(__dirname, '..', 'public', 'images', 'uploads'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.${t[0]}`), file.buffer);
  return `/images/uploads/${name}.${t[0]}`;
}
/** reference from a pasted Drive link / https URL */
function fromLink(link) {
  link = String(link || '').trim(); if (!link) return null;
  const id = drive.extractId(link); if (id) return 'drive:' + id;
  return /^https:\/\//.test(link) ? link : null;
}
module.exports = { save, fromLink };
