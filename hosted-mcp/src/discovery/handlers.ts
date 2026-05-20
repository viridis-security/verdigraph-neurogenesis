// src/discovery/handlers.ts — public discovery surface for verdigraph-mcp.
//
// Returns a Response if the request path matches a discovery route, or null
// to indicate the OAuth/MCP pipeline should handle it. All endpoints are
// public (no OAuth required) and cacheable.

import { CANONICALIZATION_MD } from "./canonicalization_doc";
// iter5 — marketplace_html module deleted (no website surface)
import { INSTALL_MACOS_SH, INSTALL_WINDOWS_PS1, INSTALL_LINUX_SH } from "./uri_handler_scripts";
import { OPENAPI_YAML } from "./openapi_doc";
import {
  buildSep1960Manifest,
  buildServerCard,
  SERVER_BASE_URL,
  REPO_URL,
  HOMEPAGE_URL,
  SHORT_DESCRIPTION,
  LONG_DESCRIPTION,
  TOOLS,
  CATEGORIES,
  ROUTING_FEE_USD,
  CONSERVATION_NUMERATOR,
  CONSERVATION_DENOMINATOR,
  VENDOR_NAME,
  SERVER_VERSION,
  LICENSE,
  VENDOR_URL,
  KEYWORDS,
} from "./manifest";

const JSON_HEADERS = (maxAgeSec: number) => ({
  "content-type":  "application/json; charset=utf-8",
  "cache-control": `public, max-age=${maxAgeSec}, must-revalidate`,
  "access-control-allow-origin": "*",
});

const TEXT_HEADERS = (maxAgeSec: number, type = "text/plain") => ({
  "content-type":  `${type}; charset=utf-8`,
  "cache-control": `public, max-age=${maxAgeSec}`,
  "access-control-allow-origin": "*",
});

const HTML_HEADERS = (maxAgeSec: number) => ({
  "content-type":  "text/html; charset=utf-8",
  "cache-control": `public, max-age=${maxAgeSec}`,
});

/**
 * Try to handle as a discovery route. Returns Response on hit, null on miss.
 * Pure function: no env, no DB — manifest is static.
 */
export function tryHandleDiscovery(request: Request): Response | null {
  const url    = new URL(request.url);
  const method = request.method.toUpperCase();

  // OPTIONS for CORS preflight on JSON discovery surfaces.
  if (method === "OPTIONS" && (url.pathname.startsWith("/.well-known/mcp") || url.pathname === "/llms.txt")) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin":  "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-max-age":       "86400",
      },
    });
  }

  if (method !== "GET" && method !== "HEAD") return null;

  switch (url.pathname) {
    case "/":
      return makeBody(method, renderLandingPage(), HTML_HEADERS(600));

    case "/.well-known/mcp":
    case "/.well-known/mcp.json":
      return makeBody(method, JSON.stringify(buildSep1960Manifest(), null, 2), JSON_HEADERS(300));

    case "/.well-known/mcp/server-card.json":
      return makeBody(method, JSON.stringify(buildServerCard(), null, 2), JSON_HEADERS(300));

    case "/llms.txt":
      return makeBody(method, renderLlmsTxt(), TEXT_HEADERS(3600));

    case "/llms-full.txt":
      return makeBody(method, renderLlmsFullTxt(), TEXT_HEADERS(3600));

    case "/robots.txt":
      return makeBody(method, renderRobotsTxt(), TEXT_HEADERS(86400));

    case "/sitemap.xml":
      return makeBody(method, renderSitemap(), TEXT_HEADERS(86400, "application/xml"));

    case "/icon.svg":
      return makeBody(method, renderIconSvg(), TEXT_HEADERS(86400, "image/svg+xml"));

    case "/CANONICALIZATION.md":
      return makeBody(method, CANONICALIZATION_MD, TEXT_HEADERS(3600, "text/markdown"));

    case "/openapi.yaml":
    case "/openapi.yml":
      return makeBody(method, OPENAPI_YAML, TEXT_HEADERS(3600, "application/yaml"));

    case "/scripts/uri-handler/install-macos.sh":
      return makeBody(method, INSTALL_MACOS_SH, TEXT_HEADERS(3600, "text/x-shellscript"));

    case "/scripts/uri-handler/install-windows.ps1":
      return makeBody(method, INSTALL_WINDOWS_PS1, TEXT_HEADERS(3600, "text/plain"));

    case "/scripts/uri-handler/install-linux.sh":
      return makeBody(method, INSTALL_LINUX_SH, TEXT_HEADERS(3600, "text/x-shellscript"));

    default:
      return null;
  }
}

function makeBody(method: string, body: string, headers: Record<string, string>): Response {
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(body, { status: 200, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderLlmsTxt(): string {
  return `# verdigraph-mcp

> ${SHORT_DESCRIPTION}

This is a hosted, OAuth 2.1 + PKCE authenticated Model Context Protocol server.
Pay per call in USD via Stripe Checkout. Prepaid USD credits, atomic micro-USD debit, INSUFFICIENT_CREDITS on zero balance.

## Brain-building shop (live MCP build environment, PRIVATE brains)

- Human-facing UI: ${SERVER_BASE_URL}/app
- Pair an agent to a browser session via brain_pair_session (BYO LLM — we never proxy inference).
- Import: brain_import (free preview). Unlock: $9 one-time or $19/mo.
- Brains are PRIVATE PROPERTY of the building caller_id. No public marketplace.
  An owner can prove a brain's structure to a downstream party via:
    (1) the deterministic brain_id + source genome bytes (zero-trust),
    (2) the free /app/import preview (no auth; node ids + edges + invariants),
    (3) a purchased Ed25519 attestation ($199 standard / $499 enterprise — see brain_attest_*).

## Public /app/import endpoint (auth-free, deterministic, idempotent)

Free preview build. Same input bytes always produce the same brain_id + content_hash.
Request:
  POST ${SERVER_BASE_URL}/app/import
  content-type: application/json
  body: { "format": "verdigraph_genome" | "claude_project_export" | "openai_assistant" | "prompt_list" | "auto",
          "content": "<stringified agent JSON or newline-separated prompts>" }
Response (200):
  { "ok": true,
    "preview": { brain_id, brain_uri, content_hash, agent_name, node_count, edge_count,
                 node_ids[], edges[], sample_nodes[], llm_bindings, provenance, paywall },
    "invariants": { passed, checks: [{ id, description, passed, passed_with_default?, advisory?, detail? }] } }
Response headers include x-verdigraph-content-hash, x-verdigraph-brain-id, x-verdigraph-deterministic=1.

Curl example:
  curl -sS -X POST ${SERVER_BASE_URL}/app/import \
    -H 'content-type: application/json' \
    --data '{"format":"verdigraph_genome","content":"{\"agent_name\":\"x\",\"purpose\":\"y\",\"initial_nodes\":[\"a\"],\"fitness_metrics\":[\"task_success_rate\"]}"}' \
    | jq '.preview.brain_id, .preview.content_hash, .invariants.passed'

See ${SERVER_BASE_URL}/CANONICALIZATION.md for the exact canonical-JSON rule used to derive content_hash.

## Build session (live MCP pairing, optional)

The deterministic build path (POST /app/import) is the recommended way to construct
brains from code or CI. The interactive Build session is a SECOND path for cases
where a human watching the browser wants to see their own LLM agent operate the
build environment in real time via the brain_* MCP tools.

How it works:
  1. Open ${SERVER_BASE_URL}/app — a fresh build_session_id is minted automatically
     and a Crockford-base32 pairing code (format XXXX-XXXX) appears.
  2. The user pastes the pairing code into their LLM agent (Claude Desktop, Cowork,
     a custom client) so the agent can call brain_pair_session(pairing_code) over
     /mcp. After successful pair, the agent has a session_id it can include on
     subsequent brain_import / brain_evolve / brain_verify calls.
  3. Every tool call carrying that build_session_id emits start / result / error /
     invariant_report events onto an SSE stream the /app browser is already
     subscribed to at /app/sessions/:id/events. The browser renders the events as
     they happen — live tool-call log on the right, invariants flipping green/red,
     the central graph mutating as the agent evolves the brain.
  4. The session closes when the page closes or the agent calls a sessionClose tool.

When to use which:
  - Deterministic / CI / agent-only:   POST /app/import (auth-free, idempotent, fast)
  - Human-in-the-loop / demo / debug:  brain_pair_session + brain_* MCP tools
  - The same brain artifact is produced either way; pairing adds live observability
    rather than changing what gets built.

## For agents

- MCP endpoint (Streamable HTTP and SSE): ${SERVER_BASE_URL}/mcp
- Manifest (SEP-1960): ${SERVER_BASE_URL}/.well-known/mcp
- Server card (SEP-1649): ${SERVER_BASE_URL}/.well-known/mcp/server-card.json
- OAuth metadata: ${SERVER_BASE_URL}/.well-known/oauth-authorization-server

## Tools (${TOOLS.length})

${TOOLS.map(t => `- ${t.name}${t.metered ? "" : " (free)"} — ${t.summary}`).join("\n")}

## Connecting your agent (Claude Desktop / Claude Code / Cowork)

The full onboarding page with copy-paste install JSON and the 4-step "paid-to-using"
walkthrough lives at ${SERVER_BASE_URL}/connect. After paying at ${SERVER_BASE_URL}/credits,
the success page reuses the same onboarding flow with the credit code prepended.

Claude Desktop config snippet:
  { "mcpServers": { "verdigraph": { "type": "http", "url": "${SERVER_BASE_URL}/mcp" } } }

Claude Code one-liner:
  claude mcp add --transport http verdigraph ${SERVER_BASE_URL}/mcp

Cowork: Settings → Connectors → Add custom MCP server → paste ${SERVER_BASE_URL}/mcp.

All three clients drive OAuth 2.1 + PKCE on first tool call. The caller_id is minted
server-side at that point; the client stores the bearer token automatically.

## Buying API credits

Three paths, in increasing order of integration:

  (a) Anonymous purchase (no auth required):
        Open ${SERVER_BASE_URL}/credits → pick an amount → either supply your
        caller_id (credits land directly) OR leave blank + supply email and a
        single-use vdc_<24-char> code is minted. Redeem the code in your bot's
        first authenticated session via verdigraph_redeem_credit_code(code).

  (b) Authenticated topup (OAuth'd bot):
        Call verdigraph_create_topup_session(amount_usd) → returns a Stripe
        Checkout URL pre-bound to your caller_id. Hand to your human; on
        payment, credits land on your caller automatically.

  (c) Monthly auto-refill (OAuth'd bot):
        Call verdigraph_create_subscription(amount_usd: 20) → recurring
        Stripe subscription at the chosen monthly amount. Each invoice.paid
        credits your caller. Cancel any time; unused credits never expire.

INSUFFICIENT_CREDITS responses always carry topup_url + recommended_amount_usd
so error-handling code can surface the next step without guessing.

## Pricing

- Top-ups: $5–$500 via Stripe Checkout (livemode).
- Per-call routing fee: $${ROUTING_FEE_USD.toFixed(3)} USD, plus model passthrough at provider rates.
- Insufficient credits returns INSUFFICIENT_CREDITS — no charge taken.

## Repo

${REPO_URL}
`;
}

function renderLlmsFullTxt(): string {
  return renderLlmsTxt() + `\n## Long description\n\n${LONG_DESCRIPTION}\n`;
}

function renderRobotsTxt(): string {
  return `User-agent: *
Allow: /
Sitemap: ${SERVER_BASE_URL}/sitemap.xml
`;
}

function renderSitemap(): string {
  const urls = [
    "/",
    "/.well-known/mcp",
    "/.well-known/mcp/server-card.json",
    "/llms.txt",
  ];
  const today = new Date().toISOString().slice(0, 10);
  const body  = urls
    .map(u => `  <url><loc>${SERVER_BASE_URL}${u}</loc><lastmod>${today}</lastmod></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function renderIconSvg(): string {
  // Minimal Verdigraph mark — a developmental graph (3 nodes, 2 edges) on a verdigris field.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Verdigraph">
  <rect width="64" height="64" rx="12" fill="#0f3d2e"/>
  <line x1="16" y1="44" x2="32" y2="20" stroke="#7fd1b9" stroke-width="3" stroke-linecap="round"/>
  <line x1="32" y1="20" x2="48" y2="44" stroke="#7fd1b9" stroke-width="3" stroke-linecap="round"/>
  <circle cx="16" cy="44" r="6" fill="#7fd1b9"/>
  <circle cx="32" cy="20" r="6" fill="#bff0db"/>
  <circle cx="48" cy="44" r="6" fill="#7fd1b9"/>
</svg>`;
}

function renderLandingPage(): string {
  // Iter5 — website scrapped. The MCP service is the product. This stub exists
  // only so SEP-1960 manifest's homepage URL returns 200 + carries Schema.org
  // metadata for registry crawlers. All install + docs live in the GitHub README.
  const schemaOrg = JSON.stringify({
    "@context":   "https://schema.org",
    "@type":      "SoftwareSourceCode",
    "name":       "verdigraph-mcp",
    "description": SHORT_DESCRIPTION,
    "url":         HOMEPAGE_URL,
    "codeRepository": REPO_URL,
    "license":     `https://opensource.org/licenses/${LICENSE}`,
    "softwareVersion": SERVER_VERSION,
    "author":      { "@type": "Organization", "name": VENDOR_NAME, "url": VENDOR_URL },
    "programmingLanguage": "TypeScript",
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>verdigraph-mcp — secure private cognitive graphs (MCP service)</title>
<meta name="description" content="${escapeHtml(SHORT_DESCRIPTION)}"/>
<meta name="keywords" content="${KEYWORDS.join(", ")}"/>
<meta property="og:type"        content="website"/>
<meta property="og:title"       content="verdigraph-mcp"/>
<meta property="og:description" content="${escapeHtml(SHORT_DESCRIPTION)}"/>
<meta property="og:url"         content="${HOMEPAGE_URL}"/>
<link rel="canonical" href="${REPO_URL}"/>
<link rel="alternate" type="application/json" href="${SERVER_BASE_URL}/.well-known/mcp" title="SEP-1960 MCP manifest"/>
<link rel="alternate" type="text/plain"       href="${SERVER_BASE_URL}/llms.txt" title="llms.txt"/>
<link rel="alternate" type="application/yaml" href="${SERVER_BASE_URL}/openapi.yaml" title="OpenAPI 3.1 spec"/>
<link rel="icon" type="image/svg+xml" href="${SERVER_BASE_URL}/icon.svg"/>
<script type="application/ld+json">${schemaOrg}</script>
<style>
  body { margin:0; background:#0b0f0c; color:#e8f1ec; font:15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { max-width:680px; margin:0 auto; padding:64px 24px; }
  h1 { font-size:22px; letter-spacing:0.5px; margin:0 0 8px; }
  .lede { color:#9bb1a5; font-size:15px; margin:0 0 28px; }
  pre { background:#0a120d; border:1px solid #1f2a23; border-radius:6px; padding:12px 14px; font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-x:auto; }
  a { color:#7fd1b9; }
  ul { padding-left:20px; }
  li { margin:4px 0; }
</style>
</head>
<body>
<main>
  <h1>verdigraph-mcp</h1>
  <p class="lede">${escapeHtml(SHORT_DESCRIPTION)}</p>

  <p>This is the hosted MCP runtime. Install instructions, OAuth flow, API examples, and docs live in the GitHub repo:</p>

  <p><a href="${REPO_URL}">${REPO_URL}</a></p>

  <h3 style="font-size:14px; margin:24px 0 8px; color:#9bb1a5; text-transform:uppercase; letter-spacing:1px;">Quick connect</h3>
  <pre>claude mcp add --transport http verdigraph ${SERVER_BASE_URL}/mcp</pre>

  <h3 style="font-size:14px; margin:24px 0 8px; color:#9bb1a5; text-transform:uppercase; letter-spacing:1px;">Machine-readable surfaces</h3>
  <ul>
    <li><a href="${SERVER_BASE_URL}/mcp">${SERVER_BASE_URL}/mcp</a> — OAuth-gated MCP endpoint (Streamable HTTP + SSE)</li>
    <li><a href="${SERVER_BASE_URL}/.well-known/mcp">/.well-known/mcp</a> — SEP-1960 manifest</li>
    <li><a href="${SERVER_BASE_URL}/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a> — SEP-1649 server card</li>
    <li><a href="${SERVER_BASE_URL}/openapi.yaml">/openapi.yaml</a> — OpenAPI 3.1</li>
    <li><a href="${SERVER_BASE_URL}/CANONICALIZATION.md">/CANONICALIZATION.md</a> — brain.v1 deterministic-build spec</li>
    <li><a href="${SERVER_BASE_URL}/llms.txt">/llms.txt</a> — llmstxt.org agent-discovery summary</li>
  </ul>

  <p style="margin-top:32px; font-size:12px; color:#5b7268;">Version ${SERVER_VERSION} · License ${LICENSE} · Maintained by ${VENDOR_NAME}</p>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}
