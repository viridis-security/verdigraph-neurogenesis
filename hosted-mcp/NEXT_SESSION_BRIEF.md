# Verdigraph hosted-MCP — finishing brief

Drop this into a fresh Cowork session to finish the work. Self-contained — no prior
context required from the conversation that produced it.

---

## Mission

Finish the hosted, OAuth-authenticated, billable Verdigraph MCP server so external
autonomous agents can pay to call `verdigraph_*` compute-routing tools. Stripe
collects, 25% of net auto-routes to Viridis conservation programs, the rest is
revenue for the Verdigraph project. This is what closes the "Verdigraph operating
Verdigraph and paying for its own existence" loop in the operator genome.

Repository: `path/to/verdigraph-neurogenesis`
GitHub: `viridis-security/verdigraph-neurogenesis`
Work directory: `hosted-mcp/`
Python reference (do not modify): `verdigraph/`, `verdigraph_mcp/`

---

## What's already done — do NOT redo

Provisioned on Cloudflare account `2d4d38bfbafd29369d4436b9d8afb5c9`:

- **D1 `verdigraph-ledger`** (uuid `9b81887e-6e85-4797-b977-87f151a56f75`, WNAM).
  Schema migration v1 applied. Tables: `callers`, `oauth_clients`, `usage_ledger`
  (idempotent on `(caller_id, request_id)`), `credit_balances`, `stripe_events`,
  `conservation_payouts` (CHECK constraint enforces 25% floor-div),
  `schema_migrations`.
- **R2 bucket `verdigraph-state`** (ENAM). Bound as `STATE_BUCKET`.
- **KV `viridis-token-vault`** (id `f92ff2e0511d4cb28226eedc90fa4bcb`) bound as
  `OAUTH_KV`.
- **Durable Object class `VerdigraphAgent`** declared in `wrangler.toml`.

Worker scaffold under `hosted-mcp/`:

- `wrangler.toml` — bindings, secrets, vars (`ROUTING_FEE_USD_MICROS=2000`,
  `CONSERVATION_RATIO_NUM=1`, `CONSERVATION_RATIO_DEN=4`).
- `package.json`, `tsconfig.json`.
- `src/index.ts` — Worker entry; `OAuthProvider` wraps `VerdigraphAgent.serve("/mcp")`.
- `src/auth/handler.ts` — `/healthz`, `/.well-known/oauth-authorization-server`,
  `/authorize` (GET = consent UI; POST currently STUBBED — see Phase 1).
- `src/billing/ledger.ts` — `priceCall`, `writeLedger` (idempotent),
  `conservationShareUsdMicros`.
- `src/verdigraph/compute.ts` — TS port of `verdigraph/compute.py` (cheapest-feasible
  quality-floor optimizer; vertical slice).
- `src/mcp/agent.ts` — `VerdigraphAgent` McpAgent with TWO tools wired:
  `verdigraph_choose_compute_profile`, `verdigraph_list_profiles`.
- `tests/compute.test.ts`, `tests/pricing.test.ts` — vitest invariants.
- `db/migrations/0001_init.sql` — already applied to D1.

Agent state seed: `verdigraph_state/viridis-operator.json` (local stdio path).
Hosted version will produce its own state files in R2.

Seeded state and a separate local-stdio path exist for our own hourly triage —
do not break them.

---

## Spec invariance — must hold in everything you write

1. **Money is integer micro-USD.** `1 micro = $0.000001`. No floats touch the ledger.
2. **`(caller_id, request_id)` is idempotent** for every tool call. Replay returns
   the original row without re-billing.
3. **Routing fee is charged only on success.** Failures meter `total_charged = 0`
   but still write a ledger row (with `success = 0` and an `error_code`).
4. **Conservation share = `floor(net_revenue / 4)`.** Never round; the CHECK
   constraint will reject `round`. `net_revenue = gross - passthrough_model_cost`.
5. **Quality floor = `max(min_quality, risk * 0.8)`.** `chooseProfile` never returns
   a profile below this.
6. **All tool I/O validated by Zod.** No `any` past the boundary. Match Python
   pydantic schemas in `verdigraph_mcp/server.py` field-for-field.
7. **Per-caller isolation.** Agent A cannot read Agent B's `usage_ledger`,
   `caller_id`, genome, or DO state. Enforce in every query.
8. **No secrets in code or in `wrangler.toml`.** Use `wrangler secret put` only.
9. **Append-only ledger.** No `UPDATE` or `DELETE` on `usage_ledger` ever.
10. **Local stdio path still works.** The Python `verdigraph_mcp/` server keeps
    running unchanged; the hourly triage scheduled task must not regress.

---

## Phase 1 — OAuth completion (block: required before any external caller)

Currently `src/auth/handler.ts` `POST /authorize` is a text-stub. Wire it to
`@cloudflare/workers-oauth-provider`'s `completeAuthorization` so the OAuth code
flow actually completes and the McpAgent receives `props.callerId`.

**Files to touch:**
- `src/auth/handler.ts` — replace the stub with a real `completeAuthorization`
  call. Pass `userId = caller_id`, `metadata = { display_name, email }`, `scope`,
  and `props = { callerId }`.
- `src/index.ts` — pass the `OAuthProvider` instance into the handler context so
  `c.env.OAUTH_PROVIDER` (or similar) is reachable.

**Identity model for v0.2:** anonymous-with-ULID-subject is fine. Mint a fresh
`caller_id` per authorization request, insert into `callers` if absent. Move to
GitHub OIDC sign-in in a later pass (out of scope for this brief).

**Test:** call `/authorize` → expect a 302 redirect with `?code=...` to the
client's redirect_uri. Token exchange at `/token` should return a valid JWT.

---

## Phase 2 — Port the remaining 12 tools (the bulk of the work)

Order them so easy wins land first. Each tool's Python signature is in
`verdigraph_mcp/server.py`; copy the Zod schema directly from the pydantic class.

**File layout to add under `src/verdigraph/`:**

```
src/verdigraph/
├── compute.ts        # DONE
├── genome.ts         # port verdigraph/genome.py
├── graph.ts          # port verdigraph/graph.py — CognitiveGraph: nodes, edges, weights
├── growth.ts         # port verdigraph/growth.py — apply growth rules
├── pruning.ts        # port verdigraph/pruning.py — apply pruning rules
├── evaluation.ts     # port verdigraph/evaluation.py — EvaluationResult, scoring
├── dev_ledger.ts     # port verdigraph/ledger.py — INTERNAL developmental ledger
│                     # (distinct from billing usage_ledger). Stored in DO state.
├── routing.ts        # port verdigraph/routing.py — best_next_steps
├── agent.ts          # port verdigraph/agent.py — DevelopmentalAgent class
│                     # wraps genome + graph + ledger
└── registry.ts       # port verdigraph_mcp/registry.py — but Durable-Object-backed
```

**State strategy:**
- Live agent lives inside the per-caller Durable Object's `state.storage`.
- On `verdigraph_save_agent_state`, write a canonical JSON snapshot to R2 at
  `verdigraph-state/{caller_id}/{agent_id}.json`.
- On `verdigraph_load_agent_state`, read from R2 and hydrate the DO.

**Tools to register in `src/mcp/agent.ts` (alongside the two already done):**

| Tool | Notes |
|------|-------|
| `verdigraph_create_agent` | Validate genome shape; insert; return `agent_id`. |
| `verdigraph_list_agents` | Per-caller only; never leak other callers. |
| `verdigraph_get_graph_summary` | Node count, edge count, top-N edges by weight. |
| `verdigraph_get_agent_state` | Read DO state; do not include billing data. |
| `verdigraph_submit_evaluation` | Triggers growth/pruning; writes dev_ledger row. |
| `verdigraph_best_next_steps` | Routing query; pure read. |
| `verdigraph_get_ledger` | Internal developmental ledger (NOT billing). |
| `verdigraph_save_agent_state` | DO → R2 snapshot. Canonical JSON serialization. |
| `verdigraph_load_agent_state` | R2 → DO hydrate. |
| `verdigraph_delete_agent` | Soft-delete `is_active=0`; never hard-delete. |
| `verdigraph_should_use_cache` | Pure compute. |
| `verdigraph_should_escalate` | Pure compute. |

**Wrap each tool in the billing middleware** (extract a `meteredTool` helper that
wraps the tool function with try/catch + `writeLedger` regardless of outcome).

**Parity tests:** for each TS file, write a vitest case that calls the same input
against the live Python implementation (via `child_process.exec`) and asserts the
outputs match. Use `examples/viridis_operator.genome.json` as the canonical input.

---

## Phase 3 — Stripe billing

`stripe` SDK is already in `package.json`.

**Files to add:**

```
src/billing/
├── ledger.ts            # DONE
├── stripe.ts            # NEW — Stripe client factory, usage record writer
└── webhook.ts           # NEW — POST /stripe/webhook handler
```

**Stripe setup (out-of-band on Justin's side):**
- Create a meter `verdigraph_calls` (USD).
- Create a Stripe Connect account for the Viridis conservation fund.
- Mint a restricted key with `usage_records:write`, `invoices:write`,
  `transfers:write`. Store via `wrangler secret put STRIPE_SECRET_KEY`.

**On every successful, charged tool call**: after `writeLedger`, fire
`stripe.billing.meterEvents.create({ event_name: "verdigraph_calls", payload: {
  stripe_customer_id, value: total_charged_usd_micros } })`. Update the ledger
row with the returned event id.

**Webhook handler at `/stripe/webhook`:**
- Verify signature with `STRIPE_WEBHOOK_SECRET`.
- Insert raw event into `stripe_events`.
- Process synchronously for `customer.created`, `invoice.paid`,
  `invoice.payment_failed`. Mark `processed_at = now` on success.

**Monthly conservation cron (Workers Cron Trigger):**
- On the 1st of each month at 00:00 UTC, aggregate the prior month's
  `usage_ledger` rows for `success=1`, sum `total_charged - model_cost`
  (= net revenue), compute `floor(net / 4) = conservation share`.
- Insert a `conservation_payouts` row with `status='pending'`.
- Call `stripe.transfers.create({ destination: CONSERVATION_RECIPIENT, amount,
  currency: 'usd' })`. Update row to `status='sent'` with `stripe_transfer_id`.
- On failure, leave `status='pending'` and surface in next run.

---

## Phase 4 — Deploy and validate

**One-time on Justin's Mac:**

```bash
cd path/to/verdigraph-neurogenesis/hosted-mcp
npm install
npx wrangler login
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CONSERVATION_RECIPIENT
npx wrangler deploy
```

**Smoke test from this session:**
- `curl https://verdigraph-mcp.<account>.workers.dev/healthz` → 200 with `{ ok:
  true }`.
- `curl https://verdigraph-mcp.<account>.workers.dev/.well-known/oauth-authorization-server`
  → 200 with OAuth metadata JSON.
- Register a test client via the dynamic client registration endpoint.
- Run OAuth code flow end-to-end (use `mcp-remote` or the MCP inspector).
- Call `verdigraph_choose_compute_profile` with `task_type="issue_triage"`,
  `request_id="test-001"` — expect a JSON result + one `usage_ledger` row.
- Call again with the same `request_id` — expect the SAME row returned, NO new
  insert (idempotency).
- Inspect the `usage_ledger` row via D1 MCP — verify
  `total_charged_usd_micros = 2000` (just the routing fee since no model burned).

**Acceptance criteria:**
- All vitest tests pass: `npm test`.
- `npx tsc --noEmit` clean.
- A second deployed MCP client (Claude Desktop pointed at the URL) can complete
  OAuth, list tools, and call `verdigraph_choose_compute_profile` successfully.
- The local stdio Python verdigraph-mcp still works for the hourly triage —
  verify by running `verdigraph-mcp` from the project venv (regression check).

---

## Order of attack (recommended)

1. **Phase 1 OAuth completion** — without this nothing else proves out.
2. **Port `genome.ts`, `graph.ts`** — foundational, used by everything else.
3. **Port `agent.ts`, `registry.ts`** — enables `create_agent`, `list_agents`,
   `delete_agent`.
4. **Port `growth.ts`, `pruning.ts`, `evaluation.ts`** — enables
   `submit_evaluation`.
5. **Port `dev_ledger.ts`, `routing.ts`** — enables `get_ledger`,
   `best_next_steps`.
6. **`save_agent_state`, `load_agent_state` with R2** — enables persistence.
7. **`should_use_cache`, `should_escalate`** — last, pure compute.
8. **Stripe meter + webhook**.
9. **Monthly conservation cron**.
10. **Deploy + smoke test**.

---

## Hard "do not" list

- Do NOT touch the Python `verdigraph/` or `verdigraph_mcp/` directories. They
  power the local hourly triage; regression is unacceptable.
- Do NOT widen the Worker's network egress beyond `api.stripe.com`,
  `api.anthropic.com`, and Cloudflare's own bindings.
- Do NOT add a `caller_id`-stripped admin tool. Every tool MUST resolve the
  caller from OAuth props.
- Do NOT use floats for money math anywhere. Integers only.
- Do NOT write to `usage_ledger` outside `writeLedger`.
- Do NOT execute Stripe transfers or test charges with real money — keep Stripe
  in test mode until Justin explicitly green-lights live mode.

---

## Quick verification before declaring done

```bash
# typecheck
cd path/to/verdigraph-neurogenesis/hosted-mcp && npx tsc --noEmit

# unit tests
npm test

# parity tests vs Python reference (writes a comparison report)
npm run test:parity

# deployed health
curl -fsS https://verdigraph-mcp.<account>.workers.dev/healthz | jq .

# idempotency check
REQ=$(uuidgen)
curl -X POST .../mcp -d "$REQ"  # twice
# expect identical response + a SINGLE row in usage_ledger for that request_id

# local stdio regression
cd path/to/verdigraph-neurogenesis && .venv/bin/verdigraph-mcp </dev/null
# expect: starts cleanly, no errors
```

When all checks pass, update `hosted-mcp/README.md`'s "Roadmap" section, save a
project memory at `memory/hosted_verdigraph_mcp_arch.md` noting the deployment
URL + first successful billed call, and post a session log line to Obsidian.
