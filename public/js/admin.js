(function () {
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const side = document.getElementById('adm-side');
  const btn = document.querySelector('[data-adm-menu]');
  if (btn && side) btn.addEventListener('click', () => { side.classList.toggle('hidden'); side.classList.toggle('flex'); });
  $$('[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));
  $$('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));
  $$('[data-select-all]').forEach((c) => c.addEventListener('change', () => $$('[data-row-check]').forEach((x) => { x.checked = c.checked; })));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1500); } catch (_) {} }));

  const openPlugin = (id) => {
    const modal = document.getElementById(`modal-${id}`);
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const panel = modal.querySelector('.absolute.inset-y-0');
    if (panel) {
      panel.style.transform = 'translateX(100%)';
      requestAnimationFrame(() => {
        panel.style.transition = 'transform 0.25s cubic-bezier(.4,0,.2,1)';
        panel.style.transform = 'translateX(0)';
      });
    }
  };
  const closePlugin = (id) => {
    const modal = document.getElementById(`modal-${id}`);
    if (!modal) return;
    const panel = modal.querySelector('.absolute.inset-y-0');
    const hide = () => {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    };
    if (panel) {
      panel.style.transform = 'translateX(100%)';
      setTimeout(hide, 260);
    } else {
      hide();
    }
  };
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-plugin-open], [data-plugin-close], [data-plugin-toggle-secret]');
    if (!target) return;
    if (target.hasAttribute('data-plugin-open')) openPlugin(target.dataset.pluginOpen);
    else if (target.hasAttribute('data-plugin-close')) closePlugin(target.dataset.pluginClose);
    else {
      const input = document.getElementById(target.dataset.pluginToggleSecret);
      if (input) input.type = input.type === 'password' ? 'text' : 'password';
    }
  });
  // /admin/plugins#googledrive opens that plugin's popup directly
  if (location.hash && document.getElementById(`modal-${location.hash.slice(1)}`)) openPlugin(location.hash.slice(1));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('[id^="modal-"]:not(.hidden)').forEach((modal) => closePlugin(modal.id.slice('modal-'.length)));
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-plugin-open][role="button"]')) {
      e.preventDefault();
      openPlugin(e.target.dataset.pluginOpen);
    }
  });

  // product form: add / remove variant rows
  const rows = document.getElementById('variant-rows');
  if (rows) {
    const tpl = document.getElementById('variant-tpl');
    document.getElementById('add-variant').addEventListener('click', () => rows.appendChild(tpl.content.cloneNode(true)));
    rows.addEventListener('click', (e) => { const b = e.target.closest('[data-remove-variant]'); if (b && rows.children.length > 1) b.closest('[data-variant]').remove(); });
    // live SEO length counters
    $$('[data-count]').forEach((i) => { const out = document.getElementById(i.dataset.count); const u = () => { out.textContent = i.value.length; }; i.addEventListener('input', u); u(); });
  }

  // Copy buttons: <button data-copy="#input-id">
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const el = document.querySelector(b.dataset.copy); if (!el) return;
    try { await navigator.clipboard.writeText(el.value || el.textContent); } catch (_) { el.select && el.select(); document.execCommand('copy'); }
    const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = t; }, 1500);
  });

  // Billing: derive PAN and state from the GSTIN
  const gstForm = document.querySelector('[data-gst-form]');
  if (gstForm) {
    const states = JSON.parse((document.getElementById('gst-states') || {}).textContent || '{}');
    const fill = (loud) => {
      const g = gstForm.biz_gstin.value.trim().toUpperCase(); gstForm.biz_gstin.value = g;
      if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) { if (loud) alert('Enter a valid 15-character GSTIN first, like 09ABCDE1234F1Z5.'); return; }
      gstForm.biz_pan.value = g.slice(2, 12);
      if (states[g.slice(0, 2)]) gstForm.biz_state.value = states[g.slice(0, 2)];
    };
    gstForm.querySelector('[data-gst-fill]').addEventListener('click', () => fill(true));
    gstForm.biz_gstin.addEventListener('change', () => fill(false));
  }
})();
