const db = require('./db');
const DEFAULTS = {
  announcement: 'Save min 50% on all orders and get free shipping',
  shipping_fee: process.env.SHIPPING_FEE || '0',
  cod_fee: process.env.COD_FEE || '0',
  partial_cod_percent: process.env.PARTIAL_COD_PERCENT || '20',
  gst_percent: '18',
  pg_fee_percent: '2',
  review_delay_hours: process.env.REVIEW_DELAY_HOURS || '2',
  whatsapp_enabled: '1',
  store_name: 'MythosBySS',
  support_email: 'support@mythosbyss.com',
  low_stock_default: '10',
  // Billing & invoice
  invoice_prefix: 'MBSS-',
  // Shipping label (defaults mirror common courier-label practice)
  label_type: 'without_invoice',
  label_prepaid_value: '0', label_cod_value: '1', label_seller_phone: '0', label_seller_address: '1',
  label_hide_items: '0', label_product_code: '1', label_brand_logo: '1', label_hide_invoice_no: '1',
  label_customer_phone: '1', label_order_details: '1', label_repeat_customer: '0', label_unboxing: '1'
};
let cache = { ...DEFAULTS };
module.exports = {
  async load() { for (const r of await db.q('SELECT key,value FROM settings')) cache[r.key] = r.value; },
  get: (k) => (cache[k] !== undefined ? cache[k] : DEFAULTS[k]),
  on: (k) => String(cache[k] ?? DEFAULTS[k] ?? '') === '1',
  num: (k) => { const n = Number(cache[k] ?? DEFAULTS[k]); return Number.isFinite(n) ? n : 0; },
  all: () => ({ ...cache }),
  async set(k, v) {
    cache[k] = String(v);
    await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [k, String(v)]);
  }
};
