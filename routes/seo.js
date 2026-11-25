const router = require('express').Router();
const catalog = require('../lib/catalog');
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const base = (req) => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// robots.txt: private / per-customer pages blocked; they also send noindex (lib/seo.js NOINDEX)
router.get('/robots.txt', (req, res) => {
  const block = ['/admin', '/cart', '/checkout', '/account', '/login', '/order/', '/review/', '/track', '/api/', '/webhooks/', '/products?q=', '/*?q=', '/*&q='];
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
    .send(`User-agent: *\nAllow: /\n${block.map((p) => `Disallow: ${p}`).join('\n')}\n\nSitemap: ${base(req)}/sitemap.xml\n`);
});
// sitemap.xml: built from the live catalogue, so new / removed products appear automatically
router.get('/sitemap.xml', (req, res) => {
  const b = base(req); const esc = (v) => xml(v);
  const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
  const newest = catalog.products.reduce((m, p) => (day(p.updatedAt) && day(p.updatedAt) > m ? day(p.updatedAt) : m), '');
  const abs = (u) => (u && u.startsWith('/') ? b + u : u);
  const entries = [
    { loc: '/', lastmod: newest }, { loc: '/products', lastmod: newest }, { loc: '/new-arrivals', lastmod: newest },
    ...catalog.categories.filter((c) => c.count).map((c) => ({ loc: `/collections/${c.slug}`, lastmod: catalog.inCategory(c.slug).reduce((m, p) => (day(p.updatedAt) > m ? day(p.updatedAt) : m), '') })),
    ...catalog.products.map((p) => ({ loc: `/products/${p.slug}`, lastmod: day(p.updatedAt), images: p.hasImage ? p.images.slice(0, 5).map((i) => ({ url: abs(i), title: p.name })) : [] })),
    ...require('../lib/pages').slugs.map((s) => ({ loc: `/pages/${s}` }))
  ];
  res.type('application/xml').set('Cache-Control', 'public, max-age=900').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.map((e) => `<url><loc>${esc(b + e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}${(e.images || []).map((i) => `<image:image><image:loc>${esc(i.url)}</image:loc><image:title>${esc(i.title)}</image:title></image:image>`).join('')}</url>`).join('\n')}
</urlset>`);
});
// Product catalogue feed (Google Merchant RSS 2.0 format, also accepted by Meta Commerce Manager).
// One item per variant, grouped by product. Public on purpose: Meta / Google fetch it on a schedule.
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
