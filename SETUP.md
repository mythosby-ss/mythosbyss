# Setup — Mythos by SS agents

6 agents (Marketing, Strategy, Ops & Finance, RTO Desk, Order Confirmation, Reviews & Retention)
+ 2 automatic emails built into the website (instant new-order email, 10 pm daily report).

Put Mythos-Agents.zip in the website project root, open Claude Code in VS Code and paste the
prompt below. Afterwards, fill `ops/data/settings.csv` (owner_email, Shipway escalation email,
KAM name, COD remittance days, review_link) and keep `allow_auto_send,no` for the first 1–2 weeks.

Daily routine: `npm run ops:export` → `npm run ops:shipway` → drop Meta Ads CSV into ops/data/ → `/daily-review`.
The two emails run on their own from the website server.

## Prompt for Claude Code
```
I've placed Mythos-Agents.zip in the project root. It contains 6 Claude Code sub-agents
(marketing-expert, strategy-expert, ops-finance-expert, rto-desk, order-confirmation,
reviews-retention), 2 slash commands (/daily-review, /rto-followup), an ops/ workspace and
SETUP.md. Install it and build the website pieces it needs. Work step by step and ask me
before anything that changes existing website behaviour.

STEP 1 – Install (no code changes)
- Unzip into the project root. If .claude/ already exists, MERGE: never delete or overwrite
  my files; tell me about name clashes.
- Read SETUP.md, ops/README.md and every file in .claude/agents and .claude/commands.
- Add to .gitignore:
    ops/data/*.csv
    !ops/data/settings.csv
    ops/tickets/
    ops/reports/
    ops/confirmations/
    ops/reviews/
- Confirm all 6 agents and 2 commands are detected, then delete the zip.

STEP 2 – Read-only audit
Report where orders, products, payments, shipping status, COD/partial COD, pincode blocklist,
admin, and any email sending live; which columns of the ops/README.md data files we can fill
and which are missing. No code changes. Wait for my "go".

STEP 3 – Data pipeline (after my "go")
1. `npm run ops:export` + admin "Export ops data" button → ops/data/orders.csv, products.csv,
   payments.csv with the EXACT columns in ops/README.md. Add any missing product fields
   (cost_price, packaging_cost, chargeable_weight_kg) and order fields (delivered_date,
   landmark, preferred_language, utm_source/utm_campaign/utm_content captured from the
   landing URL). Add an optional "Preferred language" dropdown at checkout (English, Hindi,
   Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Punjabi, Odia) — not required.
2. `npm run ops:shipway` using Shipway credentials from .env (empty placeholders in
   .env.example) → ops/data/shipments.csv and remittance.csv (status, attempts, NDR reason,
   forward/RTO/COD/reverse-pickup charges, charged weight, COD remittance, wallet ledger).
   If you need Shipway API docs or keys, stop and ask me. Never guess endpoints or hardcode keys.
3. `sendLogisticsEscalation(awb)`: sends the escalation from ops/tickets/rto/<awb>.md via
   Shipway NDR API or SMTP. Refuse unless settings.csv has allow_auto_send=yes. Log every send
   in the ticket.
4. Address helper for the order-confirmation agent: a script `npm run ops:pincode <pincode>`
   that returns post offices, district and state for a pincode (public India Post pincode
   data; cache results locally). It must only send the pincode, never names or phones.
   Never edit the customer's address in the database.

STEP 4 – Owner emails (server side, SMTP creds in .env, recipient = owner_email in
settings.csv or OWNER_EMAIL in .env)
A. Instant new-order email, sent when an order is placed (after payment success for prepaid /
   advance, at placement for COD). Must never block or slow checkout: send in the background,
   retry up to 3 times, log failures.
   Subject: "New order #<id> – <product> – ₹<total>"
   Body: "You have received the order <product names × qty> of ₹<total>."
   Then: payment type (prepaid / partial COD with advance / COD), city + pincode, admin link.
   No full customer phone or address in the email.
B. Daily report at 22:00 Asia/Kolkata (cron / scheduled job that survives restarts; tell me
   how it runs on my hosting). Subject: "Mythos daily report – <date>". Include:
   - Today's orders: count and sales value, split prepaid / partial COD / COD
   - Delivered today: count and value
   - RTO today: count, plus RTO charges (forward + RTO + COD fee) = ₹ loss
   - Returns today: count, plus return charges (reverse pickup + refunds) = ₹ loss
   - Total RTO + return loss today, and month-to-date
   - Pending confirmation, in transit, open RTO tickets
   - Ad spend today if meta_ads.csv has today's row, otherwise "not available"
   Use real order and Shipway data; show "not available" instead of guessing.
C. An admin button "Send test email" for both emails. Let me test before turning them on.

STEP 5 – Test with dummy data
- Create ops/data/sample/ with ~30 fake orders (obviously fake names, phones like 90000 00001):
  prepaid / partial COD / COD; delivered / RTO / returned / NDR / pending confirmation;
  4 products; 2 couriers; several states (to test languages); 3 deliberately wrong pincodes.
  Add matching shipments, remittance, payments and a small meta_ads.csv.
- Point the agents at the sample folder, run /daily-review, and show me: summary.md, one
  address suggestion (original vs suggested), one review message in a regional language with
  its English translation, one RTO ticket, the finance ledger, and the handoff files.
- Send both test emails to me with the sample data.
- Fix anything broken, point back to ops/data/, and delete sample outputs.

STEP 6 – Finish
List every file created or changed, the daily routine, and which settings.csv / .env values
I still need to fill.
```
