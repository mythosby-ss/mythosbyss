(function () {
  const { $, csrf } = window.MB;
  const root = $('#login-root'); if (!root) return;
  const fPhone = $('#step-phone'); const fOtp = $('#step-otp'); const msg = $('[data-msg]', root);
  let phone = '';
  const show = (t, ok) => { msg.textContent = t || ''; msg.classList.toggle('hidden', !t); msg.className = 'mt-4 text-sm rounded-lg p-3 ' + (ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700') + (t ? '' : ' hidden'); };
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({ message: 'Unexpected response.' })) };
  };
  async function sendCode() {
    phone = $('#phone').value.replace(/\D/g, '').slice(-10);
    const btn = $('[data-send]'); btn.disabled = true; show('');
    const { ok, data } = await post('/login/request', { phone });
    btn.disabled = false;
    if (!ok) return show(data.message);
    fPhone.classList.add('hidden'); fOtp.classList.remove('hidden'); $('[data-phone-label]').textContent = '+91 ' + phone; $('#otp').focus();
    show(data.devOtp ? data.message + ' (Dev mode: your code is ' + data.devOtp + ')' : data.message, true);
  }
  fPhone.addEventListener('submit', (e) => { e.preventDefault(); sendCode(); });
  $('[data-resend]').addEventListener('click', sendCode);
  $('[data-change]').addEventListener('click', () => { fOtp.classList.add('hidden'); fPhone.classList.remove('hidden'); show(''); });
  fOtp.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('[data-verify]'); btn.disabled = true; show('');
    const { ok, data } = await post('/login/verify', { phone, otp: $('#otp').value.trim(), name: $('#name').value, next: root.dataset.next });
    if (!ok) { btn.disabled = false; return show(data.message); }
    if (data.csrf) document.querySelector('meta[name="csrf-token"]').content = data.csrf;
    window.location.href = data.redirect;
  });
})();
