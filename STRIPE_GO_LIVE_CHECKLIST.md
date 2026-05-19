# Stripe Go-Live Checklist — First Real Top-Up

**Target:** First successful `checkout.session.completed` → first non-zero row in `credit_balances` → first metered tool call billed against real money.
**Worker:** `https://verdigraph-mcp.hartjustin6.workers.dev`
**D1:** `verdigraph-ledger` (uuid `9b81887e-6e85-4797-b977-87f151a56f75`)
**Stripe account:** `acct_1BLyFZDTpwaqE8Ss` "ViridisNorth" (livemode=true)

Run this in order. Step 3 depends on step 2; step 5 depends on step 4.

---

## 1. Rotate the leaked Stripe restricted key

The current `rk_live_*j4l4` appeared twice in terminal scrollback this session. Even if no one external saw it, rotate.

1. Stripe Dashboard → **Developers → API keys → Restricted keys**.
2. Click the existing `j4l4` key → **Roll key**. Confirm. (Stripe gives a 24h grace window — fine.)
3. Capture the new key on screen. Do NOT paste it into terminal interactively (zsh bracketed-paste escapes `_` → `\_` on this Mac).
4. Install via base64-pipe:
   ```bash
   cd ~/Desktop/Cowork\ /axiomgraph_neurogenesis/hosted-mcp
   echo 'BASE64_OF_NEW_RK_LIVE_KEY' | base64 -d | npx wrangler secret put STRIPE_SECRET_KEY
   ```
5. Wait ~30s for deploy. Smoke test by calling `verdigraph_get_balance` for a known caller — should return 200, not 503.
6. Stripe Dashboard → roll the old key off (deactivate).

**Required scopes on the new key:** Customers Write, Checkout Sessions Write, Meter Events Write, Transfers Write.

---

## 2. Subscribe the webhook endpoint to `checkout.session.completed`

This is the actual blocker for revenue. Today's D1 shows 9 `customer.created` events processed cleanly, so the endpoint exists and the signing secret IS set. But ZERO `checkout.session.completed` rows — either no one has completed a Checkout session, OR the endpoint isn't subscribed to that event.

1. Stripe Dashboard → **Developers → Webhooks → Endpoints** → find `https://verdigraph-mcp.hartjustin6.workers.dev/stripe/webhook`.
2. **Listening for** → confirm subscribed events include ALL of:
   - `checkout.session.completed` ← REQUIRED for revenue
   - `customer.created` ← already wired
   - `invoice.paid` ← reserved
   - `invoice.payment_failed` ← reserved
3. If `checkout.session.completed` is missing → **Update details → Select events → add it → Update endpoint**.
4. From the endpoint page, click **Send test webhook** → pick `checkout.session.completed` → Send. Then query D1:
   ```sql
   SELECT event_id, event_type, processed_at, error
   FROM stripe_events
   WHERE event_type = 'checkout.session.completed'
   ORDER BY received_at DESC LIMIT 5;
   ```
   You should see one row with `processed_at` populated. `error` may be NULL or a controlled error like "missing caller_id in metadata" (test events lack your metadata — expected).

---

## 3. Confirm the webhook signing secret

Empirically set — but verify directly.

1. Stripe Dashboard → endpoint page → **Signing secret → Reveal**. Copy the `whsec_*` value.
2. Compare to deployed:
   ```bash
   cd ~/Desktop/Cowork\ /axiomgraph_neurogenesis/hosted-mcp
   npx wrangler secret list | grep STRIPE_WEBHOOK_SECRET
   ```
   If absent or doubtful:
   ```bash
   printf '%s' 'whsec_REAL_VALUE_HERE' | npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
   (`printf '%s'` avoids the trailing newline that breaks signature verification.)
3. Re-send the test `checkout.session.completed` from step 2.4 to confirm.

---

## 4. Wire `CONSERVATION_RECIPIENT` (25% conservation split)

The conservation commitment is binding from the first paying call. Until `CONSERVATION_RECIPIENT` is set, the monthly cron logs pending payouts and skips the transfer — defensible but technically a debt.

1. Stripe Dashboard → **Connect → Get started** if not already on Connect. Choose **Platform** model.
2. Onboard the Viridis-verified conservation partner as a Connected Account:
   - Recommended: **Standard account** (partner has full Stripe dashboard access; simpler legal posture for a conservation NGO).
   - Send onboarding link; they complete KYC.
3. Once active, copy the `acct_*` from Connect → Accounts.
4. Install on the Worker:
   ```bash
   printf '%s' 'acct_PARTNER_ID' | npx wrangler secret put CONSERVATION_RECIPIENT
   ```
5. Smoke test the monthly cron logic. For an ad-hoc dry-run check:
   ```sql
   SELECT * FROM conservation_payouts ORDER BY created_at DESC LIMIT 5;
   ```
   After the first revenue-bearing month, a row should appear with `conservation_share_usd_micros = floor(net_revenue_usd_micros / 4)`.

**Acceptable interim:** if onboarding takes weeks, publish a `/billing/conservation` page on `verdigraph.ai` stating the conservation share accrues against `conservation_payouts.pending` and will transfer when the Connect partner finishes KYC. Keeps the commitment auditable in public.

---

## 5. End-to-end live verification — $5 test top-up

1. Get an OAuth bearer for a test caller (use your own dev caller — one of the 3 in the `callers` table).
2. Call `verdigraph_create_topup_session` with `amount_usd: 5`. Capture the returned `checkout_url`.
3. Open in browser, pay with a real card (NOT a test card — livemode). $5 is small enough to refund.
4. Within ~10s of paying, query:
   ```sql
   -- (a) Stripe webhook landed
   SELECT event_type, processed_at, error FROM stripe_events
   WHERE event_type='checkout.session.completed'
   ORDER BY received_at DESC LIMIT 1;

   -- (b) credit balance written
   SELECT caller_id, balance_usd_micros/1000000.0 AS usd
   FROM credit_balances WHERE caller_id = 'YOUR_CALLER_ID';
   ```
   Stripe Dashboard → Payments should show one new $5 payment.
5. Burn the credit by calling `verdigraph_choose_compute_profile`. Verify a `usage_ledger` row with `success=1` and `credit_balances.balance_usd_micros` decremented.
6. (Optional) Refund the $5 to keep the books clean.

If all rows above land correctly, **the money path is fully live** — start telling the first paying caller to top up for real.

---

## Post-launch hygiene

- Add a Cloudflare Worker Analytics Engine binding to log `usage_ledger` rows in near-real-time without D1 round-trips.
- Set up a daily scheduled task that queries `stripe_events WHERE processed_at IS NULL AND received_at < unixepoch()*1000 - 3600000` and pages you on any stuck row.
- Once revenue starts: add a public conservation transparency endpoint at `verdigraph-mcp.hartjustin6.workers.dev/conservation/public` returning running totals from `conservation_payouts`.

---

*Generated 2026-05-18 by Cowork session — verified against live D1 schema, live `stripe_events`, and `hosted-mcp/src/billing/webhook.ts`.*
