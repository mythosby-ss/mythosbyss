# MythosBySS - storefront + admin portal

Node.js, Express, EJS, Tailwind CSS (installed package, no CDN), libSQL/Turso database, Razorpay, WhatsApp Cloud API, Google Drive media.

```bash
cp .env.example .env     # fill what you have; everything optional works in "simulated" mode locally
npm install              # also builds public/css/styles.css
npm run dev              # store: http://localhost:3000   admin: http://localhost:3000/admin
```
Full service setup (Turso, Drive, WhatsApp, Razorpay): **docs/SETUP.md**. WhatsApp template text: **docs/WHATSAPP_TEMPLATES.md**.

## Customer side
| Feature | Notes |
|---|---|
| WhatsApp login | `/login`: phone number -> 6-digit code sent as a WhatsApp *authentication* template. Hashed codes, 5-minute expiry, 5 tries, 3 codes per 15 min. Checkout needs login, address is remembered. |
| Catalogue | Reads from the database. Admin edits show up immediately (cache refresh on save). Out-of-stock sizes are disabled, stock is reserved at order time. |
| Payments | Prepaid (Razorpay), COD, Partial COD (advance via Razorpay, balance on delivery). Totals are computed on the server. Coupons supported. |
| Orders | Order page with progress tracker and AWB; `/account` lists all orders. |
| Social proof | Home page UGC video section (Drive videos, click-to-play), photo reviews, product-page videos and reviews. Customers review through the WhatsApp link after delivery; admin approves. |
| SEO | Per-product/category titles and descriptions, canonical + Open Graph tags, `sitemap.xml`, `robots.txt`, JSON-LD, 301 redirects when a URL slug is changed. |

## Admin portal (`/admin`, left navigation like the reference)
* **Home** - weekly/monthly trend report (orders, RTO %, sales, courier cost, ad spend, gateway fees, product cost, net profit; Meta/Google filter).
* **Analytics > Dashboard** - tabs: Order (trends, payment mode, states, cities, top products, AOV, cancellations), Product (best/under-performers, product-wise revenue and margin), Business metrics (funnel, conversion rate, traffic sources, COD vs prepaid, repeat rate), Inventory (low-stock alerts), WhatsApp. **Reports** - 9 downloadable CSVs (reconciliation, orders, dispatched, shipping, cash-flow, GST tax, product performance, WhatsApp log, customers).
* **Orders** - process queue (pack, ship with courier + AWB, out for delivery, delivered, cancel, RTO), label printing, refunds (Razorpay or manual), full timeline and WhatsApp log per order. Each status change sends the customer a WhatsApp update.
* **Finance** - remittance overview (outstanding COD, in-transit COD, prepaid received, refunds), settlement creation/payout tracking, order-wise finance table with CSV, refunds and cancellations.
* **Products** - catalogue list, create/edit (variants, price, MRP, cost, stock, SEO, images), Drive upload / Drive link / "Sync from Drive folder", inventory editor.
* **Customers**, **Offers and Coupons**.
* **Marketing** - *Performance* (campaigns, daily spend, CPA, ROAS, CTR, campaign- and product-wise views; orders attributed through `utm_campaign`), *Digital* (home banners, promotion planner with UTM link builder), *SEO* (score and issues per product, inline metadata editing, traffic sources, searches with no results).
* **Website** - UGC testimonials (import all videos from a Drive folder), review moderation.
* **Communication** - WhatsApp status, template names, delivery log, test message. **Settings** - announcement bar, shipping/COD fees, partial-COD %, GST %.

## Things to know
* **Prices:** the PDF had none. All prices are placeholders; edit them under Products > Catalogue (each variant). MRP was seeded at 2x price.
* **Ad platforms:** spend/impressions/clicks are entered manually or pasted as CSV rows from Ads Manager. Orders, revenue, CPA and ROAS are real, attributed from UTM tags on your ad links. Automatic Meta/Google Ads API sync is not included.
* **Courier:** status is set by admin or by the generic `POST /webhooks/shipping` endpoint (header `x-webhook-secret`). No courier booking API is wired.
* **WhatsApp:** templates need Meta approval; review requests may be billed as marketing messages.
* **Security:** CSRF on every POST, Helmet CSP, rate limits (login, OTP, checkout), signed Razorpay/WhatsApp webhooks, formula-safe CSV exports. Admin is a single login from `.env`; put the site behind HTTPS.
* **Tests:** the SQL layer and every storefront/admin route were exercised in a local harness with the database and web framework replaced by stand-ins. Run the real thing once with `npm run dev` and click through before launch.
