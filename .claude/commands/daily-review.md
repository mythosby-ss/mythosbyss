---
description: Run all six Mythos by SS agents in order and produce today's summary
---

Run the daily review for Mythos by SS (6 agents). Today's date folder is `ops/reports/<today YYYY-MM-DD>/`.

1. Check `ops/data/`: list which files exist and their latest date. Warn about any file missing or older than 2 days.
2. Use the **order-confirmation** agent: check new orders' addresses (suggest only), draft confirmations, write `confirmation.md`.
3. Use the **rto-desk** agent: open new tickets, process follow-ups, write `rto.md` and handoffs.
4. Use the **ops-finance-expert** agent: build the ledger, reconcile, write `finance.md` and handoffs.
5. Use the **reviews-retention** agent: draft review requests in each customer's language, write `reviews.md`.
6. Use the **marketing-expert** agent: analyse ads on delivered orders, write `marketing.md` and handoffs.
7. Use the **strategy-expert** agent: combine everything, write `strategy.md` and assign decisions.
8. Write `summary.md` (one screen, phone-friendly):
   - Yesterday: orders, delivered, RTO, ad spend, net profit
   - Month to date: net profit, cash pending, wallet days left
   - **Address decisions**: orders where original and suggested address differ
   - **Send today**: messages/emails waiting for Sahil (confirmations, RTO, reviews, Finance disputes)
   - **Decide today**: budget changes, pauses, price/payment-rule changes, each with ₹ impact
   - **Needs Sahil (website)**: blocklist additions, feature requests
9. Show me `summary.md` at the end.
