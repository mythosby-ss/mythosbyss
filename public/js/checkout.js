(function () {
  const { $, $$, csrf, money, toast } = window.MB;
  const form = $('#checkout-form'); if (!form) return;
  const pricing = JSON.parse(form.dataset.pricing);
  const submit = $('[data-submit]', form);
  const formError = $('[data-form-error]', form);
  const method = () => (form.querySelector('input[name="paymentMethod"]:checked') || {}).value;

  function renderTotals() {
    const p = pricing[method()] || pricing.cod;
    $('[data-total]', form).textContent = money(p.total);
    $('[data-pay-now]', form).textContent = money(p.payNow);
    $('[data-pay-due]', form).textContent = money(p.dueOnDelivery);
    $('[data-cod-fee-row]', form).classList.toggle('hidden', !p.codFee);
    submit.textContent = p.payNow > 0 ? 'Pay ' + money(p.payNow) + ' & place order' : 'Place order (pay on delivery)';
  }
  $$('input[name="paymentMethod"]', form).forEach((r) => r.addEventListener('change', renderTotals));
  renderTotals();

  const showErrors = (errors = {}) => {
    $$('[data-err]', form).forEach((el) => { el.textContent = errors[el.dataset.err] || ''; });
    const first = Object.keys(errors)[0]; if (first && form.elements[first]) form.elements[first].focus();
  };
  const showFormError = (msg) => { formError.textContent = msg || ''; formError.classList.toggle('hidden', !msg); };
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf() }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({ ok: false, message: 'Unexpected server response.' })) };
  };
  const setBusy = (b) => { submit.disabled = b; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); showErrors(); showFormError(''); setBusy(true);
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const { data } = await post('/checkout/place', body);
      if (!data.ok) { showErrors(data.errors); showFormError(data.message); return setBusy(false); }
      if (data.redirect) return (window.location.href = data.redirect); // COD
      openRazorpay(data);
    } catch (err) { showFormError('Network problem. Please check your connection and try again.'); setBusy(false); }
  });

  function openRazorpay(o) {
    if (!window.Razorpay) { showFormError('Could not load the payment window. Please refresh and try again.'); return setBusy(false); }
    const rzp = new window.Razorpay({
      key: o.key, amount: o.amount, currency: o.currency, name: o.name, description: o.description, order_id: o.razorpayOrderId,
      prefill: o.prefill, theme: { color: '#b07a2a' },
      handler: async (resp) => {
        showFormError(''); submit.textContent = 'Confirming payment...';
        try {
          const { data } = await post('/checkout/verify', resp);
          if (data.ok) return (window.location.href = data.redirect);
          showFormError(data.message);
        } catch (_) { showFormError('We could not confirm your payment yet. If money was deducted, your order will be confirmed automatically.'); }
        setBusy(false); renderTotals();
      },
      modal: { ondismiss: () => { setBusy(false); renderTotals(); toast('Payment cancelled'); } }
    });
    rzp.on('payment.failed', (r) => { showFormError('Payment failed: ' + ((r.error && r.error.description) || 'please try again or use another method.')); setBusy(false); renderTotals(); });
    rzp.open();
  }
})();
