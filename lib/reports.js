// Downloadable CSV reports for the admin "Reports" page.
const db = require('./db');
const settings = require('./settings');
const { OK, day, addDays } = require('./analytics');

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = "'" + s; // neutralise spreadsheet formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (columns, rows) => [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n');

function period(days) {
  const to = new Date(); const from = addDays(to, -(Number(days) || 30) + 1);
  return { from: day(from), to: day(to), fromTs: day(from) + 'T00:00:00.000Z', toTs: day(to) + 'T23:59:59.999Z' };
}

const REPORTS = {
  'order-reconciliation': { title: 'Order Reconciliation Report', desc: 'Order-wise payments, COD collection, refunds and settlement status', async build(p) {
    const rows = await db.q('SELECT * FROM orders WHERE created_at BETWEEN ? AND ? ORDER BY created_at', [p.fromTs, p.toTs]);
    const ref = Object.fromEntries((await db.q('SELECT order_id, SUM(amount) a FROM refunds GROUP BY order_id')).map((x) => [x.order_id, x.a]));
    return rows.map((o) => { const cod = o.payment_method !== 'prepaid' && o.status === 'delivered' ? o.due_on_delivery : 0; const refunded = ref[o.id] || 0;
      return { order_id: o.id, date: o.created_at.slice(0, 10), customer: o.name, phone: o.phone, payment_method: o.payment_method, status: o.status, payment_status: o.payment_status, order_value: o.total, paid_online: ['paid', 'advance_paid'].includes(o.payment_status) || o.status === 'delivered' ? o.pay_now : 0, cod_collected: cod, refunded, courier_charge: o.courier_charge, cod_settled: o.cod_settlement_id ? 'Yes' : cod ? 'No' : '', net_received: r2((o.status === 'cancelled' || o.status === 'rto' ? 0 : o.pay_now + cod) - refunded) }; }); } },
  orders: { title: 'Order Report', desc: 'Day-wise orders, revenue and expenses summary', async build(p) {
    const rows = await db.q(`SELECT substr(created_at,1,10) date, COUNT(*) orders, SUM(status='cancelled') cancelled, SUM(status='delivered') delivered, SUM(status='rto') rto,
      SUM(CASE WHEN ${OK} THEN total ELSE 0 END) revenue, SUM(CASE WHEN ${OK} THEN discount ELSE 0 END) discounts, SUM(CASE WHEN ${OK} THEN courier_charge ELSE 0 END) courier_cost FROM orders WHERE created_at BETWEEN ? AND ? GROUP BY date ORDER BY date`, [p.fromTs, p.toTs]);
    for (const r of rows) r.ad_spend = await db.val('SELECT SUM(spend) FROM ad_metrics WHERE day=?', [r.date]);
    return rows; } },
  dispatched: { title: 'Dispatched Order Report', desc: 'Shipped orders with courier and AWB', async build(p) {
    return db.q('SELECT id order_id, shipped_at, courier, awb, courier_charge, name customer, city, state, pincode, payment_method, due_on_delivery cod_amount, status FROM orders WHERE shipped_at BETWEEN ? AND ? ORDER BY shipped_at', [p.fromTs, p.toTs]); } },
  shipping: { title: 'Shipping Report', desc: 'Day-wise shipping charged vs courier cost', async build(p) {
    return db.q(`SELECT substr(shipped_at,1,10) date, COUNT(*) shipments, SUM(shipping_fee) shipping_charged, SUM(courier_charge) courier_cost, courier FROM orders WHERE shipped_at BETWEEN ? AND ? GROUP BY date, courier ORDER BY date`, [p.fromTs, p.toTs]); } },
  cashflow: { title: 'CashFlow Report', desc: 'Outstanding COD money and settlements in the period', async build(p) {
    const out = (await db.q("SELECT id order_id, delivered_at, due_on_delivery amount, 'Outstanding COD (delivered, not settled)' type FROM orders WHERE status='delivered' AND payment_method!='prepaid' AND cod_settlement_id IS NULL AND delivered_at BETWEEN ? AND ?", [p.fromTs, p.toTs]));
    const st = (await db.q('SELECT reference order_id, created_at delivered_at, net_amount amount, status type FROM settlements WHERE created_at BETWEEN ? AND ?', [p.fromTs, p.toTs]));
    return [...out, ...st.map((s) => ({ ...s, type: 'Settlement (' + s.type + ')' }))]; } },
  tax: { title: 'Tax Report (GST)', desc: 'Invoice value split into taxable value and GST, for monthly returns', async build(p) {
    const g = settings.num('gst_percent'); const home = (settings.get('home_state') || 'Uttar Pradesh').toLowerCase();
    return (await db.q(`SELECT id, delivered_at, name, state, total, shipping_fee FROM orders WHERE status='delivered' AND delivered_at BETWEEN ? AND ? ORDER BY delivered_at`, [p.fromTs, p.toTs])).map((o) => {
      const taxable = r2(o.total / (1 + g / 100)); const gst = r2(o.total - taxable); const intra = (o.state || '').toLowerCase() === home;
      return { order_id: o.id, delivered_on: o.delivered_at.slice(0, 10), customer: o.name, place_of_supply: o.state, invoice_value: o.total, taxable_value: taxable, gst_rate: g + '%', cgst: intra ? r2(gst / 2) : 0, sgst: intra ? r2(gst / 2) : 0, igst: intra ? 0 : gst }; }); } },
  'product-performance': { title: 'Product wise Performance', desc: 'Units, revenue, margin and RTO by product', async build(p) {
    return db.q(`SELECT i.product_name product, SUM(i.qty) units, SUM(i.qty*i.unit_price) revenue, SUM(i.qty*i.cost_price) product_cost, SUM(i.qty*(i.unit_price-i.cost_price)) gross_margin,
      SUM(CASE WHEN o.status='rto' THEN i.qty ELSE 0 END) rto_units, SUM(CASE WHEN o.status='delivered' THEN i.qty ELSE 0 END) delivered_units
      FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.created_at BETWEEN ? AND ? AND o.${OK} GROUP BY i.product_slug ORDER BY revenue DESC`, [p.fromTs, p.toTs]); } },
  whatsapp: { title: 'WhatsApp Sent Report', desc: 'Every WhatsApp template message and its delivery status', async build(p) {
    return db.q("SELECT created_at, order_id, customer_phone phone, template, status, error FROM notification_logs WHERE created_at BETWEEN ? AND ? AND template NOT LIKE '%otp%' ORDER BY created_at", [p.fromTs, p.toTs]); } },
  customers: { title: 'Purchased Customer Report', desc: 'Customers with order counts and lifetime value', async build(p) {
    return db.q(`SELECT c.name, c.phone, c.email, c.created_at customer_since, COUNT(o.id) orders, SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END) delivered, SUM(CASE WHEN ${OK.replace(/status/, 'o.status')} THEN o.total ELSE 0 END) revenue
      FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.created_at BETWEEN ? AND ? GROUP BY c.id ORDER BY revenue DESC`, [p.fromTs, p.toTs]); } }
};

async function csv(type, days) {
  const rep = REPORTS[type]; if (!rep) return null;
  const rows = await rep.build(period(days));
  const columns = rows.length ? Object.keys(rows[0]) : ['no_data'];
  return toCsv(columns, rows.length ? rows : [{ no_data: 'No records in this period' }]);
}
module.exports = { REPORTS, csv, toCsv, period };
