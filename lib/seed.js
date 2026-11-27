// Initializes schema and ancillary defaults; product and category catalog data is database-managed.
// No reviews are seeded: the storefront shows only real reviews submitted by customers after delivery.
const db = require('./db');
const schema = require('./schema');

// Sample reviews that older versions of this file inserted. They were never written by customers,
// so they are removed once (exact match on name + title, and never linked to an order).
const OLD_SAMPLE_REVIEWS = [
  ['Priya Sharma', 'Keeps water cold all day'], ['Rohit Verma', 'Looks premium on the table'], ['Anjali Gupta', 'My son loves it'],
  ['Mohit Singh', 'Great for the shop'], ['Sneha Kapoor', 'Kids approved'], ['Imran Khan', 'Solid tiffin for office']
];

async function ensureColumn(table, column, type) {
  const cols = await db.q(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

module.exports = async function init() {
  await db.client.executeMultiple(schema);
  // Columns added after the first release (CREATE TABLE IF NOT EXISTS does not add them to existing tables)
  await ensureColumn('variants', 'images', "TEXT DEFAULT '[]'");
  await ensureColumn('orders', 'prepaid_discount', 'REAL DEFAULT 0');
  await ensureColumn('orders', 'offer_discount', 'REAL DEFAULT 0');
  await ensureColumn('order_items', 'components', 'TEXT');
  for (const c of ['fbp', 'fbc', 'client_ip', 'user_agent', 'ndr_reason', 'ndr_at']) await ensureColumn('orders', c, 'TEXT');
  await ensureColumn('orders', 'ndr_count', 'INTEGER DEFAULT 0');
  await ensureColumn('products', 'packaging_cost', 'REAL'); // NULL = use the default from settings
  await ensureColumn('products', 'shipping_cost', 'REAL');
  // Payment rules by weight (lib/codrules.js): dead weight + box size -> chargeable weight = max(dead, L*B*H/5000)
  await ensureColumn('products', 'weight_kg', 'REAL');
  await ensureColumn('products', 'length_cm', 'REAL');
  await ensureColumn('products', 'breadth_cm', 'REAL');
  await ensureColumn('products', 'height_cm', 'REAL');
  await ensureColumn('products', 'chargeable_weight_kg', 'REAL'); // NULL = use default_weight_kg from settings
  await ensureColumn('products', "payment_mode_override", "TEXT DEFAULT 'auto'"); // auto | prepaid_only
  // Ops workspace (ops/README.md): split address, language, ad content, returns and courier charges
  for (const c of ['address_line1', 'address_line2', 'landmark', 'preferred_language', 'utm_content', 'returned_at']) await ensureColumn('orders', c, 'TEXT');
  for (const c of ['rto_charge', 'courier_cod_charge', 'reverse_pickup_charge']) await ensureColumn('orders', c, 'REAL'); // NULL = not entered yet
  // Ad exclusion log: include RTO / cancelled orders from before this table existed
  await db.run(`INSERT OR IGNORE INTO ad_exclusions(order_id, kind, at)
    SELECT id, CASE WHEN status='rto' THEN 'rto' WHEN cancel_reason='Payment not completed' THEN 'unpaid' WHEN cancel_reason LIKE 'Auto-cancelled%' OR cancel_reason LIKE '%not reachable%' THEN 'cod_cancelled' ELSE 'cancelled' END,
      COALESCE(cancelled_at, updated_at) FROM orders WHERE status IN ('rto','cancelled')`);
  await db.run('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone, status)');
  await db.run('CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)'); // daily report + ops export date ranges
  for (const [name, title] of OLD_SAMPLE_REVIEWS) {
    await db.run('DELETE FROM reviews WHERE order_id IS NULL AND customer_name=? AND title=?', [name, title]);
  }
  if (!(await db.val('SELECT COUNT(*) FROM coupons'))) {
    await db.batch([
      ["INSERT INTO coupons(code,title,type,value,max_discount,min_order,expires_on) VALUES('EXTRA15','15% off up to Rs.200 (min order Rs.949)','percent',15,200,949,'2027-06-30')"],
      ["INSERT INTO coupons(code,title,type,value,max_discount,min_order,expires_on) VALUES('BUMPER10','10% off up to Rs.100 (min order Rs.599)','percent',10,100,599,'2027-06-30')"]
    ]);
  }
};
