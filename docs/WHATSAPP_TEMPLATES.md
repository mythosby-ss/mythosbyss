# WhatsApp templates to create (Meta WhatsApp Manager)

Create these in **WhatsApp Manager > Message templates**, language **English** (code `en`), using exactly these names
and the same variable order. Messages outside the 24-hour customer window can only be sent with approved templates.
Replace `YOURDOMAIN.com` with your live domain. Template text cannot contain newlines inside a variable value (the app strips them).

| # | Name | Category | Header | Body | Button |
|---|------|----------|--------|------|--------|
| 1 | `mbss_login_otp` | Authentication | - | `{{1}} is your verification code.` (tick "add security recommendation" and "expiry 5 minutes") | **Copy code** |
| 2 | `mbss_order_confirmation` | Utility | - | `Hi {{1}}, thank you for shopping with MythosBySS! Your order {{2}} is confirmed.` ` Items: {{3}}.` ` Quantity: {{4}}.` ` Order total: {{5}}.` ` Payment: {{6}}.` ` We will message you as soon as it ships.` (one paragraph; variables in this order) | - |
| 3 | `mbss_order_shipped` | Utility | - | `Hi {{1}}, good news! Your order {{2}} has shipped with {{3}}. Tracking number: {{4}}.` | URL "Track order": `https://YOURDOMAIN.com/order/{{1}}` |
| 4 | `mbss_out_for_delivery` | Utility | - | `Hi {{1}}, your order {{2}} is out for delivery today. {{3}}.` | - |
| 5 | `mbss_order_delivered` | Utility | - | `Hi {{1}}, your order {{2}} has been delivered. We hope you love it!` | - |
| 6 | `mbss_review_request` | Marketing (Meta may classify it so) | **Image** (sample: any product photo) | `Hi {{1}}, thank you for choosing MythosBySS! We hope you are enjoying your {{2}}. Would you take a minute to share a review? It helps other families a lot.` | URL "Write a review": `https://YOURDOMAIN.com/review/{{1}}` |

Notes
* Variables must be given sample values when you submit (e.g. `Priya`, `MBABC123`, `Crystal Casserole (2500 ml) x1`).
* The review message uses the product's image as the header. The image URL must be public; images served by this site (`/media/<driveId>` or `/images/...`) are, as long as `SITE_URL` is your public https domain.
* Marketing-category messages need customer opt-in (collected at login: "By continuing you agree to receive order updates on WhatsApp") and are billed per conversation by Meta. Check current pricing.
* In WhatsApp Manager > Webhooks, subscribe to `messages` and point the callback to `https://YOURDOMAIN.com/webhooks/whatsapp` with your `WHATSAPP_VERIFY_TOKEN`. Delivery/read/failed receipts then update Admin > Communication.
