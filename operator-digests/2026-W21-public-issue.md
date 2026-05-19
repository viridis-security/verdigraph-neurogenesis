# Weekly Operator Digest — 2026-W21

**Period:** 2026-05-11 through 2026-05-18 (UTC)
**Run by:** Viridis Operator (scheduled task `verdigraph-weekly-digest-and-conservation`)
**Repo:** viridis-security/verdigraph-neurogenesis

---

## 1. Repository activity (trailing 7 days)

This was the **inception week** of the public repo. The first commit landed on 2026-05-17.

| Metric | Value |
|---|---|
| Commits | 15 |
| Contributors | 1 |
| Files touched (cumulative) | 165 |
| Lines added / removed | +15,874 / -318 |
| Issues opened / closed | (pending — operator-digest tooling will populate next week) |
| PRs merged | (pending — operator-digest tooling will populate next week) |
| New contributors | 0 |

**Most-touched files (top 5):**

1. `README.md`
2. `CHANGELOG.md`
3. `examples/compute_cost_calculator.html`
4. `docs/essays/COMPUTE_IS_CARBON.md`
5. `pyproject.toml` / `hosted-mcp/src/mcp/agent.ts` (tied)

**Notable themes this week:** OAuth 2.1 + PKCE on the hosted MCP, Stripe Checkout prepaid-credits billing layer, atomic credit debit with 402-on-zero-balance, monthly conservation cron, repository rename AxiomGraph → Verdigraph, and the Viridis Operator v0.2 agent genome.

---

## 2. Revenue (trailing 7 days)

The hosted MCP went live this week. Revenue collected is in the **$0-$50** range while the Stripe webhook secret is being installed.

| Metric | Value |
|---|---|
| Gross revenue collected | $0-$50 (effectively $0 — webhook secret installation pending) |
| Revenue by product | n/a (no closed Checkout sessions in window) |
| New customers added | 3 anonymous OAuth-onboarded callers (1 paired to a live Stripe customer) |
| Active paying subscriptions | 0 |
| Refunds / disputes | 0 / 0 |

---

## 3. Conservation distribution — this week

**Conservation fund accumulated this week: $0.00 USD**

(Gross revenue this week × 0.25 = $0.00. The 25%-of-net-revenue conservation commitment is live and binding from the first paying call; this week the billing layer was deployed but not yet revenue-active.)

The conservation recipient account is **not yet configured**. Once a Stripe Connect partner is onboarded for a verified-impact program, conservation transfers will run on the first day of each month via the deployed Cloudflare cron.

---

## 4. Operator agent self-report

| Metric | Value |
|---|---|
| Tasks processed by the agent | 2 metered tool calls (1 success, 1 returned `INSUFFICIENT_CREDITS`) |
| Tools used | `verdigraph_choose_compute_profile` only |
| Specialist nodes grown this week | 0 (genome at initial 17 nodes / 16 edges) |
| Edges strengthened / pruned | 0 / 0 |
| Estimated compute cost saved vs. always-frontier baseline | n/a — no model-routed traffic yet |

---

## 5. Compute-to-Carbon — this week

| Metric | Value |
|---|---|
| Tokens routed through Verdigraph for billing customers | 0 |
| kWh avoided vs. always-frontier baseline | 0 kWh |
| CO2e avoided | 0 kg (EPA factor 0.367 kg/kWh) |

---

## Next week's focus

1. Install Stripe webhook signing secret so the first real top-ups land.
2. Wire `CONSERVATION_RECIPIENT` so the monthly cron can transfer 25% of net revenue automatically.
3. Begin routing real billing traffic so the compute-to-carbon figures become non-trivial.

---

*This digest is auto-generated. Exact revenue figures, individual customer details, and internal Stripe IDs are intentionally redacted; the conservation amount is stated exactly as a public commitment.*
