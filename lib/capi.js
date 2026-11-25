// Server-side conversion events.
//  - Meta Conversions API: "Purchase" and custom "COD_Placed". event_id matches the browser Pixel's eventID, so Meta counts each once.
//  - GA4 Measurement Protocol "purchase" (GA4 de-duplicates by transaction_id).
//
// PURCHASE RULE: Purchase is sent only when
//   a) a prepaid payment succeeds, b) a partial-COD advance is paid, or c) a COD order is confirmed by the admin.
//   (callers: lib/orders.markPaid -> notify.onConfirmed, and admin status change to "confirmed" -> notify.onStatus)
// A plain COD order placement sends COD_Placed instead (routes/checkout.js).
//
// Secrets come only from .env: META_PIXEL_ID, META_CAPI_TOKEN, optional META_TEST_EVENT_CODE, META_API_VERSION.
// Customer details are normalised and SHA-256 hashed before sending, as Meta requires.
// Everything here is fire-and-forget: it never throws into, or delays, the order flow.
const crypto = require('crypto');
const settings = require('./settings');

const sha = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);
const site = () => (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
const pixelId = () => process.env.META_PIXEL_ID || settings.get('mk_pixel_id') || '';
const metaReady = () => Boolean(pixelId() && process.env.META_CAPI_TOKEN);

/** Normalised, hashed customer data + the browser context captured at checkout (fbp, fbc, IP, user agent). */
function userData(o) {
  const phone = String(o.phone || '').replace(/\D/g, '').slice(-10);
  const [first, ...rest] = String(o.name || '').trim().split(/\s+/);
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const ud = {
    ph: phone ? [sha('91' + phone)] : undefined, em: o.email ? [sha(o.email)] : undefined,
    fn: first ? [sha(clean(first))] : undefined, ln: rest.length ? [sha(clean(rest.join('')))] : undefined,
    ct: o.city ? [sha(clean(o.city))] : undefined, st: o.state ? [sha(clean(o.state))] : undefined, zp: o.pincode ? [sha(o.pincode)] : undefined,
    country: [sha('in')], external_id: o.customer_id ? [sha(String(o.customer_id))] : undefined,
    client_ip_address: o.client_ip || undefined, client_user_agent: o.user_agent || undefined, fbp: o.fbp || undefined, fbc: o.fbc || undefined
  };
  return Object.fromEntries(Object.entries(ud).filter(([, v]) => v !== undefined));
}

const customData = (o) => ({
  currency: 'INR', value: Number(o.total) || 0, order_id: o.id, content_type: 'product',
  content_ids: o.items.map((i) => i.sku), contents: o.items.map((i) => ({ id: i.sku, quantity: i.qty, item_price: i.unit_price })),
  num_items: o.items.reduce((s, i) => s + i.qty, 0), payment_method: o.payment_method
});

/** POST one event to Meta. Returns { ok, info } and never throws. */
async function sendMeta(eventName, eventId, o) {
  if (!metaReady()) return { ok: false, info: 'not configured (META_PIXEL_ID / META_CAPI_TOKEN)' };
  const body = { data: [{
    event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId, action_source: 'website',
    event_source_url: `${site()}/order/${o.id}`, user_data: userData(o), custom_data: customData(o)
  }] };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const r = await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v21.0'}/${pixelId()}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const text = await r.text();
    if (!r.ok) { console.error(`[capi] Meta ${eventName} failed for ${o.id}:`, text.slice(0, 300)); return { ok: false, info: `HTTP ${r.status}` }; }
    return { ok: true, info: `received${process.env.META_TEST_EVENT_CODE ? ' (test event)' : ''}` };
  } catch (e) {
    console.error(`[capi] Meta ${eventName} error for ${o.id}:`, e.message);
    return { ok: false, info: e.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}

const ga4Ready = () => Boolean(settings.get('mk_ga4_id') && (process.env.GA4_API_SECRET || settings.get('mk_ga4_api_secret')));
async function ga4Purchase(o) {
  const id = settings.get('mk_ga4_id'); const secret = process.env.GA4_API_SECRET || settings.get('mk_ga4_api_secret');
  if (!id || !secret) return { ok: false, info: 'not configured' };
  const body = { client_id: `order.${o.id}`, user_id: o.customer_id ? String(o.customer_id) : undefined, events: [{ name: 'purchase', params: {
    transaction_id: o.id, currency: 'INR', value: o.total, shipping: o.shipping_fee || 0, coupon: o.coupon_code || undefined,
    items: o.items.map((i) => ({ item_id: i.sku, item_name: i.product_name, item_variant: i.variant_label, price: i.unit_price, quantity: i.qty })) } }] };
  try {
    const r = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`, {
      method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!r.ok) console.error('[ga4-mp] purchase failed for', o.id, r.status);
    return { ok: r.ok, info: r.ok ? 'sent' : `HTTP ${r.status}` };
  } catch (e) { console.error('[ga4-mp] error for', o.id, e.message); return { ok: false, info: 'network error' }; }
}

/** Run in the background; write the outcome to the order timeline (handy when checking Events Manager). */
function background(o, label, jobs) {
  Promise.allSettled(jobs).then(async (rs) => {
    const parts = rs.map((r, i) => `${jobs.names[i]}: ${r.status === 'fulfilled' ? (r.value.ok ? 'ok' : 'failed - ' + r.value.info) : 'error'}`);
    try { await require('./orders').addEvent(o.id, null, `${label} -> ${parts.join(', ')}`, 'conversions'); } catch (_) { /* logging only */ }
  });
}

/** Purchase (paid online / advance paid / COD confirmed). event_id "order-<id>" matches the browser Pixel. */
function purchase(o) {
  const jobs = []; jobs.names = [];
  if (metaReady()) { jobs.push(sendMeta('Purchase', 'order-' + o.id, o)); jobs.names.push('Meta'); }
  if (ga4Ready()) { jobs.push(ga4Purchase(o)); jobs.names.push('GA4'); }
  if (!jobs.length) return;
  background(o, 'Purchase event', jobs);
}
/** COD order placed (not confirmed yet): custom event, so ads can see it without optimising for it. */
function codPlaced(o) {
  const jobs = [sendMeta('COD_Placed', 'codplaced-' + o.id, o)]; jobs.names = ['Meta'];
  background(o, 'COD_Placed event', jobs);
}

/** Which destinations are set up, e.g. "Meta + GA4", or '' when none. */
const configured = () => [metaReady() && 'Meta', ga4Ready() && 'GA4'].filter(Boolean).join(' + ');
module.exports = { purchase, codPlaced, configured, metaReady, pixelId, userData };
