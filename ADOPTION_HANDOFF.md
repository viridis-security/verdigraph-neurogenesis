# Verdigraph adoption — what's done autonomously vs. what needs Justin

## DONE (autonomous, this session)

### Code & deployment
- Hosted MCP code shipped with 8 new public discovery endpoints (/, /.well-known/mcp, /.well-known/mcp/server-card.json, /llms.txt, /llms-full.txt, /robots.txt, /sitemap.xml, /icon.svg) + 2 conservation transparency endpoints (/conservation/public, /conservation/badge.svg).
- 73/73 vitest tests passing (47 prior + 21 discovery + 5 conservation), tsc clean.
- Deployed to Cloudflare Workers — all 10 new endpoints verified live.
- Git tag v0.2.0 pushed; GitHub Release published with rich notes.

### Registry & directory presence
- **Official MCP Registry** — published as io.github.jdhart81/verdigraph-mcp v0.2.0, status active. Search: https://registry.modelcontextprotocol.io/v0.1/servers?search=verdigraph
- **jaw9c/awesome-remote-mcp-servers** — PR #329: https://github.com/jaw9c/awesome-remote-mcp-servers/pull/329
- **punkpeye/awesome-mcp-servers** (87k stars) — PR #6592: https://github.com/punkpeye/awesome-mcp-servers/pull/6592
- **appcypher/awesome-mcp-servers** — branch pushed; upstream blocks API PRs (needs your one-click open)
- GitHub repo metadata: 15 topics applied, description, homepage, has_issues, has_discussions.

### Compounding infrastructure
- Scheduled: verdigraph-weekly-operator-digest (Mondays 6am)
- Scheduled: verdigraph-monthly-conservation-public-update (1st of month 9am)
- Public conservation transparency (JSON + embeddable badge) live.

### Deliverables in workspace folder
- STRIPE_GO_LIVE_CHECKLIST.md
- REGISTRY_SUBMISSION_KIT.md
- LAUNCH_POSTS.md
- ADOPTION_HANDOFF.md (this file)

---

## NEEDS YOUR HAND (5 things, ~15 min total)

### 1. One-click PR open on appcypher fork — 30 seconds
The branch is pushed; upstream blocks PR creation via API. Visit and hit Create:
https://github.com/jdhart81/awesome-mcp-servers-1/pull/new/add-verdigraph

### 2. mcpservers.org form — 1 min
https://mcpservers.org/submit
- Name: Verdigraph
- Description: Paid hosted MCP for agent-to-agent compute routing. 25% of net revenue funds conservation.
- URL: https://github.com/viridis-security/verdigraph-neurogenesis
- Category: AI Services
- Email: hartjustin6@gmail.com

### 3. Post LAUNCH_POSTS.md to real channels — ~10 min
HN Show is the single highest-leverage move. Drafts ready for all 6 channels.

### 4. (Optional) Republish under viridis-security org namespace
Your org membership is now public (I flipped it). To republish:
  cd path/to/verdigraph-neurogenesis/hosted-mcp
  ~/.local/bin/mcp-publisher logout
  ~/.local/bin/mcp-publisher login github   # one more device-code dance
  # Then edit server.json: change name to io.github.viridis-security/verdigraph-mcp
  ~/.local/bin/mcp-publisher publish

### 5. Stripe Go-Live (from earlier checklist) — until done, \$0 revenue
See STRIPE_GO_LIVE_CHECKLIST.md.
