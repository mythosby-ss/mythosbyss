(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const csrf = () => document.querySelector('meta[name="csrf-token"]').content;
  const money = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
  window.MB = { $, $$, csrf, money };

  // Fallback for broken images (Drive links, missing files). error events don't bubble, so capture.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && !t.dataset.fallback) { t.dataset.fallback = '1'; t.src = '/images/placeholder.svg'; }
  }, true);

  function toast(msg) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600);
  }
  window.MB.toast = toast;

  // Marketing: AddToCart for forms that add products without the product-page script (cart add-ons)
  const track = (...items) => { try { if (window.MBTrack && items.length) window.MBTrack('add_to_cart', { items }); } catch (_) { /* never break shopping */ } };
  document.addEventListener('submit', (e) => {
    const f = e.target.closest && e.target.closest('form[data-track-add]'); if (!f) return;
    try { track(JSON.parse(f.dataset.trackAdd)); } catch (_) { /* ignore */ }
  });

  // UGC videos: swap the thumbnail for the Google Drive player when clicked
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-video]'); if (!b) return;
    const f = document.createElement('iframe');
    f.src = 'https://drive.google.com/file/d/' + encodeURIComponent(b.dataset.video) + '/preview';
    f.allow = 'autoplay; fullscreen'; f.setAttribute('allowfullscreen', ''); f.title = 'Customer video';
    f.className = 'absolute inset-0 w-full h-full border-0'; b.replaceWith(f);
  });

  // Mobile menu
  const menuBtn = $('[data-menu-toggle]');
  if (menuBtn) menuBtn.addEventListener('click', () => {
    const m = $('#mobile-menu'); const open = m.classList.toggle('hidden') === false;
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  // Auto-submit selects
  $$('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // Hero carousel
  $$('[data-carousel]').forEach((root) => {
    const slides = $$('[data-slide]', root); let i = 0; let timer;
    const show = (n) => { i = (n + slides.length) % slides.length; slides.forEach((s, k) => s.classList.toggle('hidden', k !== i)); };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = () => { if (!reduce) timer = setInterval(() => show(i + 1), 6000); };
    const stop = () => clearInterval(timer);
    $('[data-prev]', root).addEventListener('click', () => { stop(); show(i - 1); });
    $('[data-next]', root).addEventListener('click', () => { stop(); show(i + 1); });
    root.addEventListener('mouseenter', stop); root.addEventListener('mouseleave', start); start();
  });

  // Product page
  const prod = $('[data-product]');
  if (prod) {
    const variants = JSON.parse(prod.dataset.variants);
    const productImages = JSON.parse(prod.dataset.productImages);
    const gallery = $('[data-gallery]', prod);
    const form = $('[data-buy-form]', prod); const qty = $('[data-qty]', prod);
    const showGallery = (images) => {
      const selectedImages = images.length ? images : productImages;
      const frame = document.createElement('div');
      frame.className = 'aspect-square rounded-2xl overflow-hidden bg-paper border border-neutral-200';
      const main = document.createElement('img');
      main.dataset.mainImage = '';
      main.src = selectedImages[0];
      main.alt = $('[data-main-image]', gallery)?.alt || '';
      main.className = 'w-full h-full object-cover';
      frame.appendChild(main);
      gallery.replaceChildren(frame);
      if (selectedImages.length > 1) {
        const thumbs = document.createElement('div');
        thumbs.className = 'mt-3 grid grid-cols-5 gap-3';
        selectedImages.forEach((src, i) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.thumb = src;
          button.className = `aspect-square rounded-lg overflow-hidden border ${i === 0 ? 'border-ink' : 'border-neutral-200'}`;
          button.setAttribute('aria-label', `Show image ${i + 1}`);
          const image = document.createElement('img');
          image.src = src;
          image.alt = '';
          image.loading = 'lazy';
          image.className = 'w-full h-full object-cover';
          button.appendChild(image);
          thumbs.appendChild(button);
        });
        gallery.appendChild(thumbs);
      }
    };
    const setVariant = (sku) => {
      const v = variants.find((x) => x.sku === sku); if (!v) return;
      $('[data-sku]', prod).value = sku; $('[data-price]', prod).textContent = money(v.price); $('[data-mrp]', prod).textContent = money(v.mrp);
      showGallery(v.images || []);
      const st = $('[data-stock]', prod);
      st.textContent = v.stock <= 0 ? 'Out of stock' : v.stock <= 5 ? 'Only ' + v.stock + ' left' : 'In stock';
      st.className = 'mt-4 text-sm font-medium ' + (v.stock <= 0 ? 'text-red-600' : v.stock <= 5 ? 'text-amber-600' : 'text-green-700');
      $('[data-add-to-cart]', prod).disabled = v.stock <= 0; $('[data-buy-now]', prod).disabled = v.stock <= 0;
      qty.max = Math.min(10, v.stock || 1); clamp();
      history.replaceState(null, '', '?v=' + encodeURIComponent(sku));
    };
    $$('input[name="variant"]', prod).forEach((r) => r.addEventListener('change', () => setVariant(r.value)));
    const maxQ = () => { const v = variants.find((x) => x.sku === $('[data-sku]', prod).value); return Math.max(1, Math.min(10, v ? v.stock : 10)); };
    const clamp = () => { qty.value = Math.min(maxQ(), Math.max(1, parseInt(qty.value, 10) || 1)); };
    $('[data-qty-dec]', prod).addEventListener('click', () => { qty.value = (parseInt(qty.value, 10) || 1) - 1; clamp(); });
    $('[data-qty-inc]', prod).addEventListener('click', () => { qty.value = (parseInt(qty.value, 10) || 1) + 1; clamp(); });
    qty.addEventListener('change', clamp);

    gallery.addEventListener('click', (e) => {
      const b = e.target.closest('[data-thumb]');
      if (!b) return;
      $('[data-main-image]', prod).src = b.dataset.thumb;
      $$('[data-thumb]', gallery).forEach((x) => { x.classList.toggle('border-ink', x === b); x.classList.toggle('border-neutral-200', x !== b); });
    });

    // Add to cart via fetch (falls back to normal form post if JS is off)
    const addBtn = $('[data-add-to-cart]', prod);
    form.addEventListener('submit', async (e) => {
      if (e.submitter !== addBtn) { // Buy now posts normally; still report AddToCart
        const v = variants.find((x) => x.sku === form.sku.value) || {};
        track({ id: form.sku.value, name: ($('h1') || {}).textContent, variant: v.label, price: v.price, qty: Number(qty.value) || 1 });
        return;
      }
      e.preventDefault(); clamp(); addBtn.disabled = true;
      try {
        const res = await fetch('/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ slug: form.slug.value, sku: form.sku.value, qty: qty.value }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message);
        const badge = $('[data-cart-count]'); badge.textContent = data.count; badge.classList.remove('hidden');
        toast('Added to cart');
        if (window.MBTrack) {
          try {
            const ev = JSON.parse(document.getElementById('mb-event').textContent).items[0];
            const v = variants.find((x) => x.sku === form.sku.value) || {};
            window.MBTrack('add_to_cart', { items: [{ ...ev, id: form.sku.value, variant: v.label || ev.variant, price: v.price || ev.price, qty: Number(qty.value) || 1 }] });
          } catch (_) { /* tracking must never break the cart */ }
        }
      } catch (err) { toast(err.message || 'Could not add to cart'); }
      addBtn.disabled = false;
    });

    // Frequently bought together: live total, and keep "This item" in sync with the chosen size
    const fbt = $('[data-fbt]');
    if (fbt) {
      const boxes = $$('input[name="add"]', fbt);
      const total = () => {
        const on = boxes.filter((b) => b.checked);
        $('[data-fbt-total]', fbt).textContent = money(on.reduce((s, b) => s + Number(b.dataset.price), 0));
        $('[data-fbt-btn]', fbt).disabled = !on.length;
      };
      boxes.forEach((b) => b.addEventListener('change', total));
      fbt.addEventListener('submit', () => track(...boxes.filter((b) => b.checked).map((b) => ({ id: b.value.split(':')[1], price: Number(b.dataset.price), qty: 1 }))));
      $$('input[name="variant"]', prod).forEach((r) => r.addEventListener('change', () => {
        const v = variants.find((x) => x.sku === r.value); const main = $('[data-fbt-main]', fbt);
        if (v && main) { main.value = main.value.split(':')[0] + ':' + v.sku; main.dataset.price = v.price; total(); }
      }));
    }

    // Delivery check: pincode rules from Admin > Settings > COD & RTO rules (GET /api/pincode/:pin)
    const pf = $('[data-pincode]', prod);
    pf.addEventListener('submit', (e) => {
      e.preventDefault(); const pin = $('#pin').value.trim(); const out = $('[data-pin-result]', prod);
      out.classList.remove('hidden');
      if (!/^[1-9]\d{5}$/.test(pin)) { out.className = 'mt-3 text-sm text-red-600'; out.textContent = 'Enter a valid 6-digit pincode.'; return; }
      out.className = 'mt-3 text-sm text-neutral-600'; out.textContent = 'Checking...';
      fetch('/api/pincode/' + pin, { headers: { Accept: 'application/json' } }).then((r) => r.json()).then((d) => {
        out.className = 'mt-3 text-sm ' + (d.ok && d.serviceable ? 'text-green-700' : 'text-red-600'); out.textContent = d.message || 'Please try again.';
      }).catch(() => { out.className = 'mt-3 text-sm text-red-600'; out.textContent = 'Could not check right now. Please try again.'; });
    });
  }
})();
