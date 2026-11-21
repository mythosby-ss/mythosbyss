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
  return { source: source || 'direct', medium: medium || (source ? '' : 'none'), campaign: q.utm_campaign || '', ref };
}

function middleware(req, res, next) {
  if (req.method === 'GET' && !req.path.startsWith('/admin') && !req.path.startsWith('/media') && !/\.\w{2,5}$/.test(req.path)) {
    const a = classify(req);
    if (!req.session.attr || (a.source !== 'direct' && a.source !== req.session.attr.source)) req.session.attr = a;
    res.on('finish', () => { if (res.statusCode === 200) track(req, 'page_view', { source: req.session.attr.source }); });
  }
  next();
}

function track(req, type, x = {}) {
  const now = db.nowIso();
  return db.run('INSERT INTO events(day,at,sid,type,path,ref,source,term,product_slug,results) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [now.slice(0, 10), now, req.sessionID, type, x.path || req.path, (req.session.attr || {}).ref || null, x.source || (req.session.attr || {}).source || 'direct', x.term || null, x.product || null, x.results ?? null]).catch(() => {});
}
module.exports = { middleware, track };
