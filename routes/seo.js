const router = require('express').Router();
const catalog = require('../lib/catalog');
const base = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /account\nDisallow: /login\n\nSitemap: ${base(req)}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
  const b = base(req);
  const urls = ['/', '/products', '/new-arrivals', ...catalog.categories.map((c) => `/collections/${c.slug}`), ...catalog.products.map((p) => `/products/${p.slug}`)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${b}${u}</loc></url>`).join('\n')}\n</urlset>`);
});
// Product catalogue feed (Google Merchant RSS 2.0 format, also accepted by Meta Commerce Manager).
// One item per variant, grouped by product. Public on purpose: Meta / Google fetch it on a schedule.
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
router.get('/feeds/products.xml', (req, res) => {
  const b = base(req); const abs = (u) => (u && u.startsWith('/') ? b + u : u);
  const brand = require('../lib/settings').get('store_name') || 'MythosBySS';
  const items = [];
  for (const p of catalog.products) {
    if (!p.hasImage) continue; // Meta and Google reject items without an image
    const cat = (catalog.catBySlug[p.category] || {}).name || '';
    for (const v of p.variants) {
      const imgs = (v.images.length ? v.images : p.images).map(abs);
      const sale = v.mrp && v.price < v.mrp;
      items.push(`<item>
<g:id>${xml(v.sku || p.slug + '-' + v.id)}</g:id>
<g:item_group_id>${xml(p.slug)}</g:item_group_id>
<g:title>${xml((p.name + (p.multi && v.label ? ' - ' + v.label : '')).slice(0, 150))}</g:title>
<g:description>${xml((p.description || p.name).slice(0, 4900))}</g:description>
<g:link>${xml(`${b}/products/${p.slug}${p.multi ? '?v=' + encodeURIComponent(v.sku) : ''}`)}</g:link>
<g:image_link>${xml(imgs[0])}</g:image_link>
${imgs.slice(1, 10).map((i) => `<g:additional_image_link>${xml(i)}</g:additional_image_link>`).join('\n')}
<g:availability>${v.stock > 0 ? 'in stock' : 'out of stock'}</g:availability>
<g:inventory>${Math.max(0, v.stock)}</g:inventory>
<g:price>${(sale ? v.mrp : v.price).toFixed(2)} INR</g:price>
${sale ? `<g:sale_price>${v.price.toFixed(2)} INR</g:sale_price>` : ''}
<g:brand>${xml(brand)}</g:brand>
<g:condition>new</g:condition>
${cat ? `<g:product_type>${xml(cat)}</g:product_type>` : ''}
${v.label && p.multi ? `<g:size>${xml(v.label)}</g:size>` : ''}
</item>`);
    }
  }
  res.set('Cache-Control', 'public, max-age=900').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>
<title>${xml(brand)} products</title><link>${xml(b)}</link><description>${xml(brand)} product catalogue</description>
${items.join('\n')}
</channel></rss>`);
});
module.exports = router;
