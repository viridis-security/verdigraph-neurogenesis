# Integrating with verdigraph-mcp

Connect an autonomous agent to Verdigraph's compute-routing tools over MCP.
Pay-per-call via Stripe; 25% of net revenue routes to Viridis conservation programs.

---

## Endpoint

```
https://verdigraph-mcp.<account>.workers.dev/mcp
```

Public unprotected routes:
- `GET  /healthz` — liveness check.
- `GET  /.well-known/oauth-authorization-server` — RFC 8414 OAuth metadata.
- `POST /register` — dynamic OAuth client registration (RFC 7591).
- `POST /stripe/webhook` — signature-verified, server-to-server only.

Everything under `/mcp` requires an OAuth 2.1 bearer token.

---

## 1. Add the server to your MCP client

### Claude Desktop / claude.ai connectors

Settings → Connectors → Add custom MCP → paste the `/mcp` URL.
A browser tab opens; approve the consent screen; you're connected.

### Claude Code / Cursor / Windsurf / Cline (HTTP MCP supported)

In `~/.claude.json` (Claude Code) or the equivalent config file:

```json
{
  "mcpServers": {
    "verdigraph": {
      "type": "http",
      "url": "https://verdigraph-mcp.<account>.workers.dev/mcp"
    }
  }
}
```

### Stdio-only clients (older SDKs, custom agents)

Bridge through `mcp-remote`:

```json
{
  "mcpServers": {
    "verdigraph": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://verdigraph-mcp.<account>.workers.dev/mcp"]
    }
  }
}
```

`mcp-remote` handles the OAuth flow once and caches tokens in `~/.mcp-auth/`.

### Custom code using the MCP TypeScript SDK

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://verdigraph-mcp.<account>.workers.dev/mcp"),
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);
// OAuth: handle the redirect in your own flow, or use the OAuthClientProvider helper.
```

---

## 2. Tools

Every tool accepts a `request_id` idempotency key. Reusing it returns the
original ledger row without re-executing the body or re-billing.

| Tool | Inputs | Returns |
|------|--------|---------|
| `verdigraph_choose_compute_profile` | `profiles[]`, `task`, `request_id` | Best profile + cost estimate |
| `verdigraph_list_profiles` | `request_id` | Default profile catalog |
| `verdigraph_create_agent` | `genome`, `request_id` | `agent_id` + initial graph summary |
| `verdigraph_list_agents` | `request_id` | List of this caller's agents |
| `verdigraph_get_graph_summary` | `agent_id`, `request_id` | Nodes + edges with stats |
| `verdigraph_get_agent_state` | `agent_id`, `request_id` | Full state dict (genome+graph+ledger) |
| `verdigraph_submit_evaluation` | `agent_id`, `task_id`, `task_type`, `success_score`, … | Updated summary + new ledger events |
| `verdigraph_best_next_steps` | `agent_id`, `from_node`, `limit`, `request_id` | Top-k outgoing routes by edge-score |
| `verdigraph_get_ledger` | `agent_id`, `limit`, `request_id` | Recent developmental events |
| `verdigraph_save_agent_state` | `agent_id`, `request_id` | R2 snapshot key |
| `verdigraph_load_agent_state` | `agent_id`, `request_id` | Restored agent summary |
| `verdigraph_delete_agent` | `agent_id`, `request_id` | Soft-delete confirmation |
| `verdigraph_should_use_cache` | `cache_confidence`, `task_risk`, `threshold` | bool |
| `verdigraph_should_escalate` | `current_confidence`, `task_risk`, `min_confidence` | bool |
| `verdigraph_get_balance` | — | Current credit balance in micro-USD, free of charge |
| `verdigraph_create_topup_session` | `amount_usd` ($5–$500), optional `success_url`/`cancel_url` | Stripe Checkout `checkout_url` for the caller to pay |

Per-caller isolation is structural: agents created under one OAuth grant are
invisible to any other caller. A caller never sees another caller's ledger rows
or R2 snapshots.

---

## 3. The `request_id` contract — read this carefully

`request_id` is the per-caller idempotency key. The hosted MCP guarantees:

1. **First call** with a given `(caller_id, request_id)` executes the tool body and writes exactly one `usage_ledger` row.
2. **Replay** with the same `(caller_id, request_id)` returns the original row's metadata without re-executing the body and without re-billing.
3. **Failures** still write a row with `success=0`, `total_charged=0`, and an `error_code`. The same `request_id` will replay that failure row — it does not retry. Use a fresh `request_id` to retry against a new attempt.

**Generate `request_id` deterministically per logical call.** Examples:

- Hourly triage: `f"sentinel-triage-{utc_hour_iso}"` — replay-safe across container restarts.
- Per-task routing: `f"route-{task_uuid}"` — replay-safe across network retries.
- One-shot exploratory: `uuid4()` — fine for ad-hoc work where retries are intentional new attempts.

**Anti-pattern:** generating a fresh UUID on every network retry. You'll pay
the routing fee every retry instead of replaying the original answer.

---

## 4. Example: choose a compute profile

```python
result = use_tool("verdigraph_choose_compute_profile", {
    "profiles": [
        {"id": "haiku",  "kind": "api_model", "quality_score": 0.78,
         "cost_per_1k_input_tokens": 0.0008, "cost_per_1k_output_tokens": 0.004,
         "latency_ms": 400,  "max_context_tokens": 200_000, "local": False},
        {"id": "sonnet", "kind": "api_model", "quality_score": 0.92,
         "cost_per_1k_input_tokens": 0.003,  "cost_per_1k_output_tokens": 0.015,
         "latency_ms": 900,  "max_context_tokens": 200_000, "local": False},
        {"id": "opus",   "kind": "api_model", "quality_score": 0.98,
         "cost_per_1k_input_tokens": 0.015,  "cost_per_1k_output_tokens": 0.075,
         "latency_ms": 1800, "max_context_tokens": 200_000, "local": False},
    ],
    "task": {
        "id":         "triage-2026-05-17T18:00",
        "task_type":  "issue_triage",
        "difficulty": 0.4,
        "risk":       0.3,
        "expected_input_tokens":  3000,
        "expected_output_tokens": 600,
        "min_quality": 0.75,
        "requires_local": False,
    },
    "request_id": "sentinel-triage-2026-05-17T18:00",
})
```

Response shape (every metered tool returns this envelope):

```json
{
  "ok": true,
  "replayed": false,
  "metering": {
    "ledger_id": "usg_01HFXY...",
    "success": true,
    "total_charged_usd_micros": 2000,
    "routing_fee_usd_micros":   2000,
    "model_cost_usd_micros":    0
  },
  "result": {
    "profile_id": "sonnet",
    "score": 12.34,
    "estimated_cost": 0.018,
    "estimated_cost_usd_micros": 18000,
    "estimated_latency_ms": 900,
    "estimated_gpu_memory_gb": 0,
    "reason": "selected candidate kind=api_model, quality=0.92, cost=0.018000, latency_ms=900, gpu_memory_gb=0.00"
  }
}
```

Replay the same call (identical `request_id`) and you get the same
`metering.ledger_id` plus `"replayed": true`, with `result` populated from the
cached ledger row (no re-execution, no new charge).

---

## 5. Prepaid credits — the actual payment flow

Verdigraph is **prepaid**. Callers deposit credits via Stripe Checkout; each tool
call deducts from the balance; calls return `INSUFFICIENT_CREDITS` when the
balance is too low. No surprise invoices, no subscription, no card on file
required at signup time.

**Topup flow for a new caller:**

1. Caller authenticates via OAuth as usual.
2. Caller invokes `verdigraph_create_topup_session` with an `amount_usd` between $5 and $500.
3. Worker returns a `checkout_url` pointing at `https://checkout.stripe.com/...`.
4. Caller opens that URL in a browser (or directs their user to it) and pays with card / Apple Pay / Google Pay / Link.
5. On payment success, Stripe fires `checkout.session.completed` to `/stripe/webhook`. The Worker idempotently credits the caller's `credit_balances` row.
6. Subsequent tool calls debit from the balance. `verdigraph_get_balance` returns the current micro-USD figure at any time, free of charge.

**Insufficient-credits response shape** (success=false, no charge taken):

```json
{
  "ok": false,
  "replayed": false,
  "metering": {
    "ledger_id": "usg_01...",
    "success": false,
    "error_code": "INSUFFICIENT_CREDITS",
    "total_charged_usd_micros": 0
  },
  "result": {
    "error": "Insufficient credits for caller cal_...: balance 0 μUSD, required 2000 μUSD. Call verdigraph_create_topup_session to add funds.",
    "balance_usd_micros": 0,
    "required_usd_micros": 2000,
    "remedy": "Call verdigraph_create_topup_session to add credits."
  }
}
```

The ledger row is written (audit trail preserved) but `total_charged_usd_micros = 0`
and no Stripe meter event fires. The caller can replay with the same `request_id`
after topping up and the call will execute normally — replay semantics still hold.

## 6. Billing

**Per call:** `total_charged = routing_fee + model_passthrough_cost`. Routing
fee defaults to `$0.002` ($2,000 micro-USD). Model passthrough is whatever the
tool actually spent on Haiku/Sonnet/Opus — pure-compute tools (cache/escalate
policies, optimizer math) have passthrough = 0.

**Stripe meter event** fires after each successful billable row. Configure a
meter named `verdigraph_calls` on the Stripe side; the Worker writes the
event identifier back to `usage_ledger.stripe_usage_event_id`.

**Failures** never get a routing fee. The row still exists for audit.

**Pricing transparency:** every response includes the exact micro-USD breakdown
in `metering`. You can reconcile to your Stripe invoice by summing
`total_charged_usd_micros` for the period (divided by 1,000,000 for USD).

---

## 7. Conservation routing

On the 1st of every month at 00:00 UTC, a Workers Cron Trigger aggregates the
prior month's `success=1` rows, computes:

```
net_revenue = sum(total_charged) - sum(model_passthrough)
share       = floor(net_revenue / 4)        # 25%, never rounded up
```

It writes a row to `conservation_payouts` (status `pending`), then issues
`stripe.transfers.create({destination: CONSERVATION_RECIPIENT, amount: share, currency: 'usd'})`.
On success the row flips to `sent` with the Stripe transfer id. On failure it
stays `pending` and the next month's run retries.

The `conservation_payouts.conservation_share_usd_micros` column has a D1
`CHECK (conservation_share_usd_micros = net_revenue_usd_micros / 4)` constraint —
it is structurally impossible for a row to exist with the wrong split.

A public ledger viewer is planned at `https://verdigraph.ai/conservation` for
end-to-end auditability.

---

## 8. Internal portfolio agents (HDFM / Sentinel / OpenClaw / Energy AI)

If you're calling Verdigraph from one of Viridis's own agents and don't want to
self-bill, prefer the local stdio path:

```bash
pip install -e ".[mcp]"  # from the repo root
verdigraph-mcp           # stdio transport, no OAuth, no billing
```

The hosted Worker is for external paying callers. Same Python core
(`verdigraph/*.py`) drives both rails, so behavior is identical — only the
billing layer differs.

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Unknown OAuth client_id` | Client didn't register via `/register` | Use a client that supports dynamic registration, or `POST /register` manually with a `redirect_uris` JSON array |
| 401 on `/mcp` | Token expired or never minted | Re-run the auth flow; `mcp-remote` users delete `~/.mcp-auth/` to force re-auth |
| `total_charged_usd_micros: 0` on a success | Tool was free-of-charge or explicitly zero | Check `metering.model_cost_usd_micros` + `routing_fee_usd_micros` |
| Replay returns `result: undefined` | First call wrote a failure row | Look at `metering.error_code` — replays of failures intentionally don't re-execute |
| Stripe dashboard shows no usage | Meter `verdigraph_calls` not yet created on Stripe side | Create the meter, redeploy isn't needed |

For anything else, the `usage_ledger` row id is in every response's
`metering.ledger_id` — quote that when filing an issue.

---

## 10. Reference

- Repo: https://github.com/viridis-security/verdigraph-neurogenesis
- Hosted MCP code: `hosted-mcp/`
- Python core: `verdigraph/`, `verdigraph_mcp/`
- MCP spec: https://modelcontextprotocol.io
- OAuth 2.1: RFC 6749 + draft-ietf-oauth-v2-1
