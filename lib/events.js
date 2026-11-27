// Lightweight first-party analytics: page views, searches, cart/checkout/purchase events, and traffic source attribution.
const db = require('./db');

function classify(req) {
  const q = req.query || {};
  let ref = ''; try { ref = req.get('referer') ? new URL(req.get('referer')).hostname.replace(/^www\./, '') : ''; } catch (_) {}
  const own = (req.get('host') || '').replace(/^www\./, '');
  if (ref === own) ref = '';
  let source = q.utm_source || '', medium = q.utm_medium || '';
  if (!source && (q.gclid)) { source = 'google'; medium = 'cpc'; }
  if (!source && (q.fbclid)) { source = 'facebook'; medium = 'paid_social'; }
  if (!source && ref) {
    if (/google|bing|duckduckgo|yahoo/.test(ref)) { source = ref.split('.')[0]; medium = 'organic'; }
    else if (/facebook|instagram|youtube|t\.co|twitter|whatsapp|pinterest/.test(ref)) { source = ref.split('.')[0]; medium = 'social'; }
    else { source = ref; medium = 'referral'; }
  }
  return { source: source || 'direct', medium: medium || (source ? '' : 'none'), campaign: q.utm_campaign || '', content: String(q.utm_content || '').slice(0, 120), ref };
}

// Search engines / link-preview bots: no session, no analytics rows (see server.js)
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|facebookcatalog|whatsapp|telegram|preview|lighthouse|pagespeed|semrush|ahrefs/i;
const isBot = (req) => BOT.test(req.get('user-agent') || '');

function middleware(req, res, next) {
  if (req.method === 'GET' && !req.isBot && !req.path.startsWith('/admin') && !req.path.startsWith('/media') && !/\.\w{2,5}$/.test(req.path)) {
    const a = classify(req);
    // Meta click ID from ad links: kept for the Conversions API "fbc" value when the _fbc cookie is missing
    if (req.query.fbclid) req.session.fbc = `fb.1.${Date.now()}.${String(req.query.fbclid).slice(0, 500)}`;
    if (!req.session.attr || (a.source !== 'direct' && a.source !== req.session.attr.source)) req.session.attr = a;
    res.on('finish', () => { if (res.statusCode === 200) track(req, 'page_view', { source: req.session.attr.source }); });
  }
  next();
}

// Page views / searches / product views are queued and written in one batch every few seconds
// (one database round trip for many events, instead of one per page view).
const queue = [];
const SQL = 'INSERT INTO events(day,at,sid,type,path,ref,source,term,product_slug,results) VALUES(?,?,?,?,?,?,?,?,?,?)';
function flush() {
  if (!queue.length) return Promise.resolve();
  const rows = queue.splice(0, 500);
  return db.batch(rows.map((a) => [SQL, a])).catch(() => {}).then(() => (queue.length ? flush() : undefined));
}
setInterval(flush, 5000).unref();
process.once('beforeExit', flush);
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { flush().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });

function track(req, type, x = {}) {
  if (req.isBot) return Promise.resolve();
  const now = db.nowIso();
  queue.push([now.slice(0, 10), now, req.sessionID || null, type, x.path || req.path, ((req.session && req.session.attr) || {}).ref || null, x.source || ((req.session && req.session.attr) || {}).source || 'direct', x.term || null, x.product || null, x.results ?? null]);
  if (queue.length >= 200) flush();
  return Promise.resolve();
}
module.exports = { middleware, track, isBot, flush };
