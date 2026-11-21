// Server-side conversion events, sent once when an order is confirmed:
//  - Meta Conversions API "Purchase" (event_id matches the browser Pixel's eventID, so Meta counts it once)
//  - GA4 Measurement Protocol "purchase" (GA4 de-duplicates by transaction_id)
// Customer details are SHA-256 hashed before sending, as Meta requires.
const crypto = require('crypto');
const settings = require('./settings');

const sha = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);
const site = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function metaPurchase(o) {
  const pixel = settings.get('mk_pixel_id'); const token = settings.get('mk_capi_token');
  if (!pixel || !token) return;
  const phone = String(o.phone || '').replace(/\D/g, '').slice(-10);
  const [first, ...rest] = String(o.name || '').trim().split(/\s+/);
  const body = { data: [{
    event_name: 'Purchase', event_time: Math.floor(new Date(o.confirmed_at || o.created_at || Date.now()).getTime() / 1000),
    event_id: 'order-' + o.id, action_source: 'website', event_source_url: `${site()}/order/${o.id}`,
    user_data: { ph: phone ? [sha('91' + phone)] : undefined, em: o.email ? [sha(o.email)] : undefined, fn: first ? [sha(first)] : undefined, ln: rest.length ? [sha(rest.join(' '))] : undefined,
      ct: o.city ? [sha(String(o.city).replace(/\s/g, ''))] : undefined, zp: o.pincode ? [sha(o.pincode)] : undefined, country: [sha('in')], external_id: o.customer_id ? [sha(String(o.customer_id))] : undefined },
    custom_data: { currency: 'INR', value: o.total, order_id: o.id, content_type: 'product', content_ids: o.items.map((i) => i.sku), contents: o.items.map((i) => ({ id: i.sku, quantity: i.qty, item_price: i.unit_price })), num_items: o.items.reduce((s, i) => s + i.qty, 0) }
  }] };
  const r = await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) console.error('[capi] Meta purchase failed for', o.id, (await r.text()).slice(0, 300));
}

async function ga4Purchase(o) {
  const id = settings.get('mk_ga4_id'); const secret = settings.get('mk_ga4_api_secret');
  if (!id || !secret) return;
  const body = { client_id: `order.${o.id}`, user_id: o.customer_id ? String(o.customer_id) : undefined, events: [{ name: 'purchase', params: {
    transaction_id: o.id, currency: 'INR', value: o.total, shipping: o.shipping_fee || 0, coupon: o.coupon_code || undefined,
    items: o.items.map((i) => ({ item_id: i.sku, item_name: i.product_name, item_variant: i.variant_label, price: i.unit_price, quantity: i.qty })) } }] };
  const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`, {
    method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!r.ok) console.error('[ga4-mp] purchase failed for', o.id, r.status);
}

/** Fire-and-forget: never throws, never delays the order flow. */
function purchase(o) {
  Promise.allSettled([metaPurchase(o), ga4Purchase(o)]).then((rs) => rs.forEach((x) => x.status === 'rejected' && console.error('[conversions]', x.reason && x.reason.message)));
}
/** Which destinations are set up, e.g. "Meta + GA4", or '' when none. */
const configured = () => [settings.get('mk_pixel_id') && settings.get('mk_capi_token') && 'Meta', settings.get('mk_ga4_id') && settings.get('mk_ga4_api_secret') && 'GA4'].filter(Boolean).join(' + ');
module.exports = { purchase, configured };
