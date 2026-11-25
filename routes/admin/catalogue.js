const router = require('express').Router();
const multer = require('multer');
const db = require('../../lib/db');
const catalog = require('../../lib/catalog');
const drive = require('../../lib/drive');
const { optimize: optimizeImage } = require('../../lib/images');
const verifyCsrf = require('../../lib/csrf');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 8 } });
const slugify = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const arr = (v) => (v === undefined ? [] : [].concat(v));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const sniff = (b) => (b[0] === 0xff && b[1] === 0xd8 ? ['jpg', 'image/jpeg'] : b[0] === 0x89 && b[1] === 0x50 ? ['png', 'image/png'] : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? ['webp', 'image/webp'] : null);
const getImgs = async (id) => JSON.parse((await db.val('SELECT images FROM products WHERE id=?', [id], '[]')) || '[]');
const setImgs = (id, list) => db.run('UPDATE products SET images=?, updated_at=? WHERE id=?', [JSON.stringify(list), db.nowIso(), id]);

router.get('/catalogue', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim();
    let list = catalog.all;
    if (req.query.status === 'draft') list = list.filter((p) => p.status !== 'published'); else if (req.query.status !== 'all') list = list.filter((p) => p.status === 'published');
    if (req.query.category) list = list.filter((p) => p.category === req.query.category);
    if (req.query.stock === 'low') list = list.filter((p) => p.variants.some((v) => v.stock <= v.lowStock && v.stock > 0));
    if (req.query.stock === 'out') list = list.filter((p) => p.variants.some((v) => v.stock <= 0));
    if (q) list = list.filter((p) => `${p.name} ${p.variants.map((v) => v.sku).join(' ')}`.toLowerCase().includes(q));
    const sales = Object.fromEntries((await db.q('SELECT product_slug s, SUM(qty) n FROM order_items GROUP BY product_slug')).map((x) => [x.s, x.n]));
    res.render('admin/catalogue', { title: 'Catalogue', list, sales, f: req.query, total: catalog.all.length });
  } catch (e) { next(e); }
});

router.get('/catalogue/new', (req, res) => res.render('admin/product-form', { title: 'Create product', p: null }));
router.get('/catalogue/:id(\\d+)/edit', (req, res, next) => {
  const p = catalog.all.find((x) => x.id === Number(req.params.id)); if (!p) return next();
  res.render('admin/product-form', { title: 'Edit product', p, driveOn: drive.enabled() });
});

router.post('/catalogue/save', async (req, res, next) => {
  try {
    const b = req.body; const id = b.id ? Number(b.id) : null; const now = db.nowIso();
    const name = String(b.name || '').trim(); if (!name) throw new Error('Product name is required.');
    let slug = slugify(b.slug || name); if (!slug) throw new Error('Invalid URL slug.');
    const clash = await db.val('SELECT id FROM products WHERE slug=? AND id!=?', [slug, id || 0], 0); if (clash) throw new Error(`The URL "${slug}" is already used by another product.`);
    if (!catalog.catBySlug[b.category]) throw new Error('Choose a category.');
    const labels = arr(b.v_label).map((s) => String(s).trim()); const skus = arr(b.v_sku).map((s) => String(s).trim());
    const rows = labels.map((label, i) => ({ id: Number(arr(b.v_id)[i]) || null, label, sku: skus[i], price: num(arr(b.v_price)[i]), mrp: num(arr(b.v_mrp)[i]), cost: num(arr(b.v_cost)[i]), stock: Math.max(0, Math.round(num(arr(b.v_stock)[i]))), low: Math.round(num(arr(b.v_low)[i], 10)), pack: arr(b.v_pack)[i] ? Math.round(num(arr(b.v_pack)[i])) : null })).filter((r) => r.label || r.sku);
    if (!rows.length) throw new Error('Add at least one variant (size) with a price.');
    for (const r of rows) { if (!r.label || !r.sku) throw new Error('Every variant needs a size label and a SKU.'); if (!(r.price > 0)) throw new Error(`Set a selling price for ${r.label}.`); if (r.mrp < r.price) r.mrp = r.price; }
    if (new Set(rows.map((r) => r.sku)).size !== rows.length) throw new Error('SKUs must be unique within the product.');
    const features = String(b.features || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const f = [name, slug, b.category, String(b.description || '').trim(), JSON.stringify(features), String(b.badge || '').trim() || null, b.is_new ? 1 : 0, b.status === 'draft' ? 'draft' : 'published',
      String(b.image_alt || '').trim() || name, String(b.seo_title || '').trim() || null, String(b.seo_desc || '').trim() || null, String(b.seo_keywords || '').trim() || null, now];
    let pid = id;
    if (id) {
      const old = await db.one('SELECT slug FROM products WHERE id=?', [id]);
      await db.run('UPDATE products SET name=?,slug=?,category=?,description=?,features=?,badge=?,is_new=?,status=?,image_alt=?,seo_title=?,seo_desc=?,seo_keywords=?,updated_at=? WHERE id=?', [...f, id]);
      if (old && old.slug !== slug) { await db.run('INSERT OR REPLACE INTO slug_redirects(from_path,to_path) VALUES(?,?)', [`/products/${old.slug}`, `/products/${slug}`]); await db.run('UPDATE reviews SET product_slug=? WHERE product_slug=?', [slug, old.slug]); await db.run('UPDATE testimonials SET product_slug=? WHERE product_slug=?', [slug, old.slug]); }
    } else {
      const r = await db.run('INSERT INTO products(name,slug,category,description,features,badge,is_new,status,image_alt,seo_title,seo_desc,seo_keywords,updated_at,created_at,images,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [...f, now, '[]', 9999]);
      pid = r.id;
    }
    const optCost = (v) => (String(v ?? '').trim() === '' ? null : Math.max(0, num(v))); // empty = use profit default
    await db.run('UPDATE products SET packaging_cost=?, shipping_cost=? WHERE id=?', [optCost(b.packaging_cost), optCost(b.shipping_cost), pid]);
    const existing = (await db.q('SELECT id FROM variants WHERE product_id=?', [pid])).map((v) => v.id);
    const keep = rows.filter((r) => r.id).map((r) => r.id);
    for (const vid of existing.filter((x) => !keep.includes(x))) await db.run('DELETE FROM variants WHERE id=?', [vid]);
    for (const r of rows) {
      if (r.id && existing.includes(r.id)) await db.run('UPDATE variants SET label=?, sku=?, code=?, price=?, mrp=?, cost_price=?, stock=?, low_stock=?, pack=? WHERE id=?', [r.label, r.sku, r.sku.replace(/^MB-NK-/, ''), r.price, r.mrp, r.cost, r.stock, r.low, r.pack, r.id]);
      else await db.run('INSERT INTO variants(product_id,sku,code,label,price,mrp,cost_price,stock,low_stock,pack) VALUES(?,?,?,?,?,?,?,?,?,?)', [pid, r.sku, r.sku.replace(/^MB-NK-/, ''), r.label, r.price, r.mrp, r.cost, r.stock, r.low, r.pack]);
    }
    await catalog.refresh();
    res.flash(id ? 'Product updated. The storefront is already showing the changes.' : 'Product created. Now add images below.');
    res.redirect(`/admin/catalogue/${pid}/edit`);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) e.message = 'One of these SKUs already exists on another product.';
    res.flash(e.message, 'err'); res.redirect(req.get('referer') || '/admin/catalogue');
  }
});

router.post('/catalogue/:id(\\d+)/images', upload.array('files', 8), verifyCsrf, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const p = catalog.all.find((x) => x.id === id); if (!p) throw new Error('Product not found');
    const imgs = await getImgs(id); let uploaded = 0; let linked = false;
    for (const f of req.files || []) {
      const t = sniff(f.buffer); if (!t) throw new Error(`${f.originalname} is not a JPG, PNG or WEBP image.`);
      f.buffer = await optimizeImage(f.buffer); // resize + compress for fast mobile pages
      const base = `${p.slug}-${Date.now().toString(36)}${uploaded}`;
      if (drive.enabled()) imgs.push('drive:' + await drive.upload({ buffer: f.buffer, name: `${base}.${t[0]}`, mimeType: t[1], folderName: p.categoryName }));
      else imgs.push(await require('../../lib/imgstore').saveLocal(f.buffer, base, t[0])); // UPLOAD_DIR (survives redeploys)
      uploaded++;
    }
    const link = String(req.body.link || '').trim();
    if (link) {
      let isDriveFolder = false;
      try {
        const parsed = new URL(link);
        isDriveFolder = parsed.hostname === 'drive.google.com' && /(?:^|\/)folders\/[\w-]+/.test(parsed.pathname);
      } catch {}
      if (isDriveFolder) throw new Error('That is a Google Drive folder link, not an image. Open the folder and paste the share link for an individual image file (usually /file/d/FILE_ID/view).');
      const did = drive.extractId(link);
      if (did) { imgs.push('drive:' + did); linked = true; }
      else if (/^https:\/\//.test(link)) { imgs.push(link); linked = true; }
      else throw new Error('That does not look like a Drive image file link or HTTPS image URL.');
    }
    if (!uploaded && !linked) throw new Error('Choose a file or paste a link.');
    await setImgs(id, imgs); await catalog.refresh();
    const messages = [];
    if (uploaded) messages.push(`${uploaded} uploaded image(s) ${drive.enabled() ? 'saved to Google Drive' : 'saved on this server'}`);
    if (linked) messages.push('Image link added');
    res.flash(`${messages.join('. ')}.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect(`/admin/catalogue/${id}/edit`);
});

router.post('/catalogue/:id(\\d+)/variants/:variantId(\\d+)/images', upload.array('files', 8), verifyCsrf, async (req, res) => {
  const id = Number(req.params.id); const variantId = Number(req.params.variantId);
  try {
    const p = catalog.all.find((x) => x.id === id); if (!p) throw new Error('Product not found');
    const variant = p.variants.find((x) => x.id === variantId); if (!variant) throw new Error('Variant not found for this product');
    const images = [...variant.rawImages]; let uploaded = 0; let linked = false;
    for (const f of req.files || []) {
      const t = sniff(f.buffer); if (!t) throw new Error(`${f.originalname} is not a JPG, PNG or WEBP image.`);
      f.buffer = await optimizeImage(f.buffer); // resize + compress for fast mobile pages
      const base = `${p.slug}-${variant.sku.replace(/[^a-z0-9-]/gi, '-')}-${Date.now().toString(36)}${uploaded}`;
      if (drive.enabled()) images.push('drive:' + await drive.upload({ buffer: f.buffer, name: `${base}.${t[0]}`, mimeType: t[1], folderName: p.categoryName }));
      else images.push(await require('../../lib/imgstore').saveLocal(f.buffer, base, t[0])); // UPLOAD_DIR (survives redeploys)
      uploaded++;
    }
    const link = String(req.body.link || '').trim();
    if (link) {
      let isDriveFolder = false;
      try {
        const parsed = new URL(link);
        isDriveFolder = parsed.hostname === 'drive.google.com' && /(?:^|\/)folders\/[\w-]+/.test(parsed.pathname);
      } catch {}
      if (isDriveFolder) throw new Error('Use the share link for an individual image file, not a Google Drive folder.');
      const driveId = drive.extractId(link);
      if (driveId) { images.push('drive:' + driveId); linked = true; }
      else if (/^https:\/\//.test(link)) { images.push(link); linked = true; }
      else throw new Error('Enter a Drive image file link or HTTPS image URL.');
    }
    if (!uploaded && !linked) throw new Error('Choose a file or paste an image link.');
    await db.run('UPDATE variants SET images=? WHERE id=? AND product_id=?', [JSON.stringify(images), variantId, id]);
    await catalog.refresh();
    const messages = [];
    if (uploaded) messages.push(`${uploaded} variant image(s) ${drive.enabled() ? 'saved to Google Drive' : 'saved on this server'}`);
    if (linked) messages.push('Variant image link added');
    res.flash(`${messages.join('. ')}.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect(`/admin/catalogue/${id}/edit`);
});

router.post('/catalogue/:id(\\d+)/variants/:variantId(\\d+)/images/:i(\\d+)/:action', async (req, res, next) => {
  const id = Number(req.params.id); const variantId = Number(req.params.variantId); const i = Number(req.params.i);
  try {
    const variant = await db.one('SELECT images FROM variants WHERE id=? AND product_id=?', [variantId, id]);
    if (!variant) throw new Error('Variant not found for this product');
    const images = JSON.parse(variant.images || '[]');
    if (images[i] === undefined) throw new Error('Variant image not found');
    if (req.params.action === 'remove') images.splice(i, 1);
    else if (req.params.action === 'primary') images.unshift(images.splice(i, 1)[0]);
    else return next();
    await db.run('UPDATE variants SET images=? WHERE id=? AND product_id=?', [JSON.stringify(images), variantId, id]);
    await catalog.refresh();
    res.redirect(`/admin/catalogue/${id}/edit`);
  } catch (e) { next(e); }
});

router.post('/catalogue/:id(\\d+)/images/:i(\\d+)/:action', async (req, res) => {
  const id = Number(req.params.id); const i = Number(req.params.i); const imgs = await getImgs(id);
  if (imgs[i] !== undefined) {
    if (req.params.action === 'remove') imgs.splice(i, 1);
    if (req.params.action === 'primary') imgs.unshift(imgs.splice(i, 1)[0]);
    await setImgs(id, imgs); await catalog.refresh();
  }
  res.redirect(`/admin/catalogue/${id}/edit`);
});

router.post('/catalogue/:id(\\d+)/toggle', async (req, res) => {
  await db.run("UPDATE products SET status = CASE status WHEN 'published' THEN 'draft' ELSE 'published' END, updated_at=? WHERE id=?", [db.nowIso(), req.params.id]);
  await catalog.refresh(); res.redirect(req.get('referer') || '/admin/catalogue');
});
router.post('/catalogue/:id(\\d+)/delete', async (req, res) => {
  await db.batch([['DELETE FROM variants WHERE product_id=?', [req.params.id]], ['DELETE FROM products WHERE id=?', [req.params.id]]]);
  await catalog.refresh(); res.flash('Product deleted. Past orders keep their own snapshot of the item.'); res.redirect('/admin/catalogue');
});

// Match files in a Drive folder to products by file name (slug, slug-2, SKU or item code) and attach them.
router.post('/catalogue/sync-drive', async (req, res) => {
  try {
    if (!drive.readEnabled()) throw new Error('Google Drive is not connected. Set it up under Plugins → Google Drive.');
    const folder = drive.extractId(req.body.folder) || process.env.DRIVE_IMAGES_FOLDER_ID || process.env.DRIVE_ROOT_FOLDER_ID;
    const files = await drive.listFiles(folder, 'image');
    const byKey = {}; catalog.all.forEach((p) => { byKey[p.slug] = p; p.variants.forEach((v) => { byKey[v.sku.toLowerCase()] = p; byKey[v.code.toLowerCase()] = p; }); });
    let matched = 0; const miss = []; const touched = new Set();
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const base = slugify(f.name.replace(/\.[a-z0-9]+$/i, '')); const key = base.replace(/-\d+$/, '');
      const p = byKey[base] || byKey[key] || byKey[slugify(f.folder.split('/').pop() || '')];
      if (!p) { miss.push(f.name); continue; }
      const imgs = await getImgs(p.id);
      if (!imgs.includes('drive:' + f.id)) { imgs.push('drive:' + f.id); await setImgs(p.id, imgs); matched++; touched.add(p.slug); }
    }
    await catalog.refresh();
    res.flash(`Drive sync: ${matched} new image(s) attached to ${touched.size} product(s). ${miss.length ? miss.length + ' file(s) did not match any product name/SKU: ' + miss.slice(0, 8).join(', ') : ''}`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/catalogue');
});

// ── Drive images: link each product folder in Drive to a catalogue product ──────────────
const settings = require('../../lib/settings');
let folderCache = null; // { at, root, folders }
async function driveFolders(force) {
  const root = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!force && folderCache && folderCache.root === root && Date.now() - folderCache.at < 10 * 60 * 1000) return folderCache.folders;
  const folders = await drive.listFolders(root);
  folderCache = { at: Date.now(), root, folders };
  return folders;
}
const getMap = () => { try { return JSON.parse(settings.get('drive_map') || '{}'); } catch (_) { return {}; } };
// "Chopper 450Ml" -> ['chopper','450','ml']
const words = (t) => String(t).toLowerCase().replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w)).map((w) => w.replace(/(?<=..)s$/, ''));
// Generic words never decide a match on their own ("Window Container" must not match "Apple Container").
const GENERIC = new Set(['bottle', 'water', 'container', 'box', 'lunch', 'tiffin', 'jar', 'set', 'pack', 'of', 'for', 'with', 'and', 'the', 'kid', 'ml', 'plastic', 'steel', 'stainles', 'combo', 'mythosby']);
function suggest(folderName, products) {
  const fw = words(folderName); const key = fw.filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
  if (!key.length) return null;
  let best = null;
  for (const p of products) {
    const pw = new Set(words(p.name));
    if (!key.every((w) => pw.has(w))) continue; // every distinctive word must appear
    const score = fw.filter((w) => pw.has(w)).length / fw.length;
    if (!best || score > best.score || (score === best.score && p.name.length < best.p.name.length)) best = { p, score };
  }
  return best && best.p.id;
}

router.get('/catalogue/drive', async (req, res, next) => {
  const products = [...catalog.all].sort((a, b) => a.name.localeCompare(b.name));
  if (!drive.readEnabled()) return res.render('admin/drive-images', { title: 'Drive images', configured: false, folders: [], products, error: null });
  try {
    const map = getMap();
    const taken = new Set(Object.values(map).map(String));
    const folders = (await driveFolders(req.query.refresh === '1')).map((f) => {
      const linked = map[f.id] && products.find((p) => String(p.id) === String(map[f.id]));
      const sug = linked ? null : suggest(f.name, products);
      return { ...f, productId: linked ? linked.id : null, suggested: sug && !taken.has(String(sug)) ? sug : null };
    });
    // A product suggested for several folders is ambiguous: let the admin choose.
    const count = {}; folders.forEach((f) => { if (f.suggested) count[f.suggested] = (count[f.suggested] || 0) + 1; });
    folders.forEach((f) => { if (f.suggested && count[f.suggested] > 1) f.suggested = null; });
    res.render('admin/drive-images', { title: 'Drive images', configured: true, folders, products, error: null });
  } catch (e) {
    res.render('admin/drive-images', { title: 'Drive images', configured: true, folders: [], products, error: e.message });
  }
});

router.post('/catalogue/drive', async (req, res) => {
  try {
    const folders = await driveFolders(false);
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    const ids = arr(req.body.folder); const pids = arr(req.body.product);
    const map = {};
    ids.forEach((fid, i) => { const pid = Number(pids[i]); if (byId[fid] && pid && catalog.all.some((p) => p.id === pid)) map[fid] = pid; });
    await settings.set('drive_map', JSON.stringify(map));

    // Group folders per product (one product may use several folders)
    const perProduct = {};
    for (const [fid, pid] of Object.entries(map)) (perProduct[pid] = perProduct[pid] || []).push(...byId[fid].images.map((im) => 'drive:' + im.id));
    const replace = req.body.replace === '1';
    let updated = 0; let added = 0;
    for (const [pid, driveImgs] of Object.entries(perProduct)) {
      if (!driveImgs.length) continue;
      const current = await getImgs(pid);
      const next = replace ? [...new Set(driveImgs)] : [...new Set([...current, ...driveImgs])];
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      added += next.filter((x) => !current.includes(x)).length;
      await setImgs(pid, next); updated++;
    }
    await catalog.refresh();
    res.flash(`Saved ${Object.keys(map).length} folder link(s). ${updated} product(s) updated with ${added} new image(s)${replace ? ' (old images replaced)' : ''}.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/catalogue/drive');
});

router.get('/inventory', async (req, res) => {
  const rows = await db.q('SELECT v.*, p.name pname, p.slug FROM variants v JOIN products p ON p.id=v.product_id ORDER BY (v.stock<=0) DESC, (v.stock<=v.low_stock) DESC, p.name');
  const f = req.query.f; const list = rows.filter((v) => (f === 'out' ? v.stock <= 0 : f === 'low' ? v.stock <= v.low_stock : true));
  res.render('admin/inventory', { title: 'Inventory', list, f: f || '', counts: { out: rows.filter((v) => v.stock <= 0).length, low: rows.filter((v) => v.stock <= v.low_stock && v.stock > 0).length, all: rows.length } });
});
router.post('/inventory', async (req, res) => {
  const ids = arr(req.body.id); const stmts = [];
  ids.forEach((id, i) => stmts.push(['UPDATE variants SET stock=?, low_stock=? WHERE id=?', [Math.max(0, Math.round(num(arr(req.body.stock)[i]))), Math.max(0, Math.round(num(arr(req.body.low)[i], 10))), Number(id)]]));
  if (stmts.length) await db.batch(stmts);
  await catalog.refresh(); res.flash('Inventory updated.'); res.redirect(req.get('referer') || '/admin/inventory');
});
module.exports = router;
