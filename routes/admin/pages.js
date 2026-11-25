// Admin > Website > Policy pages & support: edit policy page text and the WhatsApp support button.
const router = require('express').Router();
const settings = require('../../lib/settings');
const pages = require('../../lib/pages');

router.get('/website/pages', (req, res) => {
  const list = pages.slugs.map((slug) => ({ slug, title: pages.title(slug), text: pages.text(slug), draft: pages.isDraft(slug) }));
  res.render('admin/pages', { title: 'Policy pages & support', list, s: settings.all(), open: req.query.page || '' });
});

router.post('/website/pages/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!pages.slugs.includes(slug)) return res.redirect('/admin/website/pages');
  if (req.body.reset) { await settings.set('page_' + slug, ''); res.flash(`${pages.title(slug)}: back to the starting draft.`); }
  else {
    const text = String(req.body.text || '').replace(/\r/g, '').trim().slice(0, 20000);
    if (!text) { res.flash('The page cannot be empty.', 'err'); return res.redirect(`/admin/website/pages?page=${slug}#${slug}`); }
    await settings.set('page_' + slug, text); res.flash(`${pages.title(slug)} saved. It is live at /pages/${slug}.`);
  }
  res.redirect(`/admin/website/pages?page=${slug}#${slug}`);
});

router.post('/website/support', async (req, res) => {
  const wa = String(req.body.support_whatsapp || '').replace(/\D/g, '').slice(-10);
  const phone = String(req.body.support_phone || '').replace(/\D/g, '').slice(-10);
  if (wa && !/^[6-9]\d{9}$/.test(wa)) { res.flash('WhatsApp number must be a 10-digit Indian mobile number.', 'err'); return res.redirect('/admin/website/pages'); }
  await settings.set('support_whatsapp', wa);
  await settings.set('support_phone', phone);
  await settings.set('support_email', String(req.body.support_email || '').trim().slice(0, 120));
  await settings.set('whatsapp_button_enabled', req.body.whatsapp_button_enabled ? '1' : '0');
  await settings.set('whatsapp_button_text', String(req.body.whatsapp_button_text || '').trim().slice(0, 300));
  res.flash('Support details saved.'); res.redirect('/admin/website/pages');
});

module.exports = router;
