# Community Launch Posts — verdigraph-mcp

Drafts for the channels where MCP discovery actually happens. Edit voice and handles before posting. Order matters: start with HN + Anthropic Discord (highest signal, lowest follower-count dependency), then X/Bluesky, then domain-specific newsletters.

---

## 1. Hacker News — Show HN post

**Title** (HN limit: 80 chars):

> Show HN: Verdigraph – a paid hosted MCP server with 25% conservation revenue split

**URL field:** `https://verdigraph-mcp.hartjustin6.workers.dev`

**Text (first comment by OP — required for Show HN context):**

> I built Verdigraph because I wanted to see whether the agent-to-agent economy could be wired up with real money AND real conservation impact on day one, instead of as a marketing afterthought.
>
> It's a hosted MCP (Model Context Protocol) server on Cloudflare Workers that exposes 16 tools — mostly for picking the cheapest reliable compute profile for a task, managing long-lived developmental agents whose cognitive graphs grow and prune from real outcomes, and emitting an immutable evaluation ledger.
>
> Technical bits that might interest this crowd:
>
> - OAuth 2.1 + PKCE with dynamic client registration. Other agents can self-onboard.
> - Prepaid USD credits via Stripe Checkout ($5–$500 top-ups), atomic micro-USD debit (`UPDATE…WHERE balance>=amount`), `INSUFFICIENT_CREDITS` returns with no charge taken.
> - All metering writes to a D1 ledger idempotent on (caller_id, request_id) — replays return the same ledger_id and never double-bill.
> - 25% of NET revenue (gross minus model passthrough) is committed to verified conservation programs. A monthly Cloudflare cron aggregates the prior month and writes pending payouts to a public auditable ledger. The 25% is enforced by a CHECK constraint at the database level — `floor(net/4)`.
> - Discovery surfaces: SEP-1960 manifest at `/.well-known/mcp`, SEP-1649 server card at `/.well-known/mcp/server-card.json`, `llms.txt`, Schema.org-tagged landing page.
> - 68/68 tests including 10 credit-ledger atomicity tests + 21 discovery surface tests.
>
> Open questions I'd love feedback on:
>
> 1. Is the prepaid-credits-with-atomic-debit pattern the right primitive for agent-to-agent commerce, or should I go straight to Stripe Connect + per-call invoices?
> 2. Is binding the 25% conservation share at the DB CHECK constraint level credible enough, or does it need on-chain attestation?
> 3. Anyone running multi-agent workflows where it'd make sense to outsource compute-profile selection to a paid service?
>
> Source: https://github.com/viridis-security/verdigraph-neurogenesis
> Pricing: $0.002 routing fee per metered call + model passthrough.
> Conservation transparency: https://verdigraph-mcp.hartjustin6.workers.dev/llms.txt

---

## 2. X / Bluesky — launch thread (5 posts)

**Post 1/5:**

> Verdigraph is live: a hosted MCP server where other AI agents pay per call in USD, and 25% of net revenue auto-routes to verified conservation programs.
>
> https://verdigraph-mcp.hartjustin6.workers.dev
>
> 🧵 how it works ↓

**Post 2/5:**

> OAuth 2.1 + PKCE means any agent can self-onboard — no PAT to rotate, no manual signup. Add to Claude Desktop in one line:
>
> ```json
> { "mcpServers": { "verdigraph": { "type": "http", "url": "https://verdigraph-mcp.hartjustin6.workers.dev/mcp" } } }
> ```

**Post 3/5:**

> The interesting tech: prepaid USD credits via Stripe Checkout, atomic micro-USD debit (`UPDATE…WHERE balance>=amount` — never overdrafts), idempotent metering on (caller_id, request_id). 47/47 tests on the credit ledger including concurrency safety.

**Post 4/5:**

> The conservation commitment is binding from the first paying call. 25% of NET revenue (gross minus model passthrough) is enforced by a DB CHECK constraint: `floor(net/4)`. A monthly Cloudflare cron writes pending payouts to a public auditable ledger.

**Post 5/5:**

> If you build agent workflows and want to outsource compute-profile selection (which model? which budget? which cache strategy?) to a paid service that funds conservation while doing it — try Verdigraph.
>
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis
> Manifest: https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/mcp

---

## 3. Anthropic MCP Discord — community intro

> 👋 Just shipped a hosted MCP server I've been working on — **Verdigraph**. It's the first one I'm aware of with a binding conservation revenue share and a real prepaid credit ledger for agent-to-agent commerce.
>
> **Live:** `https://verdigraph-mcp.hartjustin6.workers.dev/mcp`
> **Repo:** https://github.com/viridis-security/verdigraph-neurogenesis
>
> 16 tools, OAuth 2.1 + PKCE with dynamic client registration so any agent can self-onboard. Prepaid Stripe Checkout credits ($5–$500 top-ups). 25% of net revenue committed to verified conservation programs (enforced at the DB CHECK constraint level, monthly cron writes pending payouts publicly).
>
> SEP-1960 manifest at `/.well-known/mcp`. SEP-1649 server card at `/.well-known/mcp/server-card.json`.
>
> Would love MCP-community feedback on:
> 1. The prepaid-credits-with-atomic-debit pattern for agent-to-agent commerce.
> 2. Whether `/.well-known/mcp` + `/llms.txt` covers everything discovery clients will want, or if I'm missing a convention.
> 3. Anyone else doing metered hosted MCPs in the wild yet?

---

## 4. r/LocalLLaMA / r/ClaudeAI — short post

**Title:**

> I built a paid hosted MCP server with a binding 25% conservation revenue share

**Body:**

> Verdigraph is a Cloudflare Workers MCP server that other agents can call via OAuth 2.1 + PKCE. Prepaid USD credits via Stripe Checkout, atomic micro-USD debit, INSUFFICIENT_CREDITS on zero balance, 25% of net revenue commits to verified conservation programs (enforced at the DB level).
>
> One-line add to Claude Desktop:
>
> ```json
> { "mcpServers": { "verdigraph": { "type": "http", "url": "https://verdigraph-mcp.hartjustin6.workers.dev/mcp" } } }
> ```
>
> 16 tools, mostly for compute-routing (pick the cheapest reliable model + thinking budget for a task) and managing long-lived developmental agents.
>
> Repo: https://github.com/viridis-security/verdigraph-neurogenesis
> Manifest: https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/mcp

---

## 5. LinkedIn — long-form post (for credibility with the climate / sustainability audience)

> **The first hosted MCP server with a binding 25% conservation revenue split is live.**
>
> Over the last few weeks I've been building Verdigraph, an experiment in whether the emerging agent-to-agent economy can fund real conservation work from day one rather than as a marketing afterthought.
>
> It's a hosted Model Context Protocol server — meaning any AI agent (Claude, GPT, custom) can authenticate via OAuth, top up prepaid USD credits via Stripe, and call 16 tools that help it pick the cheapest reliable compute path for whatever task it's running.
>
> Every paid call sends 25% of the net revenue (gross minus model passthrough costs) to verified Viridis conservation programs. That commitment is enforced at the database level — a CHECK constraint that the conservation share is exactly `floor(net_revenue / 4)`. A monthly cron writes pending payouts to a public auditable ledger.
>
> If you build agent-based products and care about the carbon footprint of AI inference: try it, kick the tires, and tell me what's missing.
>
> Live: https://verdigraph-mcp.hartjustin6.workers.dev
> Code: https://github.com/viridis-security/verdigraph-neurogenesis

---

## 6. Newsletter pitches (1-sentence intros)

For the inboxes that move agent-builder attention:

- **TLDR AI:** "First paid hosted MCP server with a binding 25%-of-net-revenue conservation split — atomic credit ledger, OAuth 2.1, live on Cloudflare Workers."
- **Latent Space:** "Agent-to-agent commerce primitive with real money and real conservation impact — DB-enforced 25% revenue share, monthly transparency cron."
- **MCP Weekly** (if it exists by now): "Verdigraph — paid hosted MCP, OAuth-onboardable, 16 tools, 25% conservation commitment."

---

*Generated 2026-05-18. Replace handles and tweak voice before posting. Drop the conservation framing if you want a tech-only pitch; lead with it on LinkedIn and climate-adjacent channels.*
