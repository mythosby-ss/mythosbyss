// Google Drive storage.
// Reading (listing product image folders): a free Google API key (DRIVE_API_KEY) on a folder shared as
//   "Anyone with the link - Viewer". No billing, no service account needed.
// Uploading: a service account (GOOGLE_SERVICE_ACCOUNT_JSON). Note: service accounts have no storage quota
//   of their own, so uploads into a personal (Gmail) Drive fail; without it, uploads are stored locally.
const fs = require('fs');
const { Readable } = require('stream');

let drive;
const apiKey = () => String(process.env.DRIVE_API_KEY || '').trim();
/** Can we list folders/files? (API key or service account) */
function readEnabled() { return Boolean(process.env.DRIVE_ROOT_FOLDER_ID && (apiKey() || process.env.GOOGLE_SERVICE_ACCOUNT_JSON)); }
/** Can we upload? (service account only) */
function enabled() { return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.DRIVE_ROOT_FOLDER_ID); }
function api() {
  if (drive) return drive;
  const { drive: mk, auth } = require('@googleapis/drive');
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
  if (!raw.startsWith('{')) raw = fs.readFileSync(raw, 'utf8');
  const a = new auth.GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/drive'] });
  drive = mk({ version: 'v3', auth: a });
  return drive;
}

const folderCache = {};
async function ensureFolder(name, parent) {
  const key = parent + '/' + name;
  if (folderCache[key]) return folderCache[key];
  const d = api();
  const safe = name.replace(/'/g, "\\'");
  const found = await d.files.list({ q: `'${parent}' in parents and name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (found.data.files.length) return (folderCache[key] = found.data.files[0].id);
  const made = await d.files.create({ requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }, fields: 'id', supportsAllDrives: true });
  return (folderCache[key] = made.data.id);
}

/** Upload a buffer into <root>/<folderName>, make it link-viewable, return the file id. */
async function upload({ buffer, name, mimeType, folderName }) {
  const d = api();
  const parent = await ensureFolder(folderName, process.env.DRIVE_ROOT_FOLDER_ID);
  const res = await d.files.create({ requestBody: { name, parents: [parent] }, media: { mimeType, body: Readable.from(buffer) }, fields: 'id', supportsAllDrives: true });
  await d.permissions.create({ fileId: res.data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
  return res.data.id;
}

const FOLDER = 'application/vnd.google-apps.folder';
/** One page of children of a folder. Uses the API key over plain HTTPS when set, else the service account. */
async function listPage(id, pageToken) {
  const q = `'${id}' in parents and trashed=false`;
  const fields = 'nextPageToken, files(id,name,mimeType)';
  if (apiKey()) {
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    Object.entries({ q, fields, pageSize: '1000', orderBy: 'name', key: apiKey(), supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...(pageToken ? { pageToken } : {}) })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = ((j.error && j.error.message) || `HTTP ${r.status}`).replace(/\.$/, "");
      if (r.status === 404) throw new Error('Drive folder not found. Share the folder as "Anyone with the link - Viewer" and check the folder ID.');
      if (r.status === 400 || r.status === 403) throw new Error(`Google Drive refused the request: ${msg}. Check the API key and that the Google Drive API is enabled for it.`);
      throw new Error(`Google Drive error: ${msg}`);
    }
    return { files: j.files || [], next: j.nextPageToken };
  }
  const r = await api().files.list({ q, fields, pageSize: 1000, orderBy: 'name', pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true });
  return { files: r.data.files, next: r.data.nextPageToken };
}
async function listAll(id) {
  const out = []; let token;
  do { const p = await listPage(id, token); out.push(...p.files); token = p.next; } while (token);
  return out;
}

/** Sub-folders of a folder, each with its images (sorted by name). */
async function listFolders(rootId) {
  const kids = await listAll(rootId);
  const folders = kids.filter((f) => f.mimeType === FOLDER).sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (let i = 0; i < folders.length; i += 6) { // a few at a time to stay under Drive rate limits
    out.push(...await Promise.all(folders.slice(i, i + 6).map(async (f) => ({
      id: f.id, name: f.name,
      images: (await listAll(f.id)).filter((x) => x.mimeType.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((x) => ({ id: x.id, name: x.name }))
    }))));
  }
  return out;
}

/** List files (images or videos) inside a folder and its direct sub-folders. */
async function listFiles(folderId, kind = 'image') {
  const out = [];
  const walk = async (id, path) => {
    let token;
    do {
      const r = { data: await listPage(id, token) }; r.data.nextPageToken = r.data.next;
      for (const f of r.data.files) {
        if (f.mimeType === 'application/vnd.google-apps.folder' && path.length < 2) await walk(f.id, [...path, f.name]);
        else if (f.mimeType.startsWith(kind + '/')) out.push({ id: f.id, name: f.name, folder: path.join('/') });
      }
      token = r.data.nextPageToken;
    } while (token);
  };
  await walk(folderId, []);
  return out;
}

/** Extract a Drive file/folder id from a share URL or bare id. */
function extractId(s) {
  s = String(s || '').trim();
  const m = s.match(/(?:\/d\/|[?&]id=|folders\/)([\w-]{15,})/);
  if (m) return m[1];
  return /^[\w-]{15,}$/.test(s) ? s : null;
}

module.exports = { enabled, readEnabled, upload, listFiles, listFolders, extractId };
