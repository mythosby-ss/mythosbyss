const db = require('./db');
const DEFAULTS = {
  announcement: 'Save min 50% on all orders and get free shipping',
  // New arrivals ("Just landed" + /new-arrivals): products marked New or added in the last N days, always at least
  // new_arrivals_min products. If nothing was added in N days, the best sellers are shown instead.
  new_arrivals_min: '6',
  new_arrivals_days: '90',
  new_arrivals_max: '12',  // never more than this many (keeps the list "new" after a bulk import)
  new_arrivals_banner: 'Hot Deals',   // ribbon on the New arrivals section; empty = hidden
  // Owner emails (lib/owner-mail.js) - off until tested from Admin > Settings > Ops & owner emails
  owner_email_new_order: '0', owner_email_daily: '0', owner_email: '', daily_report_time: '22:00', owner_report_last_day: '',
  new_arrivals_banner_sub: 'Fresh picks and best sellers at special prices',
  shipping_fee: process.env.SHIPPING_FEE || '0',
  cod_fee: process.env.COD_FEE || '0',
  partial_cod_percent: process.env.PARTIAL_COD_PERCENT || '20',
  gst_percent: '18',
  pg_fee_percent: '2',
  review_delay_hours: process.env.REVIEW_DELAY_HOURS || '2',
  whatsapp_enabled: '1',
  store_name: 'MythosBySS',
  support_whatsapp: '7668757937',    // 10-digit number for the WhatsApp button, footer and policy pages
  support_phone: '7668757937',
  whatsapp_button_enabled: '1',      // floating WhatsApp button on every storefront page
  whatsapp_button_text: 'Hi {store}, I need help with my order.',
  support_email: 'mythosbyss@gmail.com', // shown in the footer and policy pages
  low_stock_default: '10',

  // ---- SEO (titles/descriptions for Google + WhatsApp/Instagram link previews) ----
  // Placeholders: {store} {domain} {site_description} {product} {price} {category} {collection} {pay_options} {snippet}
  // A product's / category's own SEO title + description (set in admin) always win over these templates.
  site_description: 'Mythosbyss offers quality everyday essentials from insulated drinkware to lifelike botanicals. Elevate your lifestyle with trusted products designed for function and beauty.',
  seo_home_title: 'Buy {store} products online at best prices on {domain}',
  seo_home_desc: 'Shop from {store}. Premium quality, competitive pricing, fast shipping, and secure checkout. Order online today.',
  seo_product_title: '{product} Price in India - Buy Online | {store}',
  seo_product_desc: 'Buy {product} for Rs.{price} online at {store}. {pay_options}. {snippet}',
  seo_collection_title: '{collection} - Buy {collection} Online at Best Prices | {store}',
  seo_collection_desc: 'Buy {collection} from {store} at the best prices and offers. Check price in India and shop online.',
  social_instagram: 'https://www.instagram.com/mythosbyss2025/',  // used in Google's Organization data (sameAs)
  social_facebook: 'https://www.facebook.com/profile.php?id=61570826892078',
  social_youtube: '',

  // ---- COD / RTO protection: all editable in Admin > Settings > COD & RTO rules ----
  prepaid_discount: '40',            // ₹ off when paying fully online (0 = off)
  partial_cod_enabled: '1',          // offer "pay a small advance now, rest on delivery"
  partial_cod_type: 'fixed',         // 'fixed' (₹ amount below) or 'percent' (partial_cod_percent above)
  partial_cod_amount: '99',          // ₹ advance for partial COD
  default_payment_method: 'partial_cod', // pre-selected at checkout: partial_cod | prepaid | cod
  cod_enabled: '1',                  // full cash on delivery on/off
  cod_min_order: '0',                // ₹ minimum order value for full COD (0 = no minimum)
  cod_max_order: '0',                // ₹ maximum order value for full COD (0 = no limit)
  pincode_mode: 'all',               // 'all' = every valid pincode is serviceable unless marked; 'list' = only listed pincodes
  rto_block_threshold: '1',          // past RTOs on a phone number that turn off full COD (0 = off)
  // ---- Payment rules by cart total + chargeable weight (lib/codrules.js cartRule). Strictest rule wins. ----
  pay_rules_enabled: '1',            // 0 = ignore weight/total tiers (only the rules above apply)
  default_weight_kg: '0.5',          // chargeable weight used for products with no weight entered
  pay_rule_cod_below_total: '800',   // full COD only when cart total is BELOW this ...
  pay_rule_cod_max_weight: '1',      // ... AND weight is at most this (kg)
  pay_rule_mid_max_total: '1000',    // up to this total / ...
  pay_rule_mid_max_weight: '2',      // ... this weight: partial COD with the advance below, or prepaid
  pay_rule_mid_advance: '199',       // ₹ advance for partial COD in the middle tier
  pay_rule_high_partial: '1',        // above that: allow partial COD with the weight-table advance (0 = prepaid only)
  pay_rule_high_advance_table: '3:299', // "up to kg:₹advance", e.g. "2:249, 3:299"; heavier = no partial COD
  pay_rule_prepaid_only_weight: '3', // over this weight (kg): prepaid only
  risk_allow_partial: '1',           // when full COD is blocked (pincode / phone / RTO), still allow partial COD
  address_require_landmark: '1',     // landmark is required at checkout
  delivery_days_text: '4-8 working days',

  // ---- Order value (Admin > Offers > Bundles, add-ons & offers) ----
  free_shipping_threshold: '499',    // ₹ cart value for free delivery; shows a progress bar when the shipping fee is above 0 (0 = off)
  qty_offer_tiers: '',               // quantity offers per product, "qty:₹off" e.g. "2:30, 3:75" = buy 2 save ₹30, buy 3 save ₹75 (empty = off)
  qty_offer_on_bundles: '0',         // also apply quantity offers to bundles
  upsell_enabled: '1',               // "Frequently bought together" on product page + add-ons in cart
  upsell_max: '3',                   // how many add-ons to show
  upsell_auto: '1',                  // when no add-ons are chosen for a product, pick them automatically (bought together / low-price items)

  // ---- Profit dashboard assumptions (Admin > Analytics > Profit & RTO) ----
  profit_packaging_default: '10',    // ₹ packaging per order when the product has none set
  profit_forward_shipping_default: '90', // ₹ forward shipping per order when no courier charge was entered and the product has none set
  profit_reverse_shipping: '0',      // ₹ charged by the courier to bring an RTO back (0 if your courier does not charge)
  cod_handling_percent: '2',         // courier COD collection fee, % of cash collected
  cod_handling_min: '30',            // ... with this ₹ minimum per COD shipment
  profit_deduct_gst: '0',            // remove GST (gst_percent) from revenue before profit

  // ---- Shipping (Admin > Settings > Shipping & NDR) ----
  courier_names: 'Delhivery, Xpressbees, Ecom Express, DTDC, Shadowfax, Ekart, Blue Dart, India Post', // suggestions when shipping
  // WhatsApp text for failed deliveries. Placeholders: {name} {order_id} {courier} {awb} {store} {due} {address}
  ndr_message: 'Hi {name}, this is {store} about your order {order_id}.\n\nOur courier ({courier}) says they tried to deliver it today. Did our courier visit you today? Please share a good time for re-delivery.',

  // ---- COD order confirmation (Admin > Settings > COD & RTO rules) ----
  confirm_autocancel_hours: '24',    // cancel COD orders not confirmed within this many hours (0 = never)
  // WhatsApp text opened by the "Confirm on WhatsApp" button. Placeholders: {name} {order_id} {items} {total} {due} {address} {store} {hours}
  confirm_message: 'Hi {name}, thank you for ordering from {store}!\n\nOrder ID: {order_id}\nItems: {items}\nAmount to pay on delivery: {due}\nDelivery address: {address}\n\nPlease reply YES to confirm your order so we can ship it. Reply NO if you do not want it.',
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
