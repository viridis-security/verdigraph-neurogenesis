# The Verdigraph Agent Economy

Verdigraph isn't just a framework. It is the substrate for a working agent
economy: the Viridis Operator agent runs the Verdigraph project itself, sells
its services (including to other AI agents), and routes a committed 25% of
net revenue to verified conservation programs.

The agent operates Verdigraph using Verdigraph. It pays for its own
existence through the services it provides. The framework's central claim
— *maximize successful task completion per unit compute* — is tested on
the project that maintains it.

## What you can buy from the operator

| Product | Price | Format |
|---|---|---|
| **Compute Routing — Pay-per-Call** | $0.10 / call (50-call pack $5) | One-time / credit pack |
| **Hosted MCP — Starter** | $99 / month | Subscription |
| **Hosted MCP — Team** | $999 / month | Subscription |
| **Verified Compute-Efficiency Report — Standard** | $5,000 | One-time |
| **Verified Compute-Efficiency Report — Enterprise** | $25,000 | One-time |
| **Verdigraph Conservation Kit** | $5,000 | One-time |
| **Operator Certification — Initial** | $5,000 | One-time |
| **Operator Certification — Annual Renewal** | $2,000 / year | Recurring |

All transactions clear through Stripe under **Viridis LLC** (acct
`ViridisNorth`). 25% of net revenue is committed to verified Viridis
conservation programs, reported on the public ledger.

## What "agent-to-agent" means

The Verdigraph MCP server exposes `verdigraph_choose_compute_profile` and
related tools. Other AI agents — coding agents, research agents, customer-
service agents — can call these tools to:

1. Decide which model to route their next task to (cheapest reliable path
   that meets `min_quality`).
2. Cache and reuse successful reasoning workflows.
3. Decide whether to escalate to a stronger model or use a cache.
4. Audit the decisions in an append-only developmental ledger.

When an external agent uses these routing services, the call is metered
against a credit balance (paid in 50-call packs at $5, equivalent to $0.10
per call). The buying agent gets:

- A measurable savings number versus their baseline.
- A ledger entry their compliance team can audit.
- A small contribution to verified conservation work, on every call.

This is the smallest unit of the agent economy. Five cents goes a long way
when ten thousand calls happen in a day.

## Why a fixed 25% to conservation, every time

Two reasons.

First, **mission alignment is the brand differentiator.** Any AI tooling
vendor can claim to care about climate. A vendor that publishes the
percentage, ledgers each routing decision, and reports the conservation
distribution quarterly is making a verifiable claim. We are betting that
verifiability is what wins the procurement cycle in 2027.

Second, **the math works at scale.** A million routing calls per day at
$0.10 per call is $100k/day in gross revenue. Twenty-five thousand of that
funds verified conservation. The remaining seventy-five thousand funds the
software, the research, and the hardware path toward physical
neuromorphic substrates. Both halves get bigger as the framework spreads.

## How the operator gets paid (the boring middle)

The Viridis Operator agent uses three Stripe-MCP capabilities:

- **`create_customer`** — when a new buyer arrives via a payment link, the
  operator records the customer in Stripe and tags the metadata with the
  product they purchased.
- **`create_invoice` + `create_invoice_item` + `finalize_invoice`** — for
  larger engagements (Reports, Kits, Certification), the operator drafts
  invoices in Stripe in response to scoped conversations and sends them
  for human approval before finalization.
- **`list_payment_intents` + `list_invoices`** — the operator reconciles
  daily, identifies which product each payment is for, and calculates the
  conservation share.

The operator **does not** initiate payouts, transfers, refunds above
$5,000, or any movement of funds out of the Stripe balance. All money
movement is human-gated, per the `no_agent_initiated_money_movement`
safety axiom in the operator's genome.

## How the operator gets work done (the operator runs itself)

Four scheduled tasks drive the operator's day:

| Schedule | What it does |
|---|---|
| **Hourly :15** | Triage new GitHub issues — labels, classify, brief reply |
| **Every 6 hours :30** | Review open pull requests against the safety invariants |
| **Daily 7 AM** | Pull repo + Stripe metrics, reconcile, identify anomalies |
| **Weekly Monday 9 AM** | Compose digest, propose conservation distribution, file public digest issue |

Each task is a fresh Claude session with no memory of prior runs. The
operator state lives in the verdigraph-mcp server's registry; the agent's
developmental ledger captures everything across runs.

The full task prompts are stored in `~/Documents/Claude/Scheduled/` on the
operator host machine and are reproducible from
`docs/internal/OPERATOR_SCHEDULES.md` if you want to run your own
Viridis-style operator.

## Running your own operator

The genome in `examples/viridis_operator.genome.json` is MIT-licensed and
ships as a public reference implementation. You can clone it and operate
your own Verdigraph project (or any other GitHub project) under the same
substrate.

To run your own operator economy:

1. Set up the verdigraph-mcp server (`pip install -e ".[mcp]"`).
2. Install the github-mcp server and connect with a PAT scoped to your
   repo.
3. Install the stripe-mcp server (Stripe Agent Toolkit) and connect to
   your Stripe account.
4. Clone or customize `examples/viridis_operator.genome.json`. Change
   the Stripe product/price IDs in `metadata.stripe_catalog` to your own.
5. Set the schedules from `docs/OPERATOR_AGENT.md` Appendix.

What you DON'T get from the open-source kit: the Verified Compute-
Efficiency Report methodology audit, the Operator Certification badge,
or attribution under the Verdigraph trademark. Those are what Viridis
sells.

## See also

- [Operator agent design](OPERATOR_AGENT.md) — full architecture
- [Invariants](INVARIANTS.md) — the safety contract this all rests on
- [Compute is Carbon (essay)](essays/COMPUTE_IS_CARBON.md) — why this matters
- [MCP server reference](MCP_SERVER.md) — the substrate this runs on

---

*Last reviewed: 2026-05-17. Updated whenever the Stripe catalog, schedule
set, or conservation share changes.*
