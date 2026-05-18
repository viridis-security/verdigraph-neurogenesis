# verdigraph-mcp (hosted)

Public, OAuth-authenticated, billable MCP server for Verdigraph compute-routing
services. Other autonomous agents connect over MCP, call `verdigraph_*` tools,
and Verdigraph charges them via Stripe — passthrough model cost + flat routing
fee. 25% of net revenue auto-routes to verified Viridis conservation programs.

Deployed on Cloudflare Workers. Companion to the local-stdio `verdigraph_mcp/`
Python server, which remains the in-house operator runtime.

## Architecture

```
external agent ─┬─ OAuth 2.1 ──► /authorize, /token, /register
                │
                └─ MCP (HTTP) ──► /mcp ──► VerdigraphAgent (Durable Object, per-caller)
                                              │
                                              ├─ verdigraph_* tool handler
                                              ├─ meteredCall (idempotent on request_id)
                                              ├─ D1: usage_ledger (append-only)
                                              ├─ R2: per-caller agent-state snapshots
                                              └─ Stripe: meter event + monthly transfer

monthly cron ─► Workers Cron Trigger ─► aggregate prior-month ledger
                                     ├─ floor(net / 4) → conservation_payouts (pending)
                                     └─ Stripe transfers.create → CONSERVATION_RECIPIENT
```

State:
- **D1** `verdigraph-ledger` — callers, oauth_clients, usage_ledger, credit_balances, stripe_events, conservation_payouts.
- **R2** `verdigraph-state` — per-caller agent-state snapshots at `{caller_id}/{agent_id}.json`.
- **KV** `viridis-token-vault` — OAuth access/refresh tokens, dynamic client registrations.
- **Durable Object** `VerdigraphAgent` — one DO instance per `caller_id`. Holds the in-memory developmental agents; persists to R2 on `verdigraph_save_agent_state`.

## Layout

```
hosted-mcp/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── db/migrations/0001_init.sql      # applied to D1 (2026-05-18)
├── src/
│   ├── index.ts                     # Worker entry; OAuthProvider + scheduled() cron
│   ├── auth/handler.ts              # /authorize (consent + completeAuthorization), /token, /register, /healthz
│   ├── billing/
│   │   ├── ledger.ts                # priceCall, writeLedger, conservationShareUsdMicros
│   │   ├── stripe.ts                # Stripe client + ensureStripeCustomer + meter events
│   │   ├── webhook.ts               # POST /stripe/webhook (signature-verified)
│   │   └── conservation.ts          # Monthly Workers Cron Trigger (25% of net → Viridis)
│   ├── mcp/
│   │   ├── agent.ts                 # VerdigraphAgent McpAgent — 14 tools wired
│   │   └── metering.ts              # meteredCall(): idempotent ledger writes + meter event
│   └── verdigraph/                  # TS ports of verdigraph/*.py (parity-tested)
│       ├── genome.ts                # AgentGenome, GrowthRules, SafetyAxioms (Zod)
│       ├── graph.ts                 # CognitiveNode, CognitiveEdge, CognitiveGraph
│       ├── evaluation.ts            # EvaluationResult, isSuccess/isFailure
│       ├── growth.ts                # GrowthEngine.reinforceFromEvaluation / maybeGrow
│       ├── pruning.ts               # PruningEngine.weakenFromEvaluation / prune
│       ├── routing.ts               # Router.bestNextSteps
│       ├── dev_ledger.ts            # DevelopmentalLedger (NOT billing — DO state)
│       ├── compute.ts               # chooseProfile, shouldUseCache, shouldEscalate
│       ├── agent.ts                 # DevelopmentalAgent (full TS port)
│       └── registry.ts              # CallerRegistry — per-DO, R2-backed
└── tests/
    ├── compute.test.ts              # quality floor, cheapest feasible, cache/escalate
    ├── pricing.test.ts              # routing fee math + 25% floor-division
    ├── agent.test.ts                # graph invariants, growth/pruning, round-trip
    └── parity.test.ts               # cross-checks TS port vs Python reference
```

## Tools

All tools require OAuth bearer auth (`/mcp` route). Every call accepts a
`request_id` idempotency key; replay returns the original ledger row without
re-billing.

| Tool | Purpose | Billable? |
|------|---------|-----------|
| `verdigraph_choose_compute_profile` | Pick cheapest profile that meets quality floor + capability + context constraints. | yes |
| `verdigraph_list_profiles` | Convenience: return the default profile catalog. | yes |
| `verdigraph_create_agent` | Register a new developmental agent from a genome dict. | yes |
| `verdigraph_list_agents` | List the caller's active agents (per-caller isolated). | yes |
| `verdigraph_get_graph_summary` | Nodes + edges + weights for one agent. | yes |
| `verdigraph_get_agent_state` | Full state dict (genome + graph + ledger). | yes |
| `verdigraph_submit_evaluation` | Apply a task evaluation → triggers growth/pruning. | yes |
| `verdigraph_best_next_steps` | Top-k routes from a node, ranked by edge-score. | yes |
| `verdigraph_get_ledger` | Recent developmental-ledger events (NOT billing). | yes |
| `verdigraph_save_agent_state` | Snapshot DO state → R2. | yes |
| `verdigraph_load_agent_state` | Hydrate DO from R2 snapshot. | yes |
| `verdigraph_delete_agent` | Soft-delete (tombstone); never hard-deletes. | yes |
| `verdigraph_should_use_cache` | Pure compute cache policy. | yes |
| `verdigraph_should_escalate` | Pure compute escalation policy. | yes |

## Deploy

```bash
cd hosted-mcp
npm install
npx wrangler login                                          # one-time
npx wrangler secret put STRIPE_SECRET_KEY                   # rk_test_... then rk_live_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CONSERVATION_RECIPIENT              # Stripe Connect account id
npx wrangler deploy
```

Verify:
```bash
curl -fsS https://verdigraph-mcp.<account>.workers.dev/healthz | jq .
curl -fsS https://verdigraph-mcp.<account>.workers.dev/.well-known/oauth-authorization-server | jq .
```

After deploy:
- `https://verdigraph-mcp.<account>.workers.dev/mcp` — MCP (OAuth-protected)
- `https://verdigraph-mcp.<account>.workers.dev/.well-known/oauth-authorization-server`
- `https://verdigraph-mcp.<account>.workers.dev/healthz`
- `https://verdigraph-mcp.<account>.workers.dev/stripe/webhook` — Stripe-Signature verified

Custom domain (recommended once stable): `mcp.verdigraph.ai` via Workers Routes.

## Invariants (verified by tests/)

1. Money is **integer micro-USD**. No floats touch the ledger.
2. `(caller_id, request_id)` is **idempotent**. Replay returns the original row, no double-charge, no side effects.
3. Routing fee charged **only on success**. Failures meter `total_charged = 0` but still write a row with `success = 0` and `error_code`.
4. Conservation share = `floor(net_revenue / 4)`. **Never** rounds — D1 CHECK constraint enforces.
5. Quality floor = `max(min_quality, risk * 0.8)`. `chooseProfile` never returns a profile below this.
6. **All tool I/O validated by Zod** at the boundary. Field-for-field parity with Python pydantic schemas in `verdigraph_mcp/server.py`.
7. **Per-caller isolation**. Per-DO in-memory store + per-caller R2 prefix. No tool can leak another caller's data.
8. **Append-only ledger**. No UPDATE/DELETE on `usage_ledger` except the dedicated `stripe_usage_event_id` annotation.
9. **No secrets in code or wrangler.toml**. All via `wrangler secret put`.

## Roadmap

- [x] D1 schema + migration applied
- [x] Worker scaffold + vertical-slice tool
- [x] Wire `OAuthProvider.completeAuthorization()` in `/authorize`
- [x] Port all 12 remaining `verdigraph_*` tools (create_agent, submit_evaluation, save/load state, list_agents, get_graph_summary, get_agent_state, best_next_steps, get_ledger, delete_agent, should_use_cache, should_escalate, list_profiles)
- [x] R2 bucket `verdigraph-state` for per-caller genome/state snapshots
- [x] Stripe meter event on every successful billable call
- [x] Stripe `/stripe/webhook` (signature-verified)
- [x] Monthly conservation Workers Cron Trigger — 25% of net → Stripe transfer
- [x] Vitest unit tests for compute, billing, agent, graph
- [x] Parity tests vs Python reference (compute, cache/escalate, developmental step)
- [ ] Sign-in-with-GitHub OIDC for caller identity (replaces anon subjects in `/authorize`)
- [ ] Public conservation ledger viewer at `https://verdigraph.ai/conservation`
- [ ] Caller-facing usage dashboard (read-only Worker route, OAuth-gated)
- [ ] Anthropic Haiku/Sonnet passthrough execution for compute_optimizer-chosen profiles
