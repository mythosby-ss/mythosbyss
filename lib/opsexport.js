// Ops data export for the Claude Code agents (ops/README.md): orders.csv, products.csv, payments.csv, shipments.csv.
// Read-only: SELECT queries only. Used by `npm run ops:export` and the admin "Export ops data" buttons.
const db = require('./db');
const catalog = require('./catalog');
const settings = require('./settings');
const { productWeight } = require('./codrules');
const { toCsv } = require('./opscsv');

const COLS = {
  orders: ['order_id', 'date', 'product_ids', 'product_names', 'qty', 'order_value', 'payment_type', 'advance_paid', 'status', 'delivered_date', 'customer_name', 'customer_phone',
    'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode', 'preferred_language', 'courier', 'awb', 'chargeable_weight_kg', 'utm_source', 'utm_campaign', 'utm_content'],
  products: ['product_id', 'name', 'cost_price', 'packaging_cost', 'selling_price', 'chargeable_weight_kg', 'is_bundle'],
  payments: ['date', 'order_id', 'amount', 'gateway_fee', 'settled_amount'],
  // Built from the order records until Shipway is connected (npm run ops:shipway then replaces this file with Shipway's data)
  shipments: ['awb', 'order_id', 'courier', 'status', 'last_status_date', 'attempts', 'ndr_reason', 'forward_charge', 'rto_charge', 'cod_charge', 'reverse_pickup_charge', 'weight_charged_kg']
};
const NAMES = Object.keys(COLS);

const PLACED = "status<>'awaiting_payment' AND NOT (status='cancelled' AND payment_status IN ('pending','failed'))";
// Website status -> ops/README.md status
const STATUS = { pending_confirmation: 'pending_confirmation', confirmed: 'confirmed', packed: 'confirmed', shipped: 'shipped', out_for_delivery: 'shipped', ndr: 'shipped',
  delivered: 'delivered', rto: 'rto', returned: 'returned', cancelled: 'cancelled' };
const ist = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const since = (days) => new Date(Date.now() - days * 864e5).toISOString();

/** Orders saved before the split address columns: "house, street, Landmark: x" -> parts */
function splitAddress(o) {
  if (o.address_line1 != null) return [o.address_line1, o.address_line2 || '', o.landmark || ''];
  const [main, lm = ''] = String(o.address || '').split(', Landmark: ');
  const i = main.indexOf(', ');
  return i < 0 ? [main, '', lm] : [main.slice(0, i), main.slice(i + 2), lm];
}

async function placedOrders(days) {
  const list = await db.q(`SELECT * FROM orders WHERE ${PLACED} AND created_at >= ? ORDER BY created_at`, [since(days)]);
  const items = await db.q(`SELECT order_id, product_slug, product_name, qty FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE ${PLACED} AND created_at >= ?) ORDER BY id`, [since(days)]);
  const by = {}; for (const i of items) (by[i.order_id] = by[i.order_id] || []).push(i);
  return list.map((o) => ({ o, items: by[o.id] || [] }));
}

const builders = {
  async orders(days) {
    return (await placedOrders(days)).map(({ o, items }) => {
      const [l1, l2, lm] = splitAddress(o);
      const weight = items.reduce((s, i) => s + productWeight(catalog.allBySlug(i.product_slug)) * i.qty, 0);
      const paidOnline = ['paid', 'advance_paid', 'refunded', 'partially_refunded'].includes(o.payment_status) || o.status === 'delivered';
      return {
        order_id: o.id, date: ist(o.created_at), product_ids: items.map((i) => i.product_slug).join('|'), product_names: items.map((i) => i.product_name).join('|'),
        qty: items.map((i) => i.qty).join('|'), order_value: r2(o.total), payment_type: o.payment_method,
        advance_paid: o.payment_method === 'cod' ? 0 : paidOnline ? r2(o.pay_now) : 0,
        status: STATUS[o.status] || o.status, delivered_date: ist(o.delivered_at), customer_name: o.name, customer_phone: o.phone,
        address_line1: l1, address_line2: l2, landmark: lm, city: o.city, state: o.state, pincode: o.pincode, preferred_language: o.preferred_language || '',
        courier: o.courier || '', awb: o.awb || '', chargeable_weight_kg: r2(weight),
        utm_source: o.utm_source || '', utm_campaign: o.utm_campaign || '', utm_content: o.utm_content || ''
      };
    });
  },
  async products() {
    const pack = settings.num('profit_packaging_default');
    return catalog.all.filter((p) => p.variants.length).map((p) => {
      const v = p.variants.reduce((a, b) => (b.price < a.price ? b : a)); // the "from" price shown on the site
      return { product_id: p.slug, name: p.name, cost_price: r2(v.cost), packaging_cost: r2(p.packagingCost ?? pack), selling_price: r2(v.price),
        chargeable_weight_kg: r2(productWeight(p)), is_bundle: p.isBundle ? 'yes' : 'no' };
    });
  },
  async payments(days) {
    const pct = settings.num('pg_fee_percent');
    const rows = await db.q(`SELECT id, confirmed_at, created_at, pay_now FROM orders WHERE razorpay_payment_id IS NOT NULL AND pay_now > 0 AND created_at >= ? ORDER BY created_at`, [since(days)]);
    // gateway_fee is an estimate (pg_fee_percent in Admin > Settings); settled_amount stays empty until Razorpay settlements are connected
    return rows.map((o) => ({ date: ist(o.confirmed_at || o.created_at), order_id: o.id, amount: r2(o.pay_now), gateway_fee: r2((o.pay_now * pct) / 100), settled_amount: '' }));
  },
  async shipments(days) {
    const opt = (v) => (v === null || v === undefined ? '' : r2(v));
    return (await placedOrders(days)).filter(({ o }) => o.awb).map(({ o }) => ({
      awb: o.awb, order_id: o.id, courier: o.courier || '', status: o.status, last_status_date: ist(o.returned_at || o.delivered_at || o.cancelled_at || o.ndr_at || o.shipped_at || o.updated_at),
      attempts: (o.ndr_count || 0) + (o.status === 'delivered' ? 1 : 0), ndr_reason: o.ndr_reason || '', forward_charge: opt(o.courier_charge), rto_charge: opt(o.rto_charge),
      cod_charge: opt(o.courier_cod_charge), reverse_pickup_charge: opt(o.reverse_pickup_charge), weight_charged_kg: ''
    }));
  }
};

/** csv('orders' | 'products' | 'payments' | 'shipments', { days }) -> CSV text */
async function csv(name, { days = 180 } = {}) {
  if (!COLS[name]) throw new Error('Unknown export: ' + name);
  if (!catalog.all.length) await catalog.refresh();
  return toCsv(COLS[name], await builders[name](days));
}

module.exports = { csv, NAMES, COLS };
