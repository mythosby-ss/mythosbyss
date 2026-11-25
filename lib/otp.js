// OTP delivery adapter. Pick the provider with OTP_PROVIDER in .env:
//   whatsapp - (default in production) WhatsApp Cloud API authentication template. Needs WHATSAPP_TOKEN + WHATSAPP_PHONE_ID.
//   sms      - placeholder for an Indian SMS OTP provider (MSG91 / 2Factor / Fast2SMS). Needs an account + API key; not wired yet.
//   dev      - (default in development) nothing is sent; the code is always DEV_STATIC_OTP (default 123456789).
//              Hard-disabled when NODE_ENV=production.
// To add a provider: add an entry with newCode() and send(phone, code) -> { ok, simulated?, error? }.
const crypto = require('crypto');
const wa = require('./whatsapp');

const isProd = () => process.env.NODE_ENV === 'production';
const randomCode = () => String(crypto.randomInt(100000, 1000000));

const providers = {
  whatsapp: {
    newCode: randomCode,
    async send(phone, code) {
      // Without credentials, the WhatsApp module only "simulates". In production that would silently lock everyone out.
      if (!wa.configured() && isProd()) return { ok: false, error: 'WhatsApp OTP is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID).' };
      const r = await wa.sendAndLog({ phone, template: wa.T.otp, body: [code], urlSuffix: code, otp: code });
      return { ok: r.ok, simulated: Boolean(r.simulated), error: r.error };
    }
  },
  sms: {
    newCode: randomCode,
    async send() { return { ok: false, error: 'SMS OTP provider is not set up yet (choose a provider and add its API key).' }; }
  },
  dev: {
    newCode: () => String(process.env.DEV_STATIC_OTP || '123456789'),
    async send(phone, code) { console.log(`[otp:dev] login for ${phone}: use static code ${code}`); return { ok: true, simulated: true }; }
  }
};

function provider() {
  let name = String(process.env.OTP_PROVIDER || (isProd() ? 'whatsapp' : 'dev')).toLowerCase();
  if (name === 'dev' && isProd()) { console.error('[otp] OTP_PROVIDER=dev is not allowed in production; using whatsapp.'); name = 'whatsapp'; }
  if (!providers[name]) name = 'whatsapp';
  return { name, ...providers[name] };
}

module.exports = { provider };
