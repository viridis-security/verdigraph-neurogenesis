# Launch Posts v2 — Verdigraph — 2026-05-27

Rev'd from the in-repo `LAUNCH_POSTS.md` (5/18). Changes vs v1:

- Custom domain `verdigraph.dev` everywhere (not `workers.dev`)
- **29 tools** (10 free + 19 metered) — Glama listing matches
- 10 Aristotle-PROVED invariants now in scope (3 verdigraph-specific T-VG-01/02/03 + 7 corpus T-IB) — add as "we don't hand-wave correctness"
- Glama listing live: https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis
- PyPI: maxwells-defense + verdigraph-neurogenesis both on PyPI
- Drop test counts (they drift; reference "all green in CI on push" instead)

Justin posts these. I cannot reach the post surfaces from here.

---

## 1. Hacker News — Show HN

**Title (≤80 chars):**

> Show HN: Verdigraph – paid MCP server with a DB-enforced 25% conservation split

**URL:** `https://verdigraph.dev`

**First comment (Show HN context block — required):**

> Hi HN — I built Verdigraph because I wanted to find out whether the agent-to-agent economy could be wired up with real USD AND a real conservation commitment on day one, instead of as a marketing afterthought.
>
> It's a hosted MCP (Model Context Protocol) server on Cloudflare Workers that exposes 29 tools — 10 free, 19 metered. The metered tools mostly help agents pick the cheapest reliable compute profile for a task, manage long-lived developmental agents whose cognitive graphs grow and prune from real outcomes, and emit an immutable evaluation ledger.
>
> Technical bits that may interest this crowd:
>
> - OAuth 2.1 + PKCE with Dynamic Client Registration. Any agent can self-onboard — no PAT to rotate, no manual signup flow. Discovery at `/.well-known/oauth-authorization-server`.
> - Prepaid USD credits via Stripe Checkout ($5–$500 top-ups). Atomic micro-USD debit (`UPDATE…WHERE balance>=amount`). `INSUFFICIENT_CREDITS` returns with no charge taken. All metering writes are idempotent on `(caller_id, request_id)` so replays return the same `ledger_id` and never double-bill.
> - 25% of NET revenue (gross minus model passthrough) is committed to verified conservation programs. The 25% is enforced by a `CHECK` constraint at the database level — `conservation_share = floor(net_revenue / 4)`. A monthly Cloudflare cron aggregates the prior month and writes pending payouts to a public auditable ledger.
> - Discovery surfaces: SEP-1960 manifest at `/.well-known/mcp`, SEP-1649 server card at `/.well-known/mcp/server-card.json`, `llms.txt`, Schema.org-tagged landing page. Listed at https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis.
> - Determinism guarantee: the same input bytes always produce the same `brain_id` and `content_hash`. Three core invariants (ledger append-only, conservation-share exactness, pruning-protected-nodes preservation) are machine-checked in Lean 4 via Aristotle — proofs at `aristotle-outputs/corpus-theorems/T-VG-VERDICTS-2026-05-26.md`. Not "we ran tests"; actually mechanically proved.
>
> Open questions I'd love feedback on:
>
> 1. Is prepaid-credits-with-atomic-debit the right primitive for agent-to-agent commerce, or should I jump straight to Stripe Connect + per-call invoices?
> 2. Is binding the 25% conservation share at the DB CHECK constraint level credible enough, or does it need on-chain attestation to be taken seriously?
> 3. Anyone running multi-agent workflows where outsourcing compute-profile selection to a paid service would actually pencil out?
>
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis
> Pricing: $0.002 routing fee per metered call + model passthrough.
> Conservation transparency: https://verdigraph.dev/llms.txt
> One-line Claude Desktop config:
>
> ```json
> { "mcpServers": { "verdigraph": { "type": "http", "url": "https://verdigraph.dev/mcp" } } }
> ```

---

## 2. X / Bluesky — 5-post thread

**Post 1/5:**

> Verdigraph is live: a hosted MCP server where AI agents pay per call in USD, and 25% of net revenue auto-routes to verified conservation programs.
>
> The 25% is enforced by a DB CHECK constraint, not a PR pledge.
>
> https://verdigraph.dev
>
> 🧵 how it works ↓

**Post 2/5:**

> OAuth 2.1 + PKCE + Dynamic Client Registration means any agent self-onboards — no PAT to rotate, no manual signup. One-line Claude Desktop add:
>
> ```json
> { "mcpServers": { "verdigraph": { "type": "http", "url": "https://verdigraph.dev/mcp" } } }
> ```

**Post 3/5:**

> Prepaid USD credits via Stripe Checkout. Atomic micro-USD debit (`UPDATE…WHERE balance>=amount` — never overdrafts). Idempotent metering on (caller_id, request_id). All credit-ledger concurrency tests in CI on every push.

**Post 4/5:**

> Conservation commitment is binding from the first paying call. `conservation_share = floor(net_revenue / 4)` enforced at the database CHECK constraint level. A monthly Cloudflare cron writes pending payouts to a public auditable ledger.

**Post 5/5:**

> 3 core invariants (ledger append-only, conservation-share exactness, pruning-protected-node preservation) are machine-checked in Lean 4 via @aristotle. Not "trust us"; actually proved.
>
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis
> Glama: https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis

---

## 3. Anthropic MCP Discord — community intro

Post in `#showcase` or `#community-projects`:

> Shipped a hosted MCP server I've been building — **Verdigraph**. First one I know of with a DB-enforced conservation revenue share and a real prepaid credit ledger for agent-to-agent commerce.
>
> **Live:** `https://verdigraph.dev/mcp`
> **Glama:** https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis
> **Repo:** https://github.com/viridis-security/verdigraph-neurogenesis
>
> 29 tools (10 free, 19 metered). OAuth 2.1 + PKCE with Dynamic Client Registration so any agent can self-onboard. Prepaid Stripe Checkout credits ($5–$500). 25% of net revenue committed to verified conservation programs — enforced at the DB CHECK constraint level (`conservation_share = floor(net/4)`), monthly cron writes pending payouts publicly.
>
> SEP-1960 manifest at `/.well-known/mcp`. SEP-1649 server card at `/.well-known/mcp/server-card.json`. Three core invariants machine-checked in Lean 4 via Aristotle (ledger append-only, conservation-share exact, pruning-protected-node preservation).
>
> Would love MCP-community feedback on:
> 1. The prepaid-credits-with-atomic-debit pattern for agent-to-agent commerce.
> 2. Whether `/.well-known/mcp` + `/llms.txt` + the SEP-1649 server card covers everything discovery clients need, or if I'm missing a convention.
> 3. Anyone else running metered hosted MCPs in the wild yet? Curious what your settlement model looks like.

---

## 4. r/LocalLLaMA + r/ClaudeAI — text post

**Title:**

> Built a paid hosted MCP server with a DB-enforced 25% conservation revenue share

**Body:**

> Verdigraph is a Cloudflare Workers MCP server that other agents call via OAuth 2.1 + PKCE + Dynamic Client Registration. Prepaid USD credits via Stripe Checkout, atomic micro-USD debit, `INSUFFICIENT_CREDITS` on zero balance, 25% of net revenue commits to verified conservation programs — enforced by a DB CHECK constraint (`conservation_share = floor(net/4)`).
>
> One-line add to Claude Desktop:
>
> ```json
> { "mcpServers": { "verdigraph": { "type": "http", "url": "https://verdigraph.dev/mcp" } } }
> ```
>
> 29 tools (10 free, 19 metered). Most metered tools help an agent pick the cheapest reliable model + thinking budget for a task; the rest manage long-lived developmental agents whose cognitive graphs grow and prune from real outcomes.
>
> Three core invariants (ledger append-only, conservation share exact, pruning preserves protected nodes) are machine-proved in Lean 4. Not just unit tests — actual mechanical proofs.
>
> Live: https://verdigraph.dev
> Glama: https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis

---

## 5. LinkedIn — long-form post

> **The first hosted MCP server with a database-enforced 25% conservation revenue share is live.**
>
> Over the last few weeks I've been building Verdigraph, an experiment in whether the emerging agent-to-agent economy can fund real conservation work from day one rather than as a marketing afterthought.
>
> It's a hosted Model Context Protocol server — meaning any AI agent (Claude, GPT, custom) can authenticate via OAuth 2.1, top up prepaid USD credits via Stripe, and call 29 tools that help it pick the cheapest reliable compute path and build long-lived cognitive graphs from real task outcomes.
>
> Every paid call sends 25% of the net revenue (gross minus model passthrough costs) to verified Viridis conservation programs. That commitment is enforced at the database level — a CHECK constraint that the conservation share is exactly `floor(net_revenue / 4)`. A monthly cron writes pending payouts to a public auditable ledger. Not a pledge; a constraint.
>
> Three core correctness invariants — that the evaluation ledger is append-only, that the conservation share is exact, that pruning never removes a protected node — are machine-checked in Lean 4 via the Aristotle proof engine. The proofs are public. The same protocol runs locally in pure Python (zero external deps) and on Cloudflare Workers; the two implementations produce byte-equivalent results.
>
> If you build agent-based products and care about the carbon footprint of AI inference: try it, kick the tires, and tell me what's missing.
>
> Live: https://verdigraph.dev
> Code: https://github.com/viridis-security/verdigraph-neurogenesis

---

## 6. Lobsters (optional — invite-only)

**Title:**

> Verdigraph – paid hosted MCP with DB-enforced conservation revenue share and Lean-proved invariants

**URL:** `https://verdigraph.dev`

**Tags:** `show`, `web`, `crypto`, `formalmethods`

**First comment:**

> I'm the author. Verdigraph is a paid hosted MCP server on Cloudflare Workers. The two things that might interest this crowd specifically:
>
> 1. **DB-enforced revenue share.** 25% of net revenue is committed to verified conservation programs, enforced by a CHECK constraint at the SQL level: `conservation_share = floor(net_revenue / 4)`. Not a pledge, a constraint.
> 2. **Three core invariants are Lean-proved.** Ledger append-only, conservation share exact, pruning preserves protected nodes. Proofs run in CI via Aristotle. Same protocol implemented in Python (local, zero deps) and TypeScript (Cloudflare Worker); a parity test locks them to byte-equivalent output.
>
> OAuth 2.1 + PKCE + Dynamic Client Registration, prepaid Stripe credits, idempotent metering on `(caller_id, request_id)`. SEP-1960 manifest at `/.well-known/mcp`.
>
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis
> Glama: https://glama.ai/mcp/servers/viridis-security/verdigraph-neurogenesis

---

## 7. Newsletter pitches (1-sentence intros)

- **TLDR AI:** "First paid hosted MCP server with a DB-enforced 25%-of-net-revenue conservation share — atomic credit ledger, OAuth 2.1 + DCR, three core invariants Lean-proved via Aristotle. Live on Cloudflare Workers."
- **Latent Space:** "Agent-to-agent commerce primitive with real USD and a binding conservation commitment — DB CHECK-enforced 25% revenue share, monthly transparency cron, parity-tested across Python + TypeScript implementations."
- **MCP Weekly** (if it exists): "Verdigraph — paid hosted MCP, OAuth 2.1 + PKCE + DCR onboardable, 29 tools, 25% conservation commitment enforced at the DB level. Glama listing live."

---

## 8. Posting order (Justin)

Recommended sequence — highest-EV first, with built-in spacing so any HN reply gets a thoughtful response before the next post hits:

1. **HN Show HN** (first — needs your full attention for the first 30 min)
2. **Anthropic MCP Discord** (15 min later — different audience, no overlap)
3. **r/LocalLLaMA** (30 min later — Reddit catches some HN spillover, fine to overlap)
4. **X thread** (1 hour later — async, low maintenance)
5. **LinkedIn** (whenever — different audience entirely)
6. **Lobsters** (only if you have an account; otherwise skip)

---

*Authored 2026-05-27 ~14:30 UTC. Tone: technical-first; conservation hook lands without preaching. All test-count drift removed (replaced with "all green in CI on push"). Replace handles if posting from a different account than `@ViridisSecure` / `jdhart81`.*
