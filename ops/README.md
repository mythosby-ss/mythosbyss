# Mythos by SS — Ops workspace (shared by all 6 agents)

This folder is how the four agents talk to each other. Every agent reads from
`data/`, writes its own report to `reports/`, and leaves notes for the other
agents in `handoffs/`. Nothing here is sent anywhere unless a step says so.

## The six agents
| Agent | File | Owns |
|---|---|---|
| Marketing | `.claude/agents/marketing-expert.md` | Meta ads: spend, CPA, creatives, audiences, budgets |
| Strategy | `.claude/agents/strategy-expert.md` | Which products/combos win or lose, growth decisions |
| Ops & Finance | `.claude/agents/ops-finance-expert.md` | Every rupee in and out: sales, shipping, COD fees, RTO, wallet, GST, settlements |
| RTO Desk | `.claude/agents/rto-desk.md` | Failed delivery attempts → ticket → daily follow-up until delivered or waiver |
| Order Confirmation | `.claude/agents/order-confirmation.md` | New orders: address check (suggest only, never change), confirmation message, risk flags |
| Reviews & Retention | `.claude/agents/reviews-retention.md` | Delivered orders: review request in the customer's own language, repeat-purchase follow-ups |

The website itself (not the agents) sends two emails to the owner: an instant "new order" email and the 10 pm daily report. See SETUP.md.

## How they link
```
RTO Desk ──(losses, waivers, bad pincodes/couriers)──▶ Ops & Finance
RTO Desk ──(pincodes / ad audiences that RTO a lot)──▶ Marketing
Marketing ─(spend + cost per DELIVERED order by product)─▶ Strategy
Ops & Finance ─(true profit per product, cash position)─▶ Strategy
Strategy ──(decisions: scale / pause / reprice / bundle)──▶ Marketing + Ops & Finance
Order Confirmation ─(fake-looking orders, wrong pincodes)─▶ RTO Desk + Strategy
Reviews & Retention ─(complaints, ratings by product)─▶ Strategy + Ops & Finance
```
Run all six in order with `/daily-review`. Run only the RTO follow-ups with `/rto-followup`.

## data/ — files you (or the website) drop in daily
Use these exact names. CSV, first row = headers. Missing file = agent says so and skips that part.

| File | Source | Required columns |
|---|---|---|
| `orders.csv` | Website admin export | order_id, date, product_ids, product_names, qty, order_value, payment_type (prepaid/partial_cod/cod), advance_paid, status (pending_confirmation/confirmed/shipped/delivered/rto/returned/cancelled), delivered_date, customer_name, customer_phone, address_line1, address_line2, landmark, city, state, pincode, preferred_language, courier, awb, chargeable_weight_kg, utm_source, utm_campaign, utm_content |
| `products.csv` | Website admin export | product_id, name, cost_price, packaging_cost, selling_price, chargeable_weight_kg, is_bundle |
| `shipments.csv` | Shipway export | awb, order_id, courier, status, last_status_date, attempts, ndr_reason, forward_charge, rto_charge, cod_charge, reverse_pickup_charge, weight_charged_kg |
| `remittance.csv` | Shipway COD remittance + wallet ledger | date, type (cod_remit/wallet_recharge/wallet_debit/refund/weight_dispute), awb, amount, reference |
| `meta_ads.csv` | Ads Manager export (ad level, daily) | date, campaign, ad_set, ad, product (from ad name), spend, impressions, clicks, ctr, add_to_cart, initiate_checkout, purchases, cost_per_purchase |
| `payments.csv` | Payment gateway settlements | date, order_id, amount, gateway_fee, settled_amount |
| `settings.csv` | You, once | key, value — e.g. gst_rate 0.18, target_margin_of_cost 0.8, max_rto_pct 0.25, daily_ad_budget 500, logistics_escalation_email, logistics_kam_name |

### How the website fills these files
- `npm run ops:export` (or Admin → Settings → Ops & owner emails → Export ops data) writes `orders.csv`, `products.csv`, `payments.csv` and `shipments.csv`. Last 180 days by default (`-- --days 30`).
- Orders with several products: `product_ids`, `product_names` and `qty` list the items in the same order, separated by `|` (e.g. `tawa|kadai`, `2|1`). `chargeable_weight_kg` is the order total.
- `status` uses the list above; NDR / out-for-delivery orders show as `shipped` (attempts and NDR reason are in shipments.csv). Unpaid online attempts are left out.
- Orders placed before the split address fields: line 1/line 2/landmark are split from the saved address text.
- `products.csv` has one row per product, priced at its lowest variant (the "from" price). `chargeable_weight_kg` uses the default weight when none is saved.
- `payments.csv`: `gateway_fee` is an ESTIMATE (pg_fee_percent in admin); `settled_amount` is empty until Razorpay settlements are connected.
- `shipments.csv`: built from the order records (courier, AWB, NDR count/reason, charges entered on the order) until `npm run ops:shipway` is connected. `weight_charged_kg` is empty until then.
- `remittance.csv` and `meta_ads.csv`: export from the Shipway dashboard / Ads Manager and save here.
- `npm run ops:pincode <pincode>`: post offices, district and state (sends only the pincode).
- `npm run ops:escalate <awb>`: sends the ticket's "## Escalation draft" by email (only when allow_auto_send = yes).

## reports/
`reports/YYYY-MM-DD/marketing.md`, `strategy.md`, `finance.md`, `rto.md`, plus `summary.md` from `/daily-review`.

## handoffs/
One file per receiving agent: `to-marketing.md`, `to-strategy.md`, `to-finance.md`, `to-rto.md`, `to-confirmation.md`, `to-reviews.md`.
Append entries as: `- [YYYY-MM-DD] FROM <agent>: <fact or request> (evidence: file/row)`.
Each agent reads its own handoff file first, acts on open items, and marks them `DONE <date>` or `OPEN <reason>`.

## confirmations/ and reviews/
`confirmations/<order_id>.md` (original vs suggested address, Sahil's decision) and `reviews/<order_id>.md` (language, draft, translation, status).

## tickets/rto/
One file per AWB: `<awb>.md`. See the RTO Desk agent for the template.
`tickets/rto/_index.csv` lists every ticket: awb, order_id, opened, status, last_followup, outcome, amount_at_stake.

## Ground rules for every agent
- Numbers come from the files, never from memory. Show the calculation for any money figure.
- "Purchases" in Meta are orders placed, not delivered. Always convert to cost per DELIVERED order.
- Profit target: profit per delivered order ≥ target_margin_of_cost × product cost (settings.csv).
- Never send a message, email, or API call that spends money or contacts a customer or vendor unless the step explicitly allows it AND the owner has turned that on in settings.csv (`allow_auto_send = yes`). Otherwise write a ready-to-send draft.
- Never put API keys or tokens in these files. They live in `.env` only.
- Customer phone numbers stay inside this project and the logistics ticket; never paste them anywhere else.
