// WhatsApp Cloud API (Meta) - template messages only. Templates must be created and approved in WhatsApp Manager.
// See docs/WHATSAPP_TEMPLATES.md for the exact text to submit.
const db = require('./db');
const settings = require('./settings');

const T = {
  otp: process.env.WA_TPL_OTP || 'mbss_login_otp',
  confirmed: process.env.WA_TPL_CONFIRMED || 'mbss_order_confirmation',
  shipped: process.env.WA_TPL_SHIPPED || 'mbss_order_shipped',
  out_for_delivery: process.env.WA_TPL_OFD || 'mbss_out_for_delivery',
  delivered: process.env.WA_TPL_DELIVERED || 'mbss_order_delivered',
  review: process.env.WA_TPL_REVIEW || 'mbss_review_request'
};
const LANG = process.env.WA_TEMPLATE_LANG || 'en';
const configured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const clean = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 900) || '-';
const to91 = (p) => '91' + String(p).replace(/\D/g, '').slice(-10);

/** Low-level send. Returns {ok, id, simulated, error}. */
async function sendTemplate({ phone, template, body = [], headerImage, urlSuffix, otp }) {
  const components = [];
  if (headerImage) components.push({ type: 'header', parameters: [{ type: 'image', image: { link: headerImage } }] });
  components.push({ type: 'body', parameters: body.map((t) => ({ type: 'text', text: clean(t) })) });
  if (urlSuffix) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: clean(urlSuffix) }] });
  const payload = { messaging_product: 'whatsapp', to: to91(phone), type: 'template', template: { name: template, language: { code: LANG }, components } };
  if (!configured()) {
    console.log(`[whatsapp:simulated] ${template} -> ${phone}`, JSON.stringify(body), otp ? `OTP=${otp}` : '');
    return { ok: true, simulated: true, payload };
  }
  try {
    const r = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: (j.error && j.error.message) || `HTTP ${r.status}`, payload };
    return { ok: true, id: j.messages && j.messages[0] && j.messages[0].id, payload };
  } catch (e) { return { ok: false, error: e.message, payload }; }
}

async function log(row) {
  const now = db.nowIso();
  return db.run('INSERT INTO notification_logs(order_id,customer_phone,template,status,wa_message_id,error,payload,send_at,sent_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [row.orderId || null, row.phone, row.template, row.status, row.id || null, row.error || null, JSON.stringify(row.payload || {}), row.sendAt || now, row.status === 'scheduled' ? null : now, now]);
}

async function sendAndLog(opts) {
  const res = await sendTemplate(opts);
  await log({ orderId: opts.orderId, phone: opts.phone, template: opts.template, status: res.ok ? (res.simulated ? 'simulated' : 'sent') : 'failed', id: res.id, error: res.error, payload: opts.otp ? { template: opts.template } : res.payload });
  return res;
}

module.exports = { T, configured, sendTemplate, sendAndLog, log, to91, clean, enabled: () => settings.get('whatsapp_enabled') === '1' };
