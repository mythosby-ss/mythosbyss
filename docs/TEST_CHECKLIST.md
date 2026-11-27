# Launch test checklist (Phases 0–8)

Tick each box as you test. Everything here runs locally — nothing is sent to Meta, WhatsApp or a courier unless you add those keys.

## Before you start

- [ ] In `.env`, put `#` in front of `DB_URL` and `DB_TOKEN` so testing uses the local file `data/mythosbyss.db`, not your live Turso database.
- [ ] Run `npm install` (adds the new `sharp` image library), then `npm run dev`.
- [ ] Store: http://localhost:3000 · Admin: http://localhost:3000/admin (user/password from `.env`).
- [ ] Customer login in development: any valid 10-digit mobile number + code **123456789**.
- [ ] After changing `.env`, stop and restart `npm run dev`.

Note: your `.env` has **live** Razorpay keys. Online payments (prepaid / partial COD) will open real Razorpay. Use test keys (`rzp_test_…`) if you want to complete test payments.

---

## Phase 0 – Launch safety

- [ ] `git status`: `data/mythosbyss.db` shows as deleted (untracked) and `.env` is not listed.
- [ ] Admin → Website → Customer reviews: the 6 old sample reviews are gone.
- [ ] Log in as a customer, stop the server, start it again, refresh `/account` → still logged in.
- [ ] Open `http://localhost:3000/?utm_source=facebook`, place an order → Admin order shows source facebook (Analytics / reports).
- [ ] An online order left unpaid for 45 minutes is cancelled automatically and its stock comes back.

## Phase 1 – COD / RTO protection

- [ ] Product page shows "Pay online & save ₹40 extra" and the COD / Partial COD bullets.
- [ ] Product page "Check delivery": `110001` → delivery days + "Cash on delivery available"; `111111` → "Enter a valid 6-digit pincode".
- [ ] Cart shows "Pay online at checkout & save ₹40 more".
- [ ] Checkout: Partial COD is pre-selected and marked "Recommended" ("Pay just ₹99 …").
- [ ] Choosing "Pay online" shows the ₹40 prepaid discount row; total drops by ₹40.
- [ ] Fake inputs are rejected: name `test`, house `aaaa`, area `asdf asdf`, landmark `na`, city `xyz`, pincode `111111`.
- [ ] Landmark is required (switch it off in settings → becomes optional).
- [ ] Login with `9999999999` is rejected.
- [ ] Admin → Settings → COD & RTO rules opens and saves.
- [ ] Block COD for a pincode → at checkout, typing that pincode greys out "Cash on delivery" with a reason; partial COD + online still work.
- [ ] Mark a pincode "not serviceable" → checkout shows "Sorry, we do not deliver to …"; product page check says the same.
- [ ] Blacklist your test phone → COD greyed out on any pincode. Remove it → COD back.
- [ ] Set COD maximum to ₹100 → COD greyed out for a bigger cart. Set back to 0.
- [ ] Turn COD off → only online / partial COD. Turn back on.
- [ ] A phone with 1 past RTO cannot pick full COD (test after Phase 2/5 RTO steps).
- [ ] Admin order page shows "No past RTO" / "N past RTO" next to the customer.

## Phase 2 – Order confirmation

- [ ] Place a COD order → order page says "We will message you on WhatsApp to confirm".
- [ ] Admin → Orders opens on "Needs confirmation (1)"; top bar shows "1 to confirm".
- [ ] "WhatsApp" button opens wa.me with the confirmation message; order timeline shows "Confirmation WhatsApp opened by admin".
- [ ] Trying to mark an unconfirmed order "Shipped" shows an error.
- [ ] "Confirmed" → order moves to Non-dispatched and can be packed / shipped.
- [ ] "Cancel – not reachable" → cancelled, stock restored.
- [ ] Settings → COD & RTO rules → set auto-cancel to 1 hour; an older unconfirmed order is cancelled within a minute ("Auto-cancelled: not confirmed within …").
- [ ] Edit the WhatsApp confirmation message; the button uses the new text.
- [ ] Prepaid / partial COD orders skip confirmation once paid.

## Phase 3 – Order value (AOV)

- [ ] Admin → Offers and Coupons → Bundles, add-ons & offers opens.
- [ ] Set shipping fee ₹49, free delivery from ₹499 → cart shows "Add ₹X more for FREE delivery" with a bar; above ₹499 shows "You get FREE delivery!".
- [ ] Set quantity offers `2:30, 3:75` → product page shows "Buy 2, save ₹30 · Buy 3, save ₹75"; cart with 2 of one product shows the offer line.
- [ ] Bundle: create a combo product (one size), link 2 items with quantities → combo page shows "This combo includes…" and "you save ₹…".
- [ ] Combo stock = complete sets the item stock allows. Ordering the combo reduces each item's stock; cancelling puts it back.
- [ ] Admin order page and printed label show what is inside the combo.
- [ ] Choose add-ons for a product → product page "Frequently bought together" with checkboxes and live total; "Add selected to cart" adds them.
- [ ] Cart shows "Add to your order" suggestions with "+ Add".

## Phase 4 – Meta Pixel + Conversions API

Add to `.env`: `META_PIXEL_ID`, `META_CAPI_TOKEN`, `META_TEST_EVENT_CODE` (Events Manager → Test events), restart.

- [ ] Admin → Settings → Marketing & tracking shows all three as "set" and Test Events "ON".
- [ ] Events Manager → Test events → open the site: PageView, ViewContent, AddToCart, InitiateCheckout appear.
- [ ] AddToCart also fires for Buy now, "Frequently bought together" and cart "+ Add".
- [ ] Place a COD order → only **COD_Placed** appears (browser + server, deduplicated). **No Purchase.**
- [ ] Confirm that order in admin → a server **Purchase** appears; order timeline: "Purchase event -> Meta: ok (test event)".
- [ ] (Needs Razorpay test keys) Prepaid payment → one Purchase, deduplicated browser + server.
- [ ] Turn the internet off (or use a wrong token) and place an order → checkout still works; timeline shows the Meta failure.
- [ ] Mark an order RTO / cancelled → Marketing & tracking → Ad exclusion audience → Download CSV → hashed `email,phone` rows.
- [ ] Remove `META_TEST_EVENT_CODE` when done.

## Phase 5 – Shipping & NDR

- [ ] Admin → Settings → Shipping & NDR shows provider "Manual" and the courier list.
- [ ] Ship a confirmed order: courier suggestions appear; AWB `12 34!` is rejected; `DLV12345678` works.
- [ ] Mark "Delivery attempted (NDR)" with a reason → red "1 NDR" badge; Orders → "NDR - action needed".
- [ ] NDR "WhatsApp" opens "…Did our courier visit you today? Please share a good time for re-delivery."
- [ ] Record "Courier never came / no call received" + details → shows on the order (with courier + attempt number) and in the timeline.
- [ ] "Re-attempt requested" → back to Shipped, AWB kept. NDR again → attempt 2.
- [ ] "Mark RTO" → RTO, stock restored, customer in the exclusion list, full COD blocked for that phone next time.
- [ ] Customer order page during NDR says the courier could not deliver.

## Phase 6 – Profit dashboard

- [ ] Admin → Analytics → Profit & RTO opens with a date filter.
- [ ] "Edit product costs": enter real cost, packaging, shipping → saved (also editable on each product's page).
- [ ] Cost assumptions: enter your real packaging, forward/reverse shipping, gateway %, courier COD fee.
- [ ] Mark some orders Delivered and one RTO → order mix, delivered/RTO counts, RTO % update.
- [ ] Type ad spend for today in "Daily profit / loss" → headline profit and breakeven orders/day update.
- [ ] RTO % by pincode / state / courier / payment type / city tables fill in; "Block COD" on a pincode adds it to COD rules.
- [ ] Compare profit per order, loss per RTO, breakeven RTO % and breakeven orders/day with your own profit sheet.
- [ ] Monthly table shows the last 6 months.

## Phase 7 – Trust & speed

- [ ] Green WhatsApp button bottom-right on every store page; opens WhatsApp with "Hi MythosBySS, I need help with my order."
- [ ] Footer: phone / WhatsApp / email come from settings; links to COD Policy and Contact work.
- [ ] Admin → Website → Policy pages & support: change the WhatsApp number → footer and button update; untick the button → it disappears.
- [ ] Every policy page opens: /pages/shipping-policy, returns, cod-policy, privacy-policy, terms, about-us, contact.
- [ ] **Read and edit every policy page** (all start as "Draft"). Values like ₹40 / ₹99 / ₹499 / delivery days fill in from settings.
- [ ] /track: wrong phone → "could not find"; right order ID + phone → status, progress, items, amount due (no address shown).
- [ ] Product without reviews: "No reviews yet. Only customers who have received this product can review it…".
- [ ] Home page: "What customers say" section is hidden until real approved reviews exist.
- [ ] After a delivered order's review link (WhatsApp) → approve in Admin → review shows with "Verified buyer".
- [ ] Product images look sharp (they were compressed; originals are in `data/image-originals/`).
- [ ] Upload a new product image in admin → it is resized/compressed automatically.

## Phase 8 – SEO & speed

Open any page → right-click → **View page source** to check the tags.

- [ ] Home source: one `<h1>`, `<link rel="canonical">`, `og:title` / `og:image` tags, and two `application/ld+json` blocks (Organization, WebSite).
- [ ] Product source: title like "Crystal Casserole Price in India - Buy Online | MythosBySS", a description with name + price, `og:type` product, JSON-LD Product (with offers per size) + BreadcrumbList.
- [ ] Paste a product URL into https://search.google.com/test/rich-results (after going live) → Product + Breadcrumb detected, no errors.
- [ ] `/products?sort=price-asc` and `/products/<slug>?v=SKU` → canonical points to the URL **without** `?…`.
- [ ] `/cart`, `/login`, `/track`, `/products?q=jug` → source has `<meta name="robots" content="noindex, follow">`.
- [ ] http://localhost:3000/robots.txt blocks admin, cart, checkout, account, login, order, review, track, api, search.
- [ ] http://localhost:3000/sitemap.xml lists products (with `<lastmod>` and images), collections and policy pages.
- [ ] Change a product's URL (slug) in admin → open the old URL → it redirects to the new one.
- [ ] Old Shopdeck URLs redirect: `/featured/all-products` → `/products`, `/return-policy` → `/pages/returns`, `/WATER-BOTTLES/collection/yqippwCC` → water bottle collection.
- [ ] DevTools → Network → reload: no request to `fonts.googleapis.com` / `fonts.gstatic.com`; product photos load as `.webp`.
- [ ] Upload a product photo in admin → a `.webp` copy appears next to it (in `UPLOAD_DIR` or `public/images/uploads`).
- [ ] Edit a banner or approve a review in admin → home page shows the change at once (cache clears on save).
- [ ] Full checkout still works: login with OTP → place a COD order.

## Phase 9 – Payment rules by cart total & weight

Automatic tests (safe: temporary copy of the local database, no network): `npm run test:payments` → "28 passed, 0 failed".

Setup: Admin → Settings → COD & RTO rules → "Payment rules by cart total & weight" shows 800 / 1 kg, 1000 / 2 kg / ₹199, "3:299", 3 kg. In Admin → Products, give product A a dead weight of 0.3 kg, product B 1.5 kg, product C 3.5 kg, and set product D to "Prepaid only".

- [ ] Product form: type 0.4 kg and box 30 × 20 × 20 cm → "Chargeable weight: 2.4 kg (by box size)". Save → it stays.
- [ ] Cart with 1 × A (under ₹800) → checkout shows COD, partial COD (normal advance) and pay online. No yellow note.
- [ ] Cart total ₹800–1,000 (or 1 × B) → COD greyed out with its reason, partial COD asks ₹199 now, yellow note "… Pay online & save ₹X".
- [ ] Cart total over ₹1,000 (or weight 2–3 kg) → partial COD asks ₹299 now. Untick "also allow partial COD" in admin → only pay online.
- [ ] Add C (over 3 kg) → only pay online; note says "Your order weighs … Orders over 3 kg can only be paid online."
- [ ] Cart with D only → only pay online; note names the product. D's product page has no "Cash on delivery available" line; its pincode check says online only.
- [ ] Existing rules still win: mark a pincode "COD blocked" → even a small cart loses full COD for that pincode.
- [ ] Untick "Use these rules" → checkout behaves exactly as before this phase.

## Moving from Shopdeck to Hostinger

- [ ] **Shopdeck links:** with `.env` pointing at your live Turso DB, run `node scripts/remove-shopdeck-links.js` (read-only report). If it finds any, take a Turso backup, then run it with `--fix` (downloads those images to your server). Run the report again → "0 Shopdeck link(s) found".
- [ ] **Redirects:** `node scripts/shopdeck-redirects.js` → open `data/redirects/shopdeck-redirects.csv`, correct any wrong `new_path`, then `node scripts/shopdeck-redirects.js --import`.
- [ ] Hostinger: Node.js app, India data centre. Turso database region **Mumbai (aws-ap-south-1)**.
- [ ] `.env` on Hostinger: `UPLOAD_DIR` = a folder outside the app folder; `TRUST_PROXY=1` (2 if Hostinger CDN is on); `SITE_URL=https://mythosbyss.com`.
- [ ] Copy the photos in `public/images/products/` (and their `.webp` copies) with the app — they are your live product photos.
- [ ] After DNS switch: Google Search Console → add `https://mythosbyss.com` → submit `/sitemap.xml`. Use "URL inspection" on 2–3 old Shopdeck URLs to confirm the 301.
- [ ] Share a product link on WhatsApp → preview shows photo, name and price.

## Before going live

- [ ] Razorpay: live keys in production only; set `RAZORPAY_WEBHOOK_SECRET` and the webhook in the Razorpay dashboard.
- [ ] WhatsApp Cloud API keys (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`) + approved OTP template — **without them nobody can log in in production**.
- [ ] `NODE_ENV=production`, a long `SESSION_SECRET`, `SITE_URL` = your https domain.
- [ ] Meta: `META_PIXEL_ID`, `META_CAPI_TOKEN` set; `META_TEST_EVENT_CODE` removed.
- [ ] Announcement bar text (Admin → Settings → Store & charges) matches your real shipping offer.
- [ ] Policy pages reviewed; product costs entered; COD rules and confirmation message set.
- [ ] GitHub repo is private (the old database file is in git history).
