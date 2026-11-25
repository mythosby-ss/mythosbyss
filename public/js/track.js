// Storefront marketing tags: Meta Pixel, GA4, Google Ads conversions and Google Tag Manager.
// IDs come from Admin → Settings → Marketing & tracking (rendered into #mb-track). Page events come from #mb-event.
// Exposes window.MBTrack(name, data) for events fired from other scripts (add_to_cart).
(function () {
  let cfg;
  try { cfg = JSON.parse(document.getElementById('mb-track').textContent); } catch (_) { return; }
  const load = (src) => { const s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); };

  // Meta Pixel (standard loader stub, without inline script)
  if (cfg.pixel) {
    const f = window;
    if (!f.fbq) {
      const n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
      load('https://connect.facebook.net/en_US/fbevents.js');
    }
    f.fbq('init', cfg.pixel);
    f.fbq('track', 'PageView');
  }

  // Google tag (GA4 + Google Ads share gtag.js)
  const gid = cfg.ga4 || cfg.gads;
  if (gid) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (cfg.ga4) window.gtag('config', cfg.ga4);
    if (cfg.gads) window.gtag('config', cfg.gads);
    load('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gid));
  }

  // Google Tag Manager
  if (cfg.gtm) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    load('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.gtm));
  }

  const META = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };
  const META_CUSTOM = { cod_placed: 'COD_Placed' }; // COD order placed but not confirmed: NOT a Purchase
  function MBTrack(name, d) {
    d = d || {};
    const items = d.items || [];
    const value = Number(d.value || items.reduce((s, i) => s + i.price * (i.qty || 1), 0));
    if (window.fbq && cfg.pixel && (META[name] || META_CUSTOM[name])) {
      const p = { content_ids: items.map((i) => i.id), content_type: 'product', contents: items.map((i) => ({ id: i.id, quantity: i.qty || 1 })), value, currency: 'INR' };
      if (items.length === 1) p.content_name = items[0].name;
      if (name === 'begin_checkout' || name === 'purchase') p.num_items = items.reduce((s, i) => s + (i.qty || 1), 0);
      // eventID lets Meta de-duplicate this with the server-side Conversions API purchase event
      const opts = d.eventId ? { eventID: d.eventId } : undefined;
      if (META[name]) window.fbq('track', META[name], p, opts); else window.fbq('trackCustom', META_CUSTOM[name], p, opts);
    }
    if (window.gtag) {
      const p = { currency: 'INR', value, items: items.map((i) => ({ item_id: i.id, item_name: i.name, item_variant: i.variant, price: i.price, quantity: i.qty || 1 })) };
      if (d.id) p.transaction_id = d.id;
      if (cfg.ga4) window.gtag('event', name, { ...p, send_to: cfg.ga4 });
      const label = name !== 'cod_placed' && cfg.gads && cfg.labels && cfg.labels[name];
      if (label) window.gtag('event', 'conversion', { send_to: cfg.gads + '/' + label, value, currency: 'INR', ...(d.id ? { transaction_id: d.id } : {}) });
    }
    if (cfg.gtm) window.dataLayer.push({ event: name, ecommerce: { currency: 'INR', value, transaction_id: d.id, items: items.map((i) => ({ item_id: i.id, item_name: i.name, item_variant: i.variant, price: i.price, quantity: i.qty || 1 })) } });
  }
  window.MBTrack = MBTrack;

  // Page event (product view, checkout, purchase). Purchase fires once per order, even if the page is reopened.
  const fire = () => {
    const el = document.getElementById('mb-event'); if (!el) return;
    let ev; try { ev = JSON.parse(el.textContent); } catch (_) { return; }
    if (ev.name === 'purchase' || ev.name === 'cod_placed') {
      const key = 'mb_tracked_' + ev.name + '_' + ev.id;
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (_) { /* storage blocked: still send once */ }
    }
    MBTrack(ev.name, ev);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fire); else fire();
})();
