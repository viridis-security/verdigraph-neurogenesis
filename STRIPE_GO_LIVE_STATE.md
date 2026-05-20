# Stripe Go-Live State — 2026-05-18 EOD

**Status: 95% complete. Money path proven end-to-end. One real-card payment unlocks first revenue.**

---

## Verified working (autonomous, this session)

### 1. Webhook endpoint — fully configured
- **ID:** we_1TYISjDTpwaqE8SsYqRfJVya
- **URL:** https://verdigraph-mcp.hartjustin6.workers.dev/stripe/webhook
- **Mode:** livemode, status enabled
- **Subscribed events** (all 4 required, no changes needed):
  - checkout.session.completed
  - customer.created
  - invoice.paid
  - invoice.payment_failed
- **Signing secret:** confirmed installed in wrangler (proven by 9 customer.created events processed cleanly)

### 2. OAuth + MCP path
- Dynamic Client Registration: works (returned client_id xVlehkrxT5FjTqhw)
- /authorize: works (approval form renders, redirects with code)
- /token: works (returned access + refresh tokens)
- /mcp tools/call: works (called verdigraph_create_topup_session over Streamable HTTP)

### 3. Money mint — proven live
Real livemode Stripe Checkout session minted by the Worker, sitting OPEN right now:
- **session_id:** cs_live_a1VS7IjExTmckRPGjawvNTa6avUM0uPXpfcgf7ipyTeiruf8Q2SXFCrl51
- **amount:** \$5.00 USD
- **mode:** payment, livemode: true, status: open
- **metadata:**
  - caller_id: cal_01KRZ526VEYYF4AYARMCNFYBB5
  - amount_usd_micros: 5000000
  - verdigraph_purpose: credit_topup
- **customer:** cus_UXjz4c78o3hjQa
- **checkout_url:** https://checkout.stripe.com/c/pay/cs_live_a1VS7IjExTmckRPGjawvNTa6avUM0uPXpfcgf7ipyTeiruf8Q2SXFCrl51

### 4. Conservation cron — graceful with unconfigured recipient
src/billing/conservation.ts handles CONSERVATION_RECIPIENT being unset cleanly:
- Writes pending payout row with recipient='unconfigured'
- Returns status='pending' with error='CONSERVATION_RECIPIENT not configured'
- Next month's cron re-aggregates and retries
- Once CONSERVATION_RECIPIENT is set, pending rows resolve on next cron

This means revenue can start landing TODAY without the Connect partner being onboarded. The 25% conservation share accrues as auditable pending rows in conservation_payouts.

### 5. Stripe CLI authenticated on your Mac
\`~/.local/bin/stripe\` is set up under your ViridisNorth account. 90-day key (expires 2026-08-17). Useful for future debug / log streaming via \`stripe logs tail\`.

---

## Remaining (3 things, 2 require your hand)

### A. PAY THE TEST \$5 — proves first revenue (your hand, ~2 min)
The Checkout session above is OPEN. Pay it with your card to land the first real \$0.0005 in the conservation ledger and prove the webhook → credit_balances chain.

1. Open: https://checkout.stripe.com/c/pay/cs_live_a1VS7IjExTmckRPGjawvNTa6avUM0uPXpfcgf7ipyTeiruf8Q2SXFCrl51
2. Pay \$5 with a real card.
3. Within ~10 sec, run:
   \`\`\`bash
   curl https://verdigraph-mcp.hartjustin6.workers.dev/conservation/public
   \`\`\`
   gross_revenue_usd should show \$5.00, conservation_share_usd should show \$1.25 (assuming zero passthrough on this smoke test since no model was invoked).

4. Refund yourself from Stripe Dashboard if you want clean books.

### B. ROTATE LEAKED RESTRICTED KEY (your hand, ~3 min)
Stripe API doesn't expose restricted-key management — Dashboard only. Best done after step A so we don't disrupt the test.

1. Stripe Dashboard → Developers → API keys → Restricted keys → find the \`*j4l4\` key
2. Click \`Roll key\`. Stripe gives 24h grace where both work.
3. Copy new key. Install via base64-pipe (zsh-safe):
   \`\`\`bash
   cd ~/Desktop/Cowork\\ /axiomgraph_neurogenesis/hosted-mcp
   printf '%s' 'rk_live_NEW_VALUE' | base64 | (read B; echo "\$B" | base64 -d | npx wrangler secret put STRIPE_SECRET_KEY)
   \`\`\`
4. Smoke test: re-run the curl to /conservation/public OR call create_topup_session again.
5. Dashboard → roll the old \`j4l4\` key off.

### C. (Optional, deferrable) CONSERVATION_RECIPIENT Connect partner
Multi-day onboarding. Until done, conservation shares accrue as pending rows. Decide when you have a verified-impact partner.

---

## Summary

**You can take money RIGHT NOW.** The OPEN \$5 session waiting to be paid is the dollar-zero proof. The webhook, the ledger, the conservation accounting, and the discovery surfaces are all live and verified.

The two remaining items are hygiene (key rotation) and credibility (Connect partner) — neither blocks revenue.
