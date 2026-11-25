// Admin > Offers > Bundles, add-ons & offers: free-delivery threshold, quantity offers, bundles, "frequently bought together".
const router = require('express').Router();
const db = require('../../lib/db');
const settings = require('../../lib/settings');
const catalog = require('../../lib/catalog');
const cartLib = require('../../lib/cart');

const int = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || 0));

router.get('/offers', async (req, res, next) => {
  try {
    const variants = []; // every variant, for the pickers
    catalog.all.forEach((p) => p.variants.forEach((v) => variants.push({ sku: v.sku, name: p.name, label: v.label, price: v.price, isBundle: !!v.isBundle })));
    const bundles = [];
    catalog.all.forEach((p) => p.variants.filter((v) => v.isBundle).forEach((v) => bundles.push({ product: p, v })));
    const addonRows = await db.q('SELECT * FROM product_addons ORDER BY product_slug, sort');
    const addons = {}; addonRows.forEach((r) => { (addons[r.product_slug] = addons[r.product_slug] || []).push(r.addon_slug); });
    const edit = req.query.bundle ? catalog.all.flatMap((p) => p.variants).find((v) => v.sku === req.query.bundle) : null;
    res.render('admin/offers', { title: 'Bundles, add-ons & offers', s: settings.all(), tiers: cartLib.offerTiers(), variants, bundles, addons,
      products: catalog.all, bySlug: Object.fromEntries(catalog.all.map((p) => [p.slug, p])), edit, editAddon: req.query.addon || '' });
  } catch (e) { next(e); }
});

router.post('/offers/settings', async (req, res) => {
  const b = req.body;
  const tiers = String(b.qty_offer_tiers || '').trim().slice(0, 200);
  await settings.set('qty_offer_tiers', tiers);
  await settings.set('qty_offer_on_bundles', b.qty_offer_on_bundles ? '1' : '0');
  await settings.set('shipping_fee', String(int(b.shipping_fee, 0, 10000)));
  await settings.set('free_shipping_threshold', String(int(b.free_shipping_threshold, 0, 100000)));
  await settings.set('upsell_enabled', b.upsell_enabled ? '1' : '0');
  await settings.set('upsell_auto', b.upsell_auto ? '1' : '0');
  await settings.set('upsell_max', String(int(b.upsell_max, 1, 6)));
  const parsed = cartLib.offerTiers();
  if (tiers && !parsed.length) res.flash('Saved, but the quantity offer format was not understood. Use e.g. "2:30, 3:75".', 'err');
  else res.flash('Offer settings saved.');
  res.redirect('/admin/offers');
});

// Bundle = an existing variant (create the combo as a normal product first) + its component variants
router.post('/offers/bundles', async (req, res) => {
  const bundle = String(req.body.bundle_sku || '').trim();
  const all = new Map(catalog.all.flatMap((p) => p.variants).map((v) => [v.sku, v]));
  try {
    if (!all.has(bundle)) throw new Error('Choose the bundle product (variant).');
    if (req.body.remove) {
      await db.run('DELETE FROM bundle_items WHERE bundle_sku=?', [bundle]);
      await catalog.refresh(); res.flash(`${bundle} is a normal product again (its own stock count is used).`); return res.redirect('/admin/offers#bundles');
    }
    const skus = [].concat(req.body.component_sku || []); const qtys = [].concat(req.body.component_qty || []);
    const comps = {};
    skus.forEach((sku, i) => {
      sku = String(sku || '').trim(); if (!sku) return;
      if (!all.has(sku)) throw new Error(`Unknown SKU ${sku}.`);
      if (sku === bundle) throw new Error('A bundle cannot contain itself.');
      if (catalog.isBundleSku(sku)) throw new Error(`${sku} is itself a bundle. Add its items directly instead.`);
      comps[sku] = (comps[sku] || 0) + int(qtys[i], 1, 20);
    });
    if (Object.keys(comps).length < 1) throw new Error('Add at least one item to the bundle.');
    if ((await db.q('SELECT component_sku FROM bundle_items WHERE component_sku=?', [bundle])).length) throw new Error(`${bundle} is used inside another bundle, so it cannot be a bundle itself.`);
    await db.batch([['DELETE FROM bundle_items WHERE bundle_sku=?', [bundle]], ...Object.entries(comps).map(([sku, qty]) => ['INSERT INTO bundle_items(bundle_sku,component_sku,qty) VALUES(?,?,?)', [bundle, sku, qty]])]);
    await catalog.refresh();
    res.flash(`Bundle ${bundle} saved with ${Object.keys(comps).length} item(s). Its stock now follows the items' stock.`);
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/offers#bundles');
});

router.post('/offers/addons', async (req, res) => {
  const slug = String(req.body.product_slug || '');
  if (!catalog.all.some((p) => p.slug === slug)) { res.flash('Choose a product.', 'err'); return res.redirect('/admin/offers#addons'); }
  const picks = [...new Set([].concat(req.body.addon_slug || []).map(String).filter((s) => s && s !== slug && catalog.all.some((p) => p.slug === s)))].slice(0, 6);
  await db.batch([['DELETE FROM product_addons WHERE product_slug=?', [slug]], ...picks.map((s, i) => ['INSERT INTO product_addons(product_slug,addon_slug,sort) VALUES(?,?,?)', [slug, s, i]])]);
  res.flash(picks.length ? `Add-ons saved for ${slug}.` : `Add-ons cleared for ${slug}${settings.on('upsell_auto') ? ' (automatic suggestions will be used)' : ''}.`);
  res.redirect('/admin/offers#addons');
});

module.exports = router;
