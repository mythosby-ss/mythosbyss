// Store policy pages (/pages/<slug>). Text is editable in Admin > Website > Policy pages (saved as setting "page_<slug>").
// The text below is only a starting DRAFT - review it before launch.
// Format: blank line = new paragraph, "## " = heading, "- " = bullet.
// Placeholders filled from your settings: {store} {support_whatsapp} {support_email} {delivery_days} {free_shipping_threshold}
//   {shipping_fee} {prepaid_discount} {partial_cod_amount} {confirm_hours}
const settings = require('./settings');

const DEFAULTS = {
  'shipping-policy': ['Shipping policy', `## Dispatch
Orders are packed and handed to our courier partner within 1-3 working days after the order is confirmed.

## Delivery time
Delivery usually takes {delivery_days} depending on your pincode. Remote areas can take a little longer.

## Delivery charges
- Free delivery on orders of {free_shipping_threshold} and above.
- Below that, a delivery charge of {shipping_fee} applies. You see the exact amount at checkout before you pay.

## Tracking
You get updates on WhatsApp when your order ships. You can also track it any time on our Track Order page with your order ID and mobile number.

## Failed delivery
If the courier cannot deliver, we will contact you on WhatsApp to arrange a re-attempt. Orders that cannot be delivered after the courier's attempts are returned to us.`],

  returns: ['Return & refund policy', `## Damaged, defective or wrong item
If your product arrives damaged, defective or different from what you ordered, message us on WhatsApp ({support_whatsapp}) within 7 days of delivery with your order ID and an unboxing video or clear photos. We will send a replacement or refund after checking.

## What we cannot accept
- Products that are used, washed or not in their original packaging (unless they arrived damaged).
- Requests without an unboxing video or photos of the damage.

## Refunds
- Prepaid orders: refunded to the original payment method within 5-7 working days after approval.
- Cash on delivery / partial COD: refunded to your UPI ID or bank account within 5-7 working days after approval.

## Cancellation
You can cancel before the order is shipped by messaging us on WhatsApp. Online payments for cancelled orders are refunded in full.`],

  'cod-policy': ['Cash on delivery (COD) policy', `## Pay online and save
Pay online with UPI, card or netbanking and get {prepaid_discount} off your order.

## Partial COD
Pay just {partial_cod_amount} online to confirm your order and pay the rest in cash when it arrives.

## Cash on delivery
- COD is available on most pincodes and order values. It may not be offered for some pincodes, for very high order values, or for numbers with earlier refused deliveries.
- Every COD order is confirmed with you on WhatsApp or by phone before we ship it. Orders not confirmed within {confirm_hours} hours are cancelled automatically.
- Please keep the exact cash amount ready at delivery.

## Refusing a COD order
Each refused COD parcel costs us two-way shipping. If a COD order is refused at the door without a valid reason, COD may be turned off for that mobile number for future orders (online payment and partial COD stay available).`],

  'privacy-policy': ['Privacy policy', `We collect only the details needed to process and deliver your order: your name, mobile number, email and delivery address. We use your WhatsApp number to send order updates.

We never sell your personal data. Online payments are processed by Razorpay; we do not store your card or UPI details.

We use cookies and advertising tools (such as the Meta Pixel) to understand visits and improve our ads. Customer details shared with advertising platforms are encrypted (hashed) first.

To ask for your data to be deleted, message us at {support_email}.`],

  terms: ['Terms & conditions', `By placing an order you agree to these terms. Prices and availability may change without notice.

Product images are for representation; colours and prints may vary slightly.

We may cancel orders that look fraudulent, have an incomplete or incorrect address, or cannot be confirmed with the customer.`],

  'about-us': ['About us', `{store} brings practical, good-quality kitchen and home products at fair prices, delivered across India.

We test what we sell, pack every order carefully and are on WhatsApp ({support_whatsapp}) if you need help.`],

  contact: ['Contact us', `## WhatsApp (fastest)
{support_whatsapp}

## Email
{support_email}

We reply within one working day. For order questions, please share your order ID.`]
};

function vars() {
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const partial = settings.get('partial_cod_type') === 'percent' ? `${settings.num('partial_cod_percent')}% of the order value` : money(settings.num('partial_cod_amount'));
  return {
    store: settings.get('store_name'), support_whatsapp: '+91 ' + settings.get('support_whatsapp'), support_email: settings.get('support_email'),
    delivery_days: settings.get('delivery_days_text'), free_shipping_threshold: money(settings.num('free_shipping_threshold')), shipping_fee: money(settings.num('shipping_fee')),
    prepaid_discount: money(settings.num('prepaid_discount')), partial_cod_amount: partial, confirm_hours: settings.get('confirm_autocancel_hours')
  };
}

const text = (slug) => { const saved = settings.get('page_' + slug); return saved != null && saved !== '' ? saved : DEFAULTS[slug][1]; };
const isDraft = (slug) => { const saved = settings.get('page_' + slug); return saved == null || saved === ''; };

/** Turn the page text into blocks for the template: { type: 'h'|'p'|'ul', text|items } */
function blocks(slug) {
  const v = vars(); const fill = (s) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  return fill(text(slug)).replace(/\r/g, '').split(/\n\s*\n/).map((chunk) => {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const l of lines) {
      if (l.startsWith('## ')) out.push({ type: 'h', text: l.slice(3) });
      else if (l.startsWith('- ')) { const last = out[out.length - 1]; if (last && last.type === 'ul') last.items.push(l.slice(2)); else out.push({ type: 'ul', items: [l.slice(2)] }); }
      else { const last = out[out.length - 1]; if (last && last.type === 'p') last.text += ' ' + l; else out.push({ type: 'p', text: l }); }
    }
    return out;
  }).flat();
}

module.exports = { DEFAULTS, slugs: Object.keys(DEFAULTS), title: (s) => DEFAULTS[s] && DEFAULTS[s][0], text, isDraft, blocks };
