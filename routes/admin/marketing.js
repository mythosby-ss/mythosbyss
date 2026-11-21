const router = require('express').Router();
const multer = require('multer');
const db = require('../../lib/db');
const A = require('../../lib/analytics');
const catalog = require('../../lib/catalog');
const imgstore = require('../../lib/imgstore');
const verifyCsrf = require('../../lib/csrf');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v, n = 300) => String(v || '').trim().slice(0, n);
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
const back = (req, res, def) => res.redirect(req.get('referer') || def);
const slugify = (s) => String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------------- Coupons ---------------- */
router.get('/coupons', async (req, res) => {
  const list = await db.q('SELECT * FROM coupons ORDER BY id DESC');
  const edit = req.query.edit ? list.find((c) => c.id === Number(req.query.edit)) : null;
  res.render('admin/coupons', { title: 'Coupons', list, edit, today: A.day(new Date()) });
});
router.post('/coupons/save', async (req, res) => {
  const b = req.body; const code = str(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  try {
    if (!code || !(num(b.value) > 0)) throw new Error('Code and a discount value are required.');
    const f = [code, str(b.title, 120), b.type === 'flat' ? 'flat' : 'percent', num(b.value), num(b.max_discount) || null, num(b.min_order), date(b.expires_on), b.active ? 1 : 0];
    if (b.id) await db.run('UPDATE coupons SET code=?,title=?,type=?,value=?,max_discount=?,min_order=?,expires_on=?,active=? WHERE id=?', [...f, Number(b.id)]);
    else await db.run('INSERT INTO coupons(code,title,type,value,max_discount,min_order,expires_on,active) VALUES(?,?,?,?,?,?,?,?)', f);
    res.flash('Coupon saved.');
  } catch (e) { res.flash(/UNIQUE/i.test(e.message) ? 'That coupon code already exists.' : e.message, 'err'); }
  res.redirect('/admin/coupons');
});
router.post('/coupons/:id(\\d+)/toggle', async (req, res) => { await db.run('UPDATE coupons SET active = 1 - active WHERE id=?', [req.params.id]); res.redirect('/admin/coupons'); });
router.post('/coupons/:id(\\d+)/delete', async (req, res) => { await db.run('DELETE FROM coupons WHERE id=?', [req.params.id]); res.redirect('/admin/coupons'); });

/* ---------------- Performance marketing ---------------- */
router.get('/marketing/performance', async (req, res, next) => {
  try {
    const r = A.range(req.query, 30);
    const data = await A.campaigns(r);
    const raw = await db.q('SELECT m.*, c.name FROM ad_metrics m JOIN campaigns c ON c.id=m.campaign_id WHERE m.day BETWEEN ? AND ? ORDER BY m.day DESC, c.name LIMIT 60', [r.from, r.to]);
    const daily = await db.q('SELECT day, SUM(spend) spend, SUM(clicks) clicks, SUM(conversions) conv FROM ad_metrics WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day', [r.from, r.to]);
    res.render('admin/performance', { title: 'Performance marketing', r, ...data, raw, daily, products: catalog.all, today: A.day(new Date()) });
  } catch (e) { next(e); }
});
router.post('/marketing/campaigns/save', async (req, res) => {
  const b = req.body; const utm = slugify(b.utm_campaign || b.name).replace(/-/g, '_');
  try {
    if (!str(b.name)) throw new Error('Campaign name is required.');
    const f = [str(b.name, 100), str(b.platform, 20) || 'Meta', utm, str(b.product_slug, 100) || null, str(b.objective, 60), b.status === 'paused' ? 'paused' : 'active'];
    if (b.id) await db.run('UPDATE campaigns SET name=?,platform=?,utm_campaign=?,product_slug=?,objective=?,status=? WHERE id=?', [...f, Number(b.id)]);
    else await db.run('INSERT INTO campaigns(name,platform,utm_campaign,product_slug,objective,status,created_at) VALUES(?,?,?,?,?,?,?)', [...f, db.nowIso()]);
    res.flash(`Campaign saved. Tag your ad links with utm_campaign=${utm} so orders are attributed to it.`);
  } catch (e) { res.flash(/UNIQUE/i.test(e.message) ? 'That UTM campaign name is already used.' : e.message, 'err'); }
  back(req, res, '/admin/marketing/performance');
});
router.post('/marketing/campaigns/:id(\\d+)/delete', async (req, res) => { await db.batch([['DELETE FROM ad_metrics WHERE campaign_id=?', [req.params.id]], ['DELETE FROM campaigns WHERE id=?', [req.params.id]]]); back(req, res, '/admin/marketing/performance'); });
const upsertMetric = (cid, d, s, i, c, v) => db.run('INSERT INTO ad_metrics(campaign_id,day,spend,impressions,clicks,conversions) VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, conversions=excluded.conversions', [cid, d, s, i, c, v]);
router.post('/marketing/metrics', async (req, res) => {
  const b = req.body;
  if (!date(b.day) || !Number(b.campaign_id)) res.flash('Pick a campaign and a date.', 'err');
  else { await upsertMetric(Number(b.campaign_id), b.day, num(b.spend), Math.round(num(b.impressions)), Math.round(num(b.clicks)), Math.round(num(b.conversions))); res.flash('Daily metrics saved.'); }
  back(req, res, '/admin/marketing/performance');
});
// Paste rows exported from Meta Ads Manager / Google Ads:  date,utm_campaign,spend,impressions,clicks,conversions
router.post('/marketing/metrics/import', async (req, res) => {
  const camps = Object.fromEntries((await db.q('SELECT id, utm_campaign FROM campaigns')).map((c) => [c.utm_campaign, c.id])); let n = 0; const bad = [];
  for (const line of String(req.body.csv || '').split(/\r?\n/).slice(0, 2000)) {
    const p = line.split(',').map((x) => x.trim()); if (!date(p[0])) continue;
    if (!camps[p[1]]) { bad.push(p[1]); continue; }
    await upsertMetric(camps[p[1]], p[0], num(p[2]), Math.round(num(p[3])), Math.round(num(p[4])), Math.round(num(p[5]))); n++;
  }
  res.flash(`${n} row(s) imported.${bad.length ? ' Unknown campaigns skipped: ' + [...new Set(bad)].slice(0, 5).join(', ') : ''}`, bad.length && !n ? 'err' : 'ok'); back(req, res, '/admin/marketing/performance');
});

/* ---------------- Digital marketing: banners + promotions ---------------- */
router.get('/marketing/digital', async (req, res) => {
  const banners = await db.q('SELECT * FROM banners ORDER BY sort, id');
  const promos = await db.q('SELECT * FROM promotions ORDER BY id DESC');
  const coupons = await db.q('SELECT code FROM coupons WHERE active=1');
  const site = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  promos.forEach((p) => { const u = new URLSearchParams({ utm_source: p.utm_source || '', utm_medium: p.utm_medium || '', utm_campaign: p.utm_campaign || '' }); p.link = `${site}${p.landing || '/'}${(p.landing || '/').includes('?') ? '&' : '?'}${u}`; });
  const editB = req.query.banner ? banners.find((b) => b.id === Number(req.query.banner)) : null;
  res.render('admin/digital', { title: 'Digital marketing', banners, promos, coupons, editB, imgUrl: catalog.imgUrl });
});
router.post('/marketing/banners/save', upload.single('file'), verifyCsrf, async (req, res) => {
  const b = req.body;
  try {
    if (!str(b.title)) throw new Error('Banner title is required.');
    let image = b.keep_image || null;
    if (req.file) image = await imgstore.save(req.file, 'Banners', 'banner'); else if (str(b.link_image)) image = imgstore.fromLink(b.link_image) || image;
    const f = [str(b.title, 100), str(b.subtitle, 200), image, str(b.cta_text, 40), str(b.link, 200) || '/products', ['lilac', 'gold', 'ink'].includes(b.theme) ? b.theme : 'lilac', b.active ? 1 : 0, date(b.starts_on), date(b.ends_on), Math.round(num(b.sort))];
    if (b.id) await db.run('UPDATE banners SET title=?,subtitle=?,image=?,cta_text=?,link=?,theme=?,active=?,starts_on=?,ends_on=?,sort=? WHERE id=?', [...f, Number(b.id)]);
    else await db.run('INSERT INTO banners(title,subtitle,image,cta_text,link,theme,active,starts_on,ends_on,sort) VALUES(?,?,?,?,?,?,?,?,?,?)', f);
    res.flash('Banner saved. It appears in the home page carousel while active.');
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/marketing/digital');
});
router.post('/marketing/banners/:id(\\d+)/delete', async (req, res) => { await db.run('DELETE FROM banners WHERE id=?', [req.params.id]); res.redirect('/admin/marketing/digital'); });
router.post('/marketing/banners/:id(\\d+)/toggle', async (req, res) => { await db.run('UPDATE banners SET active = 1 - active WHERE id=?', [req.params.id]); res.redirect('/admin/marketing/digital'); });
router.post('/marketing/promotions/save', async (req, res) => {
  const b = req.body;
  if (!str(b.name)) res.flash('Promotion name is required.', 'err');
  else {
    const f = [str(b.name, 100), str(b.channel, 30), str(b.coupon_code, 30).toUpperCase(), str(b.content, 1000), str(b.landing, 200) || '/', str(b.utm_source, 40) || str(b.channel, 30).toLowerCase(), str(b.utm_medium, 40) || 'social', slugify(b.utm_campaign || b.name).replace(/-/g, '_'), date(b.starts_on), date(b.ends_on), ['planned', 'live', 'ended'].includes(b.status) ? b.status : 'planned'];
    await db.run('INSERT INTO promotions(name,channel,coupon_code,content,landing,utm_source,utm_medium,utm_campaign,starts_on,ends_on,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)', f);
    res.flash('Promotion saved. Copy its tracking link from the table.');
  }
  res.redirect('/admin/marketing/digital');
});
router.post('/marketing/promotions/:id(\\d+)/delete', async (req, res) => { await db.run('DELETE FROM promotions WHERE id=?', [req.params.id]); res.redirect('/admin/marketing/digital'); });

/* ---------------- SEO ---------------- */
function audit(p) {
  const issues = []; const t = p.seoTitle || ''; const d = p.seoDesc || '';
  if (!t) issues.push(['No SEO title (falls back to product name)', 15]); else if (t.length < 30 || t.length > 60) issues.push([`Title is ${t.length} chars (aim for 30-60)`, 8]);
  if (!d) issues.push(['No meta description', 25]); else if (d.length < 70 || d.length > 160) issues.push([`Description is ${d.length} chars (aim for 70-160)`, 10]);
  if (!p.seoKeywords) issues.push(['No keywords', 10]);
  if (!p.hasImage) issues.push(['No product image', 20]);
  if (!p.imageAlt || p.imageAlt.trim().toLowerCase() === p.name.trim().toLowerCase()) issues.push(['Image alt text is just the product name - describe the image', 8]);
  if (p.slug.length > 60) issues.push(['URL slug is long (>60 chars)', 5]);
  if ((p.description || '').length < 80) issues.push(['Description is thin (<80 chars)', 10]);
  return { issues, score: Math.max(0, 100 - issues.reduce((s, i) => s + i[1], 0)) };
}
router.get('/marketing/seo', async (req, res, next) => {
  try {
    const r = A.range(req.query, 30);
    const rows = catalog.all.map((p) => ({ p, ...audit(p) }));
    const titles = {}; rows.forEach((x) => { if (x.p.seoTitle) (titles[x.p.seoTitle] = titles[x.p.seoTitle] || []).push(x.p.name); });
    const dupes = Object.entries(titles).filter(([, v]) => v.length > 1);
    const perf = await A.seoPerformance(r);
    const pp = await A.productPerformance(r);
    const opps = [
      ...rows.filter((x) => x.score < 60).slice(0, 5).map((x) => `"${x.p.name}" scores ${x.score}/100: ${x.issues[0] ? x.issues[0][0] : ''}`),
      ...dupes.map(([t, v]) => `Duplicate SEO title "${t}" on ${v.join(', ')}`),
      ...perf.searches.filter((s) => !s.results).map((s) => `Customers searched "${s.term}" ${s.n}x and found nothing. Add this product or keyword.`),
      ...pp.all.filter((x) => x.views >= 10 && x.conv < 1).slice(0, 4).map((x) => `"${x.name}" has ${x.views} views but a ${x.conv}% conversion rate. Review its price, photos and description.`)
    ];
    const avg = rows.length ? Math.round(rows.reduce((s, x) => s + x.score, 0) / rows.length) : 0;
    res.render('admin/seo', { title: 'SEO optimization', r, rows: rows.sort((a, b) => a.score - b.score), cats: catalog.categories, perf, opps, avg, tab: req.query.tab || 'products' });
  } catch (e) { next(e); }
});
router.post('/marketing/seo/product/:id(\\d+)', async (req, res) => {
  const b = req.body; const id = Number(req.params.id);
  try {
    const slug = slugify(b.slug || ''); const old = await db.one('SELECT slug FROM products WHERE id=?', [id]);
    if (!slug) throw new Error('URL cannot be empty.');
    if (await db.val('SELECT id FROM products WHERE slug=? AND id!=?', [slug, id], 0)) throw new Error('That URL is already used by another product.');
    await db.run('UPDATE products SET seo_title=?, seo_desc=?, seo_keywords=?, image_alt=?, slug=?, updated_at=? WHERE id=?', [str(b.seo_title, 120) || null, str(b.seo_desc, 320) || null, str(b.seo_keywords, 300) || null, str(b.image_alt, 200) || null, slug, db.nowIso(), id]);
    if (old.slug !== slug) await db.run('INSERT OR REPLACE INTO slug_redirects(from_path,to_path) VALUES(?,?)', [`/products/${old.slug}`, `/products/${slug}`]);
    await catalog.refresh(); res.flash('SEO details saved' + (old.slug !== slug ? '. The old URL now redirects (301) to the new one.' : '.'));
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/marketing/seo');
});
router.post('/marketing/seo/category/:slug', async (req, res) => {
  const b = req.body;
  await db.run('UPDATE categories SET seo_title=?, seo_desc=?, seo_keywords=? WHERE slug=?', [str(b.seo_title, 120) || null, str(b.seo_desc, 320) || null, str(b.seo_keywords, 300) || null, req.params.slug]);
  await catalog.refresh(); res.flash('Category SEO saved.'); res.redirect('/admin/marketing/seo?tab=categories');
});
module.exports = router;
