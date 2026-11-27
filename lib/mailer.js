// Outgoing email over SMTP (nodemailer). Credentials only in .env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM.
// nodemailer is loaded on the first send, so the storefront pays nothing for it at start-up.
// MAIL_TRANSPORT=json (tests / local preview): nothing leaves the machine, the message is returned as JSON instead.
let transport = null;

const jsonMode = () => process.env.MAIL_TRANSPORT === 'json';
const configured = () => jsonMode() || Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function get() {
  if (transport) return transport;
  const nodemailer = require('nodemailer');
  if (jsonMode()) transport = nodemailer.createTransport({ jsonTransport: true });
  else {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000
    });
  }
  return transport;
}

/** send({ to, subject, text, html }) -> { ok, id, json? , error? }. Never throws. */
async function send({ to, subject, text, html }) {
  if (!configured()) return { ok: false, error: 'Email is not set up: add SMTP_HOST, SMTP_USER and SMTP_PASS to .env.' };
  if (!to) return { ok: false, error: 'No recipient email.' };
  try {
    const info = await get().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || 'mythos@localhost', to, subject, text, html });
    return { ok: true, id: info.messageId, json: jsonMode() ? info.message : undefined };
  } catch (e) {
    if (e.code === 'EAUTH') {
      const gmail = /gmail|google/i.test(process.env.SMTP_HOST || '');
      return { ok: false, error: gmail ? 'Gmail rejected the login. Use a Gmail App Password in SMTP_PASS (Google Account > Security > 2-Step Verification > App passwords), not your normal password.' : 'The mail server rejected the SMTP username/password in .env.' };
    }
    return { ok: false, error: e.message };
  }
}

module.exports = { send, configured, jsonMode, _reset: () => { transport = null; } };
