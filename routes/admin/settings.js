// Settings sub-pages: Billing & invoice, Marketing & tracking, Shipping label.
const router = require('express').Router();
const multer = require('multer');
const settings = require('../../lib/settings');
const imgstore = require('../../lib/imgstore');
const verifyCsrf = require('../../lib/csrf');
const { GST_STATES } = require('../../lib/gst');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);

/* ---------------- Billing & invoice ---------------- */
router.get('/settings/billing', (req, res) => res.render('admin/settings-billing', { title: 'Billing & invoice', s: settings.all(), states: Object.values(GST_STATES), gstStates: GST_STATES }));
router.post('/settings/billing', async (req, res) => {
  const b = req.body;
  const gstin = str(b.biz_gstin, 15).toUpperCase().replace(/\s/g, '');
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) { res.flash('That GSTIN is not valid. It should be 15 characters, like 09ABCDE1234F1Z5.', 'err'); return res.redirect('/admin/settings/billing'); }
  const pan = str(b.biz_pan, 10).toUpperCase() || (gstin ? gstin.slice(2, 12) : '');
  if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) { res.flash('That PAN is not valid. It should look like ABCDE1234F.', 'err'); return res.redirect('/admin/settings/billing'); }
  const pin = str(b.biz_pincode, 6);
  if (pin && !/^[1-9]\d{5}$/.test(pin)) { res.flash('Pincode must be 6 digits.', 'err'); return res.redirect('/admin/settings/billing'); }
  const state = str(b.biz_state, 60) || (gstin ? GST_STATES[gstin.slice(0, 2)] || '' : '');
  const vals = {
    biz_gstin: gstin, biz_name: str(b.biz_name, 120), biz_phone: str(b.biz_phone, 15).replace(/[^\d+]/g, ''), biz_email: str(b.biz_email, 120),
    biz_address: str(b.biz_address, 300), biz_pincode: pin, biz_city: str(b.biz_city, 60), biz_state: state, biz_pan: pan,
    invoice_prefix: str(b.invoice_prefix, 12).replace(/[^A-Za-z0-9/_-]/g, '') || 'MBSS-', biz_hsn: str(b.biz_hsn, 8).replace(/\D/g, ''), invoice_note: str(b.invoice_note, 300)
  };
  for (const [k, v] of Object.entries(vals)) await settings.set(k, v);
  if (state) await settings.set('home_state', state); // used for CGST/SGST vs IGST in invoices and the GST report
  res.flash('Billing details saved.'); res.redirect('/admin/settings/billing');
});

/* ---------------- Marketing & tracking ---------------- */
// [key, label, validation regex (optional), secret?]
const MK = {
  mk_pixel_id: /^\d{10,20}$/, mk_capi_token: null, mk_catalogue_id: /^\d{6,20}$/, mk_fb_page_id: /^\d{5,20}$/, mk_fb_business_id: /^\d{5,20}$/,
  mk_report_link: /^https:\/\/\S+$/, mk_google_verification: /^[\w-]{10,100}$/,
  mk_ga4_id: /^G-[A-Z0-9]{4,15}$/, mk_ga4_api_secret: null, mk_gads_id: /^AW-\d{6,15}$/, mk_gmc_id: /^\d{5,15}$/, mk_gtm_id: /^GTM-[A-Z0-9]{4,10}$/,
  mk_gads_purchase_label: /^[\w-]{5,40}$/, mk_gads_a2c_label: /^[\w-]{5,40}$/, mk_gads_view_label: /^[\w-]{5,40}$/
};
const SECRET = ['mk_capi_token', 'mk_ga4_api_secret'];
const NAMES = { mk_pixel_id: 'Pixel ID', mk_catalogue_id: 'Catalogue ID', mk_fb_page_id: 'Facebook Page ID', mk_fb_business_id: 'Business Manager ID', mk_report_link: 'Marketing report link (must start with https://)', mk_google_verification: 'Google Search verification code', mk_ga4_id: 'GA4 Measurement ID (G-XXXXXXX)', mk_gads_id: 'Google Ads tag ID (AW-XXXXXXXXX)', mk_gmc_id: 'Merchant Center ID', mk_gtm_id: 'Tag Manager ID (GTM-XXXXXXX)', mk_gads_purchase_label: 'Purchase label', mk_gads_a2c_label: 'Add-to-cart label', mk_gads_view_label: 'View item label' };

router.get('/settings/marketing', (req, res) => {
  const s = settings.all();
  const view = { ...s }; SECRET.forEach((k) => { view[k] = ''; });
  const site = (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  res.render('admin/settings-marketing', { title: 'Marketing & tracking', s: view, has: Object.fromEntries(SECRET.map((k) => [k, Boolean(s[k])])), feedUrl: `${site}/feeds/products.xml` });
});
router.post('/settings/marketing', async (req, res) => {
  const b = req.body; const errs = [];
  for (const [k, re] of Object.entries(MK)) {
    let v = str(b[k], 500);
    if (k === 'mk_google_verification') { const m = v.match(/content="([^"]+)"/); if (m) v = m[1]; } // accept the full <meta> tag
    if (k === 'mk_gtm_id' || k === 'mk_ga4_id' || k === 'mk_gads_id') v = v.toUpperCase();
    if (SECRET.includes(k)) { if (b[k + '_clear'] === '1') await settings.set(k, ''); else if (v) await settings.set(k, v); continue; }
    if (v && re && !re.test(v)) { errs.push(NAMES[k] || k); continue; }
    await settings.set(k, v);
  }
  if (errs.length) res.flash(`Saved, except these fields which don't look right: ${errs.join(', ')}.`, 'err');
  else res.flash('Marketing settings saved. Tracking codes are live on the storefront.');
  res.redirect('/admin/settings/marketing');
});

/* ---------------- Shipping label ---------------- */
const LABEL_FLAGS = [
  ['label_prepaid_value', 'Display order value for prepaid shipments'], ['label_cod_value', 'Display order and collectable value for COD'],
  ['label_seller_phone', 'Display seller mobile number'], ['label_seller_address', 'Display my (return) address'],
  ['label_hide_items', 'Hide product name and SKU code'], ['label_product_code', 'Display product code'],
  ['label_brand_logo', 'Display brand logo'], ['label_hide_invoice_no', 'Hide invoice number and invoice date'],
  ['label_customer_phone', 'Display customer number'], ['label_order_details', 'Display order details (order ID, date, payment)'],
  ['label_repeat_customer', 'Display repeat customer badge'], ['label_unboxing', 'Display unboxing video note (for return claims)']
];
router.get('/settings/label', async (req, res) => res.render('admin/settings-label', { title: 'Shipping label', s: settings.all(), flags: LABEL_FLAGS,
  previewOrder: await require('../../lib/db').val("SELECT id FROM orders WHERE status NOT IN ('awaiting_payment') ORDER BY created_at DESC LIMIT 1") }));
router.post('/settings/label', upload.single('logo'), verifyCsrf, async (req, res) => {
  try {
    const b = req.body;
    await settings.set('label_type', ['with_invoice', 'without_invoice', 'tax_invoice'].includes(b.label_type) ? b.label_type : 'without_invoice');
    for (const [k] of LABEL_FLAGS) await settings.set(k, b[k] ? '1' : '0');
    if (req.file) await settings.set('label_logo', await imgstore.save(req.file, 'Brand', 'label-logo'));
    else if (b.logo_link) { const ref = imgstore.fromLink(b.logo_link); if (!ref) throw new Error('Logo link must be a Google Drive link or an https:// image URL.'); await settings.set('label_logo', ref); }
    if (b.remove_logo === '1') await settings.set('label_logo', '');
    res.flash('Shipping label settings saved.');
  } catch (e) { res.flash(e.message, 'err'); }
  res.redirect('/admin/settings/label');
});

module.exports = router;
