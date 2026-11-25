module.exports = `
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT, sort INTEGER DEFAULT 0,
  seo_title TEXT, seo_desc TEXT, seo_keywords TEXT);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  description TEXT, features TEXT DEFAULT '[]', badge TEXT, is_new INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published', images TEXT DEFAULT '[]', image_alt TEXT,
  seo_title TEXT, seo_desc TEXT, seo_keywords TEXT, sort INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT, packaging_cost REAL, shipping_cost REAL);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, sku TEXT UNIQUE NOT NULL, code TEXT,
  label TEXT NOT NULL, price REAL NOT NULL, mrp REAL NOT NULL, cost_price REAL DEFAULT 0,
  stock INTEGER DEFAULT 0, low_stock INTEGER DEFAULT 10, pack INTEGER, active INTEGER DEFAULT 1,
  images TEXT DEFAULT '[]');

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
  last_address TEXT, blocked INTEGER DEFAULT 0, created_at TEXT, last_login TEXT);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER DEFAULT 0, used INTEGER DEFAULT 0, created_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, customer_id INTEGER, status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
  subtotal REAL, discount REAL DEFAULT 0, coupon_code TEXT, shipping_fee REAL DEFAULT 0, cod_fee REAL DEFAULT 0,
  total REAL, pay_now REAL DEFAULT 0, due_on_delivery REAL DEFAULT 0, prepaid_discount REAL DEFAULT 0, offer_discount REAL DEFAULT 0,
  fbp TEXT, fbc TEXT, client_ip TEXT, user_agent TEXT, ndr_count INTEGER DEFAULT 0, ndr_reason TEXT, ndr_at TEXT,
  name TEXT, email TEXT, phone TEXT, address TEXT, city TEXT, state TEXT, pincode TEXT, note TEXT,
  courier TEXT, awb TEXT, courier_charge REAL DEFAULT 0,
  razorpay_order_id TEXT, razorpay_payment_id TEXT,
  utm_source TEXT, utm_campaign TEXT, utm_medium TEXT, review_token TEXT,
  cancel_reason TEXT, cod_settlement_id INTEGER,
  created_at TEXT, confirmed_at TEXT, shipped_at TEXT, delivered_at TEXT, cancelled_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_slug TEXT, product_name TEXT, sku TEXT,
  variant_label TEXT, qty INTEGER, unit_price REAL, cost_price REAL DEFAULT 0, components TEXT);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, status TEXT, note TEXT, actor TEXT, at TEXT);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, amount REAL, reason TEXT, method TEXT,
  razorpay_refund_id TEXT, status TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT, cycle_start TEXT, cycle_end TEXT, order_count INTEGER,
  cod_amount REAL, expenses REAL, net_amount REAL, status TEXT DEFAULT 'pending', paid_on TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, title TEXT, type TEXT DEFAULT 'percent',
  value REAL NOT NULL, max_discount REAL, min_order REAL DEFAULT 0, expires_on TEXT, active INTEGER DEFAULT 1, used INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_slug TEXT, order_id TEXT, customer_name TEXT, city TEXT,
  rating INTEGER, title TEXT, body TEXT, photo TEXT, status TEXT DEFAULT 'pending', created_at TEXT);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT, city TEXT, quote TEXT, rating INTEGER DEFAULT 5,
  video TEXT, thumb TEXT, product_slug TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at TEXT);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, subtitle TEXT, image TEXT, cta_text TEXT, link TEXT,
  theme TEXT DEFAULT 'lilac', active INTEGER DEFAULT 1, starts_on TEXT, ends_on TEXT, sort INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, channel TEXT, coupon_code TEXT, content TEXT, landing TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, starts_on TEXT, ends_on TEXT, status TEXT DEFAULT 'planned');

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, platform TEXT, utm_campaign TEXT UNIQUE,
  product_slug TEXT, objective TEXT, status TEXT DEFAULT 'active', created_at TEXT);
CREATE TABLE IF NOT EXISTS ad_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, day TEXT NOT NULL, spend REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, conversions INTEGER DEFAULT 0, UNIQUE(campaign_id, day));

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT, at TEXT, sid TEXT, type TEXT, path TEXT, ref TEXT,
  source TEXT, term TEXT, product_slug TEXT, results INTEGER);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, type);

CREATE TABLE IF NOT EXISTS notification_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, customer_phone TEXT, template TEXT, status TEXT,
  wa_message_id TEXT, error TEXT, payload TEXT, send_at TEXT, sent_at TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_logs(status, send_at);

CREATE TABLE IF NOT EXISTS slug_redirects (from_path TEXT PRIMARY KEY, to_path TEXT);

-- COD / RTO rules (managed in Admin > Settings > COD & RTO rules)
CREATE TABLE IF NOT EXISTS pincodes (
  pincode TEXT PRIMARY KEY, serviceable INTEGER DEFAULT 1, cod_blocked INTEGER DEFAULT 0, note TEXT, updated_at TEXT);
-- Bundles: a variant (bundle_sku) made of other variants. Its stock is computed from the components.
CREATE TABLE IF NOT EXISTS bundle_items (
  bundle_sku TEXT NOT NULL, component_sku TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (bundle_sku, component_sku));
-- "Frequently bought together" add-ons chosen by the admin (otherwise picked automatically)
CREATE TABLE IF NOT EXISTS product_addons (
  product_slug TEXT NOT NULL, addon_slug TEXT NOT NULL, sort INTEGER DEFAULT 0, PRIMARY KEY (product_slug, addon_slug));
-- RTO / cancelled orders, for exporting an ad exclusion audience (hashed phones/emails) from admin
CREATE TABLE IF NOT EXISTS ad_exclusions (
  order_id TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT);
-- Customer's answer when a delivery failed (NDR) - proof for courier escalations ("courier never came")
CREATE TABLE IF NOT EXISTS ndr_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, attempt INTEGER, courier TEXT, reply TEXT, detail TEXT, actor TEXT, at TEXT);
CREATE INDEX IF NOT EXISTS idx_ndr_notes_order ON ndr_notes(order_id);
-- Manual daily ad spend for the profit dashboard (overrides campaign spend for that day when set)
CREATE TABLE IF NOT EXISTS daily_ad_spend (day TEXT PRIMARY KEY, amount REAL NOT NULL DEFAULT 0, note TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS phone_rules (
  phone TEXT PRIMARY KEY, cod_blocked INTEGER DEFAULT 1, note TEXT, created_at TEXT);
-- Speed: indexes for lookups that run on every product view, payment check, OTP login and the 1-minute scheduler
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_order ON reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_active ON testimonials(active, sort);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_review_token ON orders(review_token);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_notif_order ON notification_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`;
