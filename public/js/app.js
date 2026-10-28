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
    const form = $('[data-buy-form]', prod); const qty = $('[data-qty]', prod);
    const setVariant = (sku) => {
      const v = variants.find((x) => x.sku === sku); if (!v) return;
      $('[data-sku]', prod).value = sku; $('[data-price]', prod).textContent = money(v.price); $('[data-mrp]', prod).textContent = money(v.mrp);
      history.replaceState(null, '', '?v=' + encodeURIComponent(sku));
    };
    $$('input[name="variant"]', prod).forEach((r) => r.addEventListener('change', () => setVariant(r.value)));
    const clamp = () => { qty.value = Math.min(10, Math.max(1, parseInt(qty.value, 10) || 1)); };
    $('[data-qty-dec]', prod).addEventListener('click', () => { qty.value = (parseInt(qty.value, 10) || 1) - 1; clamp(); });
    $('[data-qty-inc]', prod).addEventListener('click', () => { qty.value = (parseInt(qty.value, 10) || 1) + 1; clamp(); });
    qty.addEventListener('change', clamp);

    $$('[data-thumb]', prod).forEach((b) => b.addEventListener('click', () => {
      $('[data-main-image]', prod).src = b.dataset.thumb;
      $$('[data-thumb]', prod).forEach((x) => { x.classList.toggle('border-ink', x === b); x.classList.toggle('border-neutral-200', x !== b); });
    }));

    // Add to cart via fetch (falls back to normal form post if JS is off)
    const addBtn = $('[data-add-to-cart]', prod);
    form.addEventListener('submit', async (e) => {
      if (e.submitter !== addBtn) return; // Buy now posts normally
      e.preventDefault(); clamp(); addBtn.disabled = true;
      try {
        const res = await fetch('/cart/add', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() },
          body: JSON.stringify({ slug: form.slug.value, sku: form.sku.value, qty: qty.value }) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.message);
        const badge = $('[data-cart-count]'); badge.textContent = data.count; badge.classList.remove('hidden');
        toast('Added to cart');
      } catch (err) { toast(err.message || 'Could not add to cart'); }
      addBtn.disabled = false;
    });

    // Delivery check (estimate only - wire to a courier API such as Shiprocket for real serviceability)
    const pf = $('[data-pincode]', prod);
    pf.addEventListener('submit', (e) => {
      e.preventDefault(); const pin = $('#pin').value.trim(); const out = $('[data-pin-result]', prod);
      out.classList.remove('hidden');
      if (!/^[1-9]\d{5}$/.test(pin)) { out.className = 'mt-3 text-sm text-red-600'; out.textContent = 'Enter a valid 6-digit pincode.'; return; }
      out.className = 'mt-3 text-sm text-green-700'; out.textContent = 'Delivery to ' + pin + ' in 4-8 working days. Free shipping. COD available.';
    });
  }
})();
