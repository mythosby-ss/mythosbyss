const router = require('express').Router();
const db = require('../../lib/db');
const A = require('../../lib/analytics');
const reports = require('../../lib/reports');
const catalog = require('../../lib/catalog');
const settings = require('../../lib/settings');

// ── helpers ────────────────────────────────────────────────────────────────
const OK = A.OK;
const day = A.day;
const pct = A.pct;

function monthBounds(offsetMonths = 0) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - offsetMonths;
  const from = new Date(Date.UTC(y, m, 1));
  const to   = new Date(Date.UTC(y, m + 1, 0));
  return {
    from: day(from),
    to:   day(to),
    fromTs: day(from) + 'T00:00:00.000Z',
    toTs:   day(to)  + 'T23:59:59.999Z'
  };
}

// ── Home dashboard ──────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const period   = req.query.period === 'month' ? 'month' : 'week';
    const platform = ['all', 'meta', 'google'].includes(req.query.platform) ? req.query.platform : 'all';

    // Trend rows (for weekly/monthly table)
    const rows = await A.trend(period, 6, platform);

    // Today window
    const t = day(new Date());
    const tt = [t + 'T00:00:00.000Z', t + 'T23:59:59.999Z'];

    const today = await db.one(
      `SELECT COUNT(*) orders, SUM(CASE WHEN ${OK} THEN total ELSE 0 END) revenue FROM orders WHERE created_at BETWEEN ? AND ?`,
      tt
    );
    const todayConfirmed = await db.val(
      `SELECT COUNT(*) FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK}`, tt
    );

    // Orders to dispatch / in transit / pending RTO
    const pending    = await db.val("SELECT COUNT(*) FROM orders WHERE status IN ('confirmed','packed')");
    const inTransit  = await db.val("SELECT COUNT(*) FROM orders WHERE status IN ('shipped','out_for_delivery','ndr')");
    const pendingRto = await db.val("SELECT COUNT(*) FROM orders WHERE status='rto'");

    // Inventory
    const lowStock   = await db.val('SELECT COUNT(*) FROM variants WHERE stock <= low_stock AND active=1 AND sku NOT IN (SELECT bundle_sku FROM bundle_items)');
    const outOfStock = await db.val('SELECT COUNT(*) FROM variants WHERE stock <= 0 AND active=1 AND sku NOT IN (SELECT bundle_sku FROM bundle_items)');

    // This month stats
    const mb = monthBounds();
    const monthRow = await db.one(
      `SELECT COUNT(*) orders, SUM(CASE WHEN ${OK} THEN total ELSE 0 END) revenue,
              SUM(status='delivered') delivered, SUM(status='rto') rto
       FROM orders WHERE created_at BETWEEN ? AND ?`,
      [mb.fromTs, mb.toTs]
    );
    const monthSales   = monthRow.revenue || 0;
    const monthOrders  = monthRow.orders  || 0;
    const mtdDelivered = monthRow.delivered || 0;
    const mtdRto       = monthRow.rto       || 0;

    // Last 7 days bar chart data
    const from7 = day(A.addDays(new Date(t), -6));
    const r7 = { from: from7, to: t, fromTs: from7 + 'T00:00:00.000Z', toTs: t + 'T23:59:59.999Z' };
    const dData = await A.orderDashboard(r7, '');
    const last7 = dData.daily;

    // Payment breakdown (MTD)
    const paymentBreakdown = await db.q(
      `SELECT payment_method m, COUNT(*) n, SUM(total) rev FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK} GROUP BY m`,
      [mb.fromTs, mb.toTs]
    );

    // State-wise (MTD)
    const stateWise = await db.q(
      `SELECT state, COUNT(*) n FROM orders WHERE created_at BETWEEN ? AND ? AND ${OK} GROUP BY state ORDER BY n DESC LIMIT 8`,
      [mb.fromTs, mb.toTs]
    );

    // Top products (MTD)
    const topProducts = await db.q(
      `SELECT i.product_name name, SUM(i.qty) units, SUM(i.qty*i.unit_price) revenue
       FROM order_items i JOIN orders o ON o.id=i.order_id
       WHERE o.created_at BETWEEN ? AND ? AND o.${OK}
       GROUP BY i.product_slug ORDER BY units DESC LIMIT 8`,
      [mb.fromTs, mb.toTs]
    );

    // Customer stats (all time)
    const totalCustomers  = await db.val('SELECT COUNT(*) FROM customers');
    const repeatCustomers = await db.val(
      `SELECT COUNT(*) FROM (SELECT customer_id FROM orders WHERE ${OK} GROUP BY customer_id HAVING COUNT(*) > 1)`
    );
    const totalBuyers = await db.val(`SELECT COUNT(DISTINCT customer_id) FROM orders WHERE ${OK}`);
    const repeatRate  = pct(repeatCustomers, totalBuyers || 1);
    const avgOrdersPerCustomer = totalBuyers
      ? (await db.val(`SELECT COUNT(*) FROM orders WHERE ${OK}`)) / totalBuyers
      : 0;

    // AOV this month
    const aovMonth = monthRow.orders ? Math.round(monthSales / monthRow.orders) : 0;

    // Ratings
    const reviews     = await db.q("SELECT rating FROM reviews WHERE status='approved'");
    const totalReviews = reviews.length;
    const avgRating    = totalReviews ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / totalReviews : 0;
    const ratingDist   = reviews.reduce((m, r) => { m[r.rating] = (m[r.rating] || 0) + 1; return m; }, {});

    // Meta / Google Ads cards (live when connected in Plugins; cached 15 min, ?refresh=ads forces)
    const ads = require('../../lib/ads');
    const force = req.query.refresh === 'ads';
    const [metaCard, googleCard] = await Promise.all([ads.today('meta', force), ads.today('google', force)]);
    const adSpend = metaCard.spend + googleCard.spend; const adOrders = metaCard.orders + googleCard.orders;

    res.render('admin/home', {
      title: 'Home', rows, period, platform, metaCard, googleCard, adSpend, adOrders,
      today, todayConfirmed,
      pending, inTransit, pendingRto,
      lowStock, outOfStock,
      monthSales, monthOrders, mtdDelivered, mtdRto,
      last7,
      paymentBreakdown, stateWise, topProducts,
      totalCustomers, repeatCustomers, repeatRate,
      avgOrdersPerCustomer: avgOrdersPerCustomer ? avgOrdersPerCustomer.toFixed(1) : '—',
      aovMonth,
      avgRating: Math.round(avgRating * 10) / 10, totalReviews, ratingDist
    });
  } catch (e) { next(e); }
});

// ── Analytics dashboard ─────────────────────────────────────────────────────
router.get('/analytics', async (req, res, next) => {
  try {
    const tab = ['order', 'product', 'business', 'inventory', 'whatsapp'].includes(req.query.tab) ? req.query.tab : 'order';
    const r = A.range(req.query, 7);
    const method = ['cod', 'prepaid', 'partial_cod'].includes(req.query.method) ? req.query.method : '';
    const data = { tab, r, method, title: 'Dashboard' };
    if (tab === 'order')     data.d   = await A.orderDashboard(r, method);
    if (tab === 'product')   data.p   = await A.productPerformance(r);
    if (tab === 'business')  data.b   = await A.businessMetrics(r);
    if (tab === 'inventory') data.inv = await db.q(
      `SELECT p.name, p.slug, v.sku, v.label, v.stock, v.low_stock
       FROM variants v JOIN products p ON p.id=v.product_id
       WHERE v.active=1 ORDER BY (v.stock<=0) DESC, (v.stock<=v.low_stock) DESC, v.stock`
    );
    if (tab === 'whatsapp') {
      data.w    = await db.q("SELECT template, status, COUNT(*) n FROM notification_logs WHERE created_at BETWEEN ? AND ? AND template NOT LIKE '%otp%' GROUP BY template, status ORDER BY template", [r.fromTs, r.toTs]);
      data.wlog = await db.q("SELECT * FROM notification_logs WHERE template NOT LIKE '%otp%' ORDER BY id DESC LIMIT 15");
    }
    res.render('admin/analytics', data);
  } catch (e) { next(e); }
});

// ── Monthly Report ──────────────────────────────────────────────────────────
router.get('/monthly-report', async (req, res, next) => {
  try {
    const monthsParam = [3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 6;
    const platform = ['all', 'meta', 'google'].includes(req.query.platform) ? req.query.platform : 'all';

    // Build month-by-month rows
    const rows = await A.trend('month', monthsParam, platform);

    // Product performance for current month
    const mb = monthBounds();
    const productPerf = await db.q(
      `SELECT i.product_name product, SUM(i.qty) units,
              SUM(i.qty*i.unit_price) revenue,
              SUM(i.qty*i.cost_price) product_cost,
              SUM(i.qty*(i.unit_price-i.cost_price)) gross_margin,
              SUM(CASE WHEN o.status='rto' THEN i.qty ELSE 0 END) rto_units,
              SUM(CASE WHEN o.status='delivered' THEN i.qty ELSE 0 END) delivered_units
       FROM order_items i JOIN orders o ON o.id=i.order_id
       WHERE o.created_at BETWEEN ? AND ? AND o.${OK}
       GROUP BY i.product_slug ORDER BY revenue DESC`,
      [mb.fromTs, mb.toTs]
    );

    const pgFee = settings.num('pg_fee_percent');

    res.render('admin/monthly-report', {
      title: 'Monthly Report',
      rows,
      months: monthsParam,
      platform,
      productPerf,
      pgFee
    });
  } catch (e) { next(e); }
});

// ── Reports (CSV download) ───────────────────────────────────────────────────
router.get('/reports', (req, res) =>
  res.render('admin/reports', { title: 'Reports', reports: reports.REPORTS })
);

router.get('/reports/:type.csv', async (req, res, next) => {
  try {
    const days = [7, 30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const body = await reports.csv(req.params.type, days);
    if (body == null) return next();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${req.params.type}-last-${days}-days.csv"`
    }).send('\uFEFF' + body);
  } catch (e) { next(e); }
});

module.exports = router;
