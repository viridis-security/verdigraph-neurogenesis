# MCP Registry Submission Kit — verdigraph-mcp

Goal: get `verdigraph-mcp` indexed in every MCP registry agents and bot builders search, in priority order. The Worker now serves all standard discovery surfaces (SEP-1960, SEP-1649, llms.txt, sitemap, robots, landing page with Schema.org), so most registries that auto-crawl will pick it up — but the manual submissions below are still required for the top-tier directories.

**Live URL:** `https://verdigraph-mcp.hartjustin6.workers.dev`
**Repo:** `https://github.com/viridis-security/verdigraph-neurogenesis`
**Canonical metadata source:** [`hosted-mcp/src/discovery/manifest.ts`](hosted-mcp/src/discovery/manifest.ts)

---

## 0. Canonical submission JSON (reuse everywhere)

Most registries accept some variant of this shape. Copy-paste, then trim/rename per their schema.

```json
{
  "name": "verdigraph-mcp",
  "title": "Verdigraph — paid hosted MCP for compute routing",
  "version": "0.2.0",
  "description": "Hosted, OAuth-authenticated, pay-per-call MCP for agent-to-agent compute routing. Prepaid USD credits via Stripe Checkout, atomic ledger, 25% of net revenue auto-routes to verified conservation.",
  "homepage": "https://verdigraph-mcp.hartjustin6.workers.dev",
  "repository": "https://github.com/viridis-security/verdigraph-neurogenesis",
  "license": "MIT",
  "vendor": { "name": "Viridis LLC", "contact": "hartjustin6@gmail.com" },
  "transport": ["streamable_http", "sse"],
  "endpoint": "https://verdigraph-mcp.hartjustin6.workers.dev/mcp",
  "authentication": {
    "type": "oauth2",
    "flows": ["authorization_code+pkce"],
    "dynamic_registration": true,
    "metadata_url": "https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/oauth-authorization-server"
  },
  "discovery": {
    "manifest": "https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/mcp",
    "server_card": "https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/mcp/server-card.json",
    "llms_txt": "https://verdigraph-mcp.hartjustin6.workers.dev/llms.txt"
  },
  "pricing": { "model": "prepaid_credits", "topup_min_usd": 5, "topup_max_usd": 500, "routing_fee_usd": 0.002 },
  "categories": ["compute-routing","agent-economy","agent-to-agent","metered","oauth-2.1","conservation","developmental-agents","neuromorphic"],
  "keywords": ["verdigraph","mcp","hosted-mcp","paid-mcp","compute-routing","agent-economy","agent-to-agent","a2a","metered","stripe","conservation","oauth","viridis","cognitive-graph","self-evolving","neuromorphic","developmental-ai"]
}
```

---

## 1. Official MCP Registry (Anthropic / MCP Steering Group) — **highest priority**

**URL:** https://registry.modelcontextprotocol.io/
**Repo for PRs:** https://github.com/modelcontextprotocol/servers

1. Fork `modelcontextprotocol/servers`.
2. The canonical README of that repo has a section like `## Community Servers` (or in newer revisions, a JSON file). Add an entry there:
   ```markdown
   - **[Verdigraph](https://github.com/viridis-security/verdigraph-neurogenesis)** — Paid hosted MCP for agent-to-agent compute routing with binding 25% conservation share.
   ```
3. If the registry API takes JSON submissions, also POST the canonical JSON from §0 to the registry's submit endpoint per their current docs.
4. Open PR. Title: `Add Verdigraph — paid hosted MCP for agent-to-agent compute routing`.
5. PR body: copy the SHORT_DESCRIPTION + the install JSON block.

---

## 2. GitHub MCP Registry — **second priority**

**URL:** https://github.com/marketplace?type=mcp
**Background:** GitHub launched their own MCP registry; it auto-indexes any repo with the right topics + an MCP manifest.

1. Set GitHub repo topics (Settings → General → Topics):
   `mcp`, `mcp-server`, `hosted-mcp`, `claude`, `claude-mcp`, `agent-economy`, `compute-routing`, `metered-api`, `stripe`, `oauth2`, `cloudflare-workers`, `conservation`, `developmental-ai`, `neuromorphic`
2. Confirm the README contains the "🤖 For autonomous agents" front-matter section we just added.
3. Submit via https://github.com/marketplace/listings/new and pick the MCP category. Use the canonical JSON from §0 to fill the form.
4. Verify auto-indexing 24-48h later by searching the GitHub MCP marketplace for `verdigraph`.

---

## 3. Smithery — **third priority (CLI publish)**

**URL:** https://smithery.ai/

```bash
# one-time install
npm i -g @smithery/cli

# publish (no manifest file required — Smithery auto-fetches /.well-known/mcp)
smithery mcp publish "https://verdigraph-mcp.hartjustin6.workers.dev" -n viridis/verdigraph-mcp
```

If the CLI errors, use the web dashboard at https://smithery.ai/ and paste the manifest URL.

---

## 4. mcp.so — community directory

**URL:** https://mcp.so/

1. Visit https://mcp.so/submit
2. Paste the GitHub repo URL — they auto-fetch metadata from README and `package.json`.
3. Manually set categories to the keywords list from §0 if their form supports it.

---

## 5. PulseMCP

**URL:** https://www.pulsemcp.com/

1. Submit form (likely at /submit; check current URL).
2. Use the canonical JSON from §0.

---

## 6. MCP.Directory

**URL:** https://mcp.directory/submit

1. Paste the GitHub repo URL.
2. They auto-pull metadata; listing live within 24 hours.

---

## 7. Glama — auto-indexed (verify, don't submit)

**URL:** https://glama.ai/

Glama auto-indexes open-source MCP servers from GitHub. After topics are set and the README front-matter is live, verify within 24-72h:
1. Search https://glama.ai/ for `verdigraph`.
2. If listed, claim the page via the "Claim listing" link and add Viridis branding.

---

## 8. Anthropic MCP Discord — community announcement

**URL:** https://discord.gg/anthropic (channel: #mcp-servers or equivalent — check current channel names)

Post the draft from `LAUNCH_POSTS.md` (§3).

---

## Verification checklist (run 48h after submission)

- [ ] `curl https://verdigraph-mcp.hartjustin6.workers.dev/.well-known/mcp | jq .server.name` → `"verdigraph-mcp"`
- [ ] `curl https://verdigraph-mcp.hartjustin6.workers.dev/llms.txt | head -3` → contains the live MCP URL
- [ ] Google `verdigraph-mcp site:registry.modelcontextprotocol.io` → result
- [ ] Search GitHub marketplace for `verdigraph` → hit
- [ ] Search https://smithery.ai/ for `verdigraph` → hit
- [ ] Search https://glama.ai/ for `verdigraph` → hit (auto-index window)
- [ ] Search https://mcp.so/ for `verdigraph` → hit

---

*Generated 2026-05-18. Canonical metadata lives in `hosted-mcp/src/discovery/manifest.ts` — edit there, then `wrangler deploy` to update every registry that auto-fetches.*
