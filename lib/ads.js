// Ad platform data for the admin home cards: today's spend (live from Meta / Google Ads when connected,
// otherwise from manually entered ad_metrics), orders attributed via UTM / click ids, and cost per order.
// Live results are cached for 15 minutes; spend is also saved into ad_metrics so monthly P&L reports use it.
const db = require('./db');

const CACHE_MS = 15 * 60 * 1000;
const cache = {};
const OK = "status NOT IN ('awaiting_payment','cancelled')";

// utm_source values counted as each platform's orders
const SOURCES = {
  meta: ['facebook', 'fb', 'instagram', 'ig', 'meta', 'messenger', 'an', 'audience_network'],
  google: ['google', 'googleads', 'google_ads', 'adwords', 'youtube']
};
const PAID_MEDIUM = ['cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'ads', 'ad', 'display', 'shopping', 'pmax', 'video'];

const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const istBounds = (day) => {
  const start = new Date(day + 'T00:00:00+05:30');
  return [start.toISOString(), new Date(start.getTime() + 864e5 - 1).toISOString()];
};

async function ordersToday(platform) {
  const [from, to] = istBounds(istDay());
  const src = SOURCES[platform];
  const marks = src.map(() => '?').join(',');
  // Google: count only paid traffic (organic Google search is not an ad order)
  const paid = platform === 'google' ? ` AND lower(coalesce(utm_medium,'')) IN (${PAID_MEDIUM.map(() => '?').join(',')})` : '';
  return db.val(`SELECT COUNT(*) FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK} AND lower(coalesce(utm_source,'')) IN (${marks})${paid}`,
    [from, to, ...src, ...(paid ? PAID_MEDIUM : [])]);
}

async function manualSpendToday(platform) {
  return db.val('SELECT SUM(m.spend) FROM ad_metrics m JOIN campaigns c ON c.id=m.campaign_id WHERE m.day=? AND lower(c.platform)=?', [istDay(), platform]) || 0;
}

/** Store the platform's daily account spend under an auto campaign so reports include it. */
async function saveDaily(platform, rows) {
  const name = platform === 'meta' ? 'Meta Ads (auto-sync)' : 'Google Ads (auto-sync)';
  const utm = platform === 'meta' ? 'meta_ads_autosync' : 'google_ads_autosync';
  let id = await db.val('SELECT id FROM campaigns WHERE utm_campaign=?', [utm]);
  if (!id) {
    await db.run('INSERT INTO campaigns(name,platform,utm_campaign,objective,status,created_at) VALUES(?,?,?,?,?,?)',
      [name, platform === 'meta' ? 'Meta' : 'Google', utm, 'Account total (synced automatically)', 'active', db.nowIso()]);
    id = await db.val('SELECT id FROM campaigns WHERE utm_campaign=?', [utm]);
  }
  for (const r of rows) {
    await db.run('INSERT INTO ad_metrics(campaign_id,day,spend,impressions,clicks,conversions) VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET spend=excluded.spend, impressions=excluded.impressions, clicks=excluded.clicks, conversions=excluded.conversions',
      [id, r.day, r.spend, r.impressions || 0, r.clicks || 0, r.conversions || 0]);
  }
}

/* ---------- Meta Marketing API ---------- */
const metaAccount = () => {
  const a = String(process.env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/, '');
  return /^\d+$/.test(a) ? a : '';
};
const metaConnected = () => Boolean(process.env.META_ACCESS_TOKEN && metaAccount());

async function metaFetch() {
  const ver = process.env.META_API_VERSION || 'v21.0';
  const since = istDay(new Date(Date.now() - 6 * 864e5)); const until = istDay();
  const u = new URL(`https://graph.facebook.com/${ver}/act_${metaAccount()}/insights`);
  u.searchParams.set('fields', 'spend,impressions,clicks,actions');
  u.searchParams.set('time_range', JSON.stringify({ since, until }));
  u.searchParams.set('time_increment', '1');
  u.searchParams.set('access_token', process.env.META_ACCESS_TOKEN);
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Meta API HTTP ${r.status}`);
  const purchases = (a) => Number(((a || []).find((x) => x.action_type === 'purchase' || x.action_type === 'offsite_conversion.fb_pixel_purchase') || {}).value || 0);
  const rows = (j.data || []).map((d) => ({ day: d.date_start, spend: Number(d.spend || 0), impressions: Number(d.impressions || 0), clicks: Number(d.clicks || 0), conversions: purchases(d.actions) }));
  await saveDaily('meta', rows);
  return (rows.find((x) => x.day === until) || { spend: 0 }).spend;
}

/* ---------- Google Ads API ---------- */
const gadsCustomer = () => String(process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/\D/g, '');
const googleConnected = () => Boolean(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && process.env.GOOGLE_ADS_REFRESH_TOKEN && gadsCustomer());

async function googleFetch() {
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN, grant_type: 'refresh_token' })
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Google sign-in failed: ${tok.error_description || tok.error || 'no access token'}`);
  const ver = process.env.GOOGLE_ADS_API_VERSION || 'v21';
  const headers = { Authorization: `Bearer ${tok.access_token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN, 'Content-Type': 'application/json' };
  const login = String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/\D/g, '');
  if (login) headers['login-customer-id'] = login;
  const r = await fetch(`https://googleads.googleapis.com/${ver}/customers/${gadsCustomer()}/googleAds:search`, {
    method: 'POST', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ query: 'SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = Array.isArray(j) ? j[0] : j;
    throw new Error((e && e.error && e.error.message) || `Google Ads API HTTP ${r.status}`);
  }
  const rows = (j.results || []).map((x) => ({ day: x.segments.date, spend: Number(x.metrics.costMicros || 0) / 1e6, impressions: Number(x.metrics.impressions || 0), clicks: Number(x.metrics.clicks || 0), conversions: Math.round(Number(x.metrics.conversions || 0)) }));
  // LAST_7_DAYS excludes today, so ask for today separately
  const t = await fetch(`https://googleads.googleapis.com/${ver}/customers/${gadsCustomer()}/googleAds:search`, {
    method: 'POST', headers, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ query: 'SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING TODAY' })
  }).then((x) => x.json()).catch(() => ({}));
  (t.results || []).forEach((x) => rows.push({ day: x.segments.date, spend: Number(x.metrics.costMicros || 0) / 1e6, impressions: Number(x.metrics.impressions || 0), clicks: Number(x.metrics.clicks || 0), conversions: Math.round(Number(x.metrics.conversions || 0)) }));
  await saveDaily('google', rows);
  return (rows.find((x) => x.day === istDay()) || { spend: 0 }).spend;
}

/** Card data for one platform: { connected, live, spend, orders, cpo, updatedAt, error, link } */
async function today(platform, force) {
  const live = platform === 'meta' ? metaConnected() : googleConnected();
  const key = platform + istDay();
  let c = cache[key];
  if (live && (force || !c || Date.now() - c.at > CACHE_MS)) {
    try { c = { at: Date.now(), spend: await (platform === 'meta' ? metaFetch() : googleFetch()), error: null }; }
    catch (e) { c = { at: Date.now(), spend: null, error: e.message }; }
    cache[key] = c;
  }
  const spend = live && c && c.spend !== null ? c.spend : await manualSpendToday(platform);
  const orders = await ordersToday(platform);
  const link = platform === 'meta'
    ? (metaAccount() ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${metaAccount()}` : 'https://adsmanager.facebook.com/')
    : 'https://ads.google.com/aw/overview';
  return {
    platform, connected: live, live: Boolean(live && c && !c.error), spend: Math.round(spend * 100) / 100, orders,
    cpo: orders ? Math.round((spend / orders) * 100) / 100 : null,
    updatedAt: live && c ? new Date(c.at) : null, error: live && c ? c.error : null, link,
    hasManual: !live && spend > 0
  };
}

module.exports = { today, metaConnected, googleConnected, SOURCES };
