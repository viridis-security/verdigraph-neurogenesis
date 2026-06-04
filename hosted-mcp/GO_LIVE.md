# Verdigraph-MCP — Go-Live Runbook (clear the /authorize 503)

> Generated 2026-06-03. The hosted Worker `verdigraph-mcp` is fully built and
> deployed but `GET /authorize` returns **503 "GitHub sign-in is not configured"**
> because two secrets are unset. Setting them is the entire go-live gate — no
> redeploy needed (`wrangler secret put` applies to the running Worker live).
>
> Source of truth: `src/auth/handler.ts` (503 guard) + `wrangler.toml`.

## Facts pinned from code (do not guess)
- Worker name:        `verdigraph-mcp`
- Custom domain:      `https://verdigraph.dev`  (also www.verdigraph.dev)
- Secret names:       `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`
- GitHub scope used:  `read:user`
- Callback the Worker sends to GitHub: `https://verdigraph.dev/authorize/callback`

## Step 1 — Create the GitHub OAuth App  (Justin, ~2 min)
Go to: https://github.com/settings/developers  →  "New OAuth App"
Fill EXACTLY:
- Application name:            Verdigraph MCP
- Homepage URL:               https://verdigraph.dev
- Authorization callback URL:  https://verdigraph.dev/authorize/callback
Click "Register application". Copy the **Client ID**.
Click "Generate a new client secret". Copy the **Client secret** (shown once).

## Step 2 — Set the two Worker secrets  (Justin, ~1 min)
In a terminal:
    cd ~/Desktop/Cowork\ /axiomgraph_neurogenesis/hosted-mcp
    npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
    # paste the Client ID, press enter
    npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
    # paste the Client secret, press enter
(If wrangler prompts to log in: `npx wrangler login` first.)

## Step 3 — Verify  (no redeploy required)
    curl -s https://verdigraph.dev/healthz
    # expect: {"ok":true,"environment":"production"}
    curl -i https://verdigraph.dev/authorize
    # BEFORE: 503 "GitHub sign-in is not configured on this server."
    # AFTER:  no longer 503 (it now reaches OAuth client parsing) → secrets are live.

## Done = the paid hosted path can authenticate its first real caller.
## Note (separate, do soon): roll the leaked Stripe key rk_live_…j4l4 and
## STRIPE_SECRET_KEY via the same `wrangler secret put` pattern.
