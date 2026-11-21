const router = require('express').Router();
const multer = require('multer');
const db = require('../../lib/db');
const catalog = require('../../lib/catalog');
const drive = require('../../lib/drive');
const imgstore = require('../../lib/imgstore');
const verifyCsrf = require('../../lib/csrf');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const str = (v, n = 300) => String(v || '').trim().slice(0, n);

router.get('/website/testimonials', async (req, res) => {
  const list = (await db.q('SELECT * FROM testimonials ORDER BY active DESC, sort, id DESC')).map((t) => ({ ...t, thumbUrl: t.thumb ? catalog.imgUrl(t.thumb.startsWith('drive:') || t.thumb.startsWith('/') ? t.thumb : 'drive:' + t.thumb) : (t.video ? `/media/${t.video}?sz=sm` : catalog.PLACEHOLDER) }));
  const edit = req.query.edit ? list.find((t) => t.id === Number(req.query.edit)) : null;
  res.render('admin/testimonials', { title: 'UGC testimonials', list, edit, products: catalog.all, driveOn: drive.enabled() });
});

router.post('/website/testimonials/save', upload.single('file'), verifyCsrf, async (req, res) => {
  const b = req.body;
  try {
    const video = drive.extractId(b.video);
    if (!video) throw new Error('Paste the Google Drive share link (or file id) of the video.');
    let thumb = b.keep_thumb || null;
    if (req.file) thumb = await imgstore.save(req.file, 'UGC Thumbnails', 'ugc'); else if (str(b.thumb_link)) thumb = imgstore.fromLink(b.thumb_link) || thumb;
    const f = [str(b.customer_name, 80), str(b.city, 60), str(b.quote, 600), Math.min(5, Math.max(1, parseInt(b.rating, 10) || 5)), video, thumb, str(b.product_slug, 100) || null, b.active ? 1 : 0, Math.round(Number(b.sort) || 0)];
    if (b.id) await db.run('UPDATE testimonials SET customer_name=?,city=?,quote=?,rating=?,video=?,thumb=?,product_slug=?,active=?,sort=? WHERE id=?', [...f, Number(b.id)]);
    else await db.run('INSERT INTO testimonials(customer_name,city,quote,rating,video,thumb,product_slug,active,sort,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [...f, db.nowIso()]);
    res.flash('Testimonial saved.');
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/website/testimonials');
});
router.post('/website/testimonials/:id(\\d+)/toggle', async (req, res) => { await db.run('UPDATE testimonials SET active = 1 - active WHERE id=?', [req.params.id]); res.redirect('/admin/website/testimonials'); });
router.post('/website/testimonials/:id(\\d+)/delete', async (req, res) => { await db.run('DELETE FROM testimonials WHERE id=?', [req.params.id]); res.redirect('/admin/website/testimonials'); });

// Pull every video in the UGC Drive folder in as an inactive draft; the admin then adds customer name, quote and product.
router.post('/website/testimonials/import', async (req, res) => {
  try {
    if (!drive.enabled()) throw new Error('Google Drive is not configured (GOOGLE_SERVICE_ACCOUNT_JSON + DRIVE_ROOT_FOLDER_ID).');
    const folder = drive.extractId(req.body.folder) || process.env.UGC_DRIVE_FOLDER_ID;
    if (!folder) throw new Error('Paste the Drive folder link that holds the UGC videos.');
    const files = await drive.listFiles(folder, 'video'); let n = 0;
    for (const f of files) {
      if (await db.val('SELECT COUNT(*) FROM testimonials WHERE video=?', [f.id])) continue;
      await db.run('INSERT INTO testimonials(customer_name,quote,rating,video,active,sort,created_at) VALUES(?,?,?,?,?,?,?)', [f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60), '', 5, f.id, 0, 100, db.nowIso()]);
      n++;
    }
    res.flash(`${n} new video(s) imported as drafts (${files.length} found). Edit each to add the customer quote and product, then activate.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/website/testimonials');
});

router.get('/website/reviews', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
  const list = (await db.q('SELECT * FROM reviews WHERE status=? ORDER BY id DESC LIMIT 200', [status]))
    .map((review) => ({ ...review, photoUrl: review.photo ? catalog.imgUrl(review.photo) : null }));
  const counts = Object.fromEntries((await db.q('SELECT status, COUNT(*) n FROM reviews GROUP BY status')).map((x) => [x.status, x.n]));
  res.render('admin/reviews', { title: 'Customer reviews', list, status, counts, products: catalog.all });
});
router.post('/website/reviews/:id(\\d+)/photo', upload.single('file'), verifyCsrf, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const review = await db.one('SELECT id FROM reviews WHERE id=?', [id]);
    if (!review) throw new Error('Review not found.');
    let photo = null;
    if (req.file) photo = await imgstore.save(req.file, 'Review Photos', `review-${id}`);
    else if (str(req.body.link_image)) photo = imgstore.fromLink(req.body.link_image);
    if (!photo) throw new Error('Choose a JPG, PNG, or WEBP file or enter a Drive image link.');
    await db.run('UPDATE reviews SET photo=? WHERE id=?', [photo, id]);
    res.flash('Review photo saved. It will appear in the customer photo testimonials.');
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect(req.get('referer') || '/admin/website/reviews?status=approved');
});
router.post('/website/reviews/:id(\\d+)/photo/remove', async (req, res) => {
  await db.run('UPDATE reviews SET photo=NULL WHERE id=?', [req.params.id]);
  res.flash('Review photo removed from the customer photo testimonials.');
  res.redirect(req.get('referer') || '/admin/website/reviews?status=approved');
});
router.post('/website/reviews/:id(\\d+)/:action(approve|reject|delete)', async (req, res) => {
  if (req.params.action === 'delete') await db.run('DELETE FROM reviews WHERE id=?', [req.params.id]);
  else await db.run('UPDATE reviews SET status=? WHERE id=?', [req.params.action === 'approve' ? 'approved' : 'rejected', req.params.id]);
  res.redirect(req.get('referer') || '/admin/website/reviews');
});
module.exports = router;
