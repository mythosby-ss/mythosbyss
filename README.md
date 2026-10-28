# MythosBySS storefront

Node.js + Express + EJS e-commerce site with Tailwind CSS (installed package, compiled with the Tailwind CLI, no CDN), session cart, Buy Now, and three payment modes: **Prepaid (Razorpay)**, **Cash on Delivery** and **Partial COD** (advance via Razorpay, balance in cash).

## Run it

```bash
cp .env.example .env      # add your Razorpay test keys
npm install               # also builds public/css/styles.css (postinstall)
npm run dev               # nodemon + Tailwind watch  ->  http://localhost:3000
# production
npm run build:css && NODE_ENV=production npm start
```

## What is included

| Area | Details |
|---|---|
| Home | Hero carousel, one product from each of the 12 categories, new arrivals, customer reviews with photos |
| Browsing | `/collections/:category`, `/new-arrivals`, `/products` (search `?q=`, sort, category chips) |
| Product page | Gallery, size/variant picker with live price, quantity, **Add to cart**, **Buy now**, pincode check, specs table, reviews, related products, JSON-LD |
| Cart | Session cart, update/remove, savings summary |
| Checkout | Validated address form, 3 payment methods, server-side price calculation |
| Orders | Confirmation page, `/track` (order ID + phone), `/admin` order list (HTTP basic auth) |
| Security | Helmet CSP, CSRF token on every POST, rate limits, Razorpay HMAC signature verification, webhook fallback |

## Payments

* `POST /checkout/place` recomputes totals on the server, saves the order and (if money is due now) creates a Razorpay order.
* Browser opens Razorpay Checkout; on success `POST /checkout/verify` checks `HMAC_SHA256(order_id|payment_id)` with your key secret before confirming.
* **Partial COD**: `PARTIAL_COD_PERCENT` (default 20) is charged online; the order shows the balance to collect on delivery (also visible in `/admin`).
* Webhook (recommended): in the Razorpay dashboard add `https://YOUR-DOMAIN/webhooks/razorpay`, events `payment.captured` and `order.paid`, and put the secret in `RAZORPAY_WEBHOOK_SECRET`.
* Use `rzp_test_` keys until you go live.

## Product data and prices

`data/products.js` holds 81 products / 134 variants extracted from the PDF (names, sizes, item codes, master packs, categories). SKUs are `MB-NK-N-<item code>`.

**The PDF contains no prices, so every price is a placeholder.** Edit the third number in each variant tuple. MRP is automatically 2x price to match the "Save min 50%" banner.

Catalog notes to double-check:
* Super, Bento Buddy and Fresh Bite lunch boxes have no item code in the PDF, so they were given N-619, N-620, N-621.
* A few pages disagree with themselves (Antic: size 800 vs code 600; Hydro: 900 vs 800; Cool Star 3000 vs 2500). The item-code size was used.
* The "Doremon" combo page was labelled "Applo lunch box & hydro bottle" in the PDF.

## Images (Google Drive)

I could not download your Drive folder from here, so images are wired up two ways. Use whichever is easier:

1. **Local files (recommended for production):** download the Drive images and save them in `public/images/products/` named after the product slug, e.g. `crystal-casserole.jpg`, plus `crystal-casserole-2.jpg` for extra gallery shots. Run `npm run slugs` to print every expected name.
2. **Direct from Drive:** share each file as "Anyone with the link", then map the slug to the file ID in `data/images.json`:
   `"crystal-casserole": ["<fileId>", "<fileId2>"]`
Missing images fall back to `public/images/placeholder.svg`.

Customer review photos: put files in `public/images/reviews/` and set `photo` in `data/reviews.js` (otherwise the reviewed product image is shown).

## Before going live

* Swap the JSON order store (`lib/store.js`) for MongoDB/Postgres and the session MemoryStore for Redis.
* Send order emails/SMS (e.g. Nodemailer, MSG91) from `lib/orders.js` / `routes/checkout.js`.
* Replace the sample reviews, policy text and the demo pincode check (courier API such as Shiprocket).
* Add GST invoice fields if you need them, and set a strong `SESSION_SECRET` and admin password.
