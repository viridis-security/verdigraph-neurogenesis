// src/discovery/handlers.ts — public discovery surface for verdigraph-mcp.
//
// Returns a Response if the request path matches a discovery route, or null
// to indicate the OAuth/MCP pipeline should handle it. All endpoints are
// public (no OAuth required) and cacheable.

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
Pay per call in USD via Stripe Checkout. ${CONSERVATION_NUMERATOR * 100 / CONSERVATION_DENOMINATOR}% of net revenue is routed to verified conservation programs.

## For agents

- MCP endpoint (Streamable HTTP and SSE): ${SERVER_BASE_URL}/mcp
- Manifest (SEP-1960): ${SERVER_BASE_URL}/.well-known/mcp
- Server card (SEP-1649): ${SERVER_BASE_URL}/.well-known/mcp/server-card.json
- OAuth metadata: ${SERVER_BASE_URL}/.well-known/oauth-authorization-server

## Tools (${TOOLS.length})

${TOOLS.map(t => `- ${t.name}${t.metered ? "" : " (free)"} — ${t.summary}`).join("\n")}

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
  const claudeMcpJson = JSON.stringify({
    mcpServers: {
      verdigraph: { type: "http", url: `${SERVER_BASE_URL}/mcp` },
    },
  }, null, 2);

  const schemaOrg = JSON.stringify({
    "@context":   "https://schema.org",
    "@type":      "SoftwareApplication",
    "name":       "verdigraph-mcp",
    "description": SHORT_DESCRIPTION,
    "url":         HOMEPAGE_URL,
    "applicationCategory": "DeveloperApplication",
    "operatingSystem":     "Cloudflare Workers (hosted)",
    "softwareVersion":     SERVER_VERSION,
    "license":             `https://opensource.org/licenses/${LICENSE}`,
    "author":              { "@type": "Organization", "name": VENDOR_NAME },
    "offers": {
      "@type":    "Offer",
      "price":    String(ROUTING_FEE_USD),
      "priceCurrency": "USD",
      "category": "PerCallRoutingFee",
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>verdigraph-mcp — paid hosted MCP for agent-to-agent compute routing</title>
<meta name="description" content="${escapeHtml(SHORT_DESCRIPTION)}"/>
<meta name="keywords" content="${CATEGORIES.join(", ")}"/>

<!-- OpenGraph -->
<meta property="og:type"        content="website"/>
<meta property="og:site_name"   content="verdigraph-mcp"/>
<meta property="og:title"       content="verdigraph-mcp — paid hosted MCP"/>
<meta property="og:description" content="${escapeHtml(SHORT_DESCRIPTION)}"/>
<meta property="og:url"         content="${HOMEPAGE_URL}"/>
<meta property="og:image"       content="${SERVER_BASE_URL}/icon.svg"/>

<!-- Twitter -->
<meta name="twitter:card"        content="summary"/>
<meta name="twitter:title"       content="verdigraph-mcp"/>
<meta name="twitter:description" content="${escapeHtml(SHORT_DESCRIPTION)}"/>

<!-- Discovery hints for bots -->
<link rel="manifest"  href="${SERVER_BASE_URL}/.well-known/mcp"/>
<link rel="alternate" type="application/json" href="${SERVER_BASE_URL}/.well-known/mcp/server-card.json" title="MCP server card"/>
<link rel="alternate" type="text/plain"       href="${SERVER_BASE_URL}/llms.txt" title="llms.txt"/>
<link rel="icon"      type="image/svg+xml"    href="${SERVER_BASE_URL}/icon.svg"/>

<script type="application/ld+json">${schemaOrg}</script>

<style>
  :root { --bg:#0f3d2e; --fg:#e8f5ef; --mute:#9bcfba; --accent:#7fd1b9; --pad: clamp(20px, 4vw, 48px); }
  * { box-sizing: border-box; }
  body { margin:0; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width: 860px; margin: 0 auto; padding: var(--pad); }
  h1 { font-size: clamp(28px, 5vw, 44px); margin: 0 0 8px; letter-spacing: -0.02em; }
  h2 { font-size: 20px; margin: 32px 0 8px; color: var(--accent); }
  p, li { color: var(--fg); }
  .lede { color: var(--mute); font-size: clamp(16px, 2.2vw, 19px); margin: 4px 0 24px; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #0a2a20; border: 1px solid #1f5942; border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 13px; }
  a { color: var(--accent); }
  ul { padding-left: 20px; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; margin: 8px 0 16px; }
  .pill { font-size: 11px; padding: 4px 10px; border:1px solid var(--accent); border-radius: 999px; color: var(--accent); }
  .meta { color: var(--mute); font-size: 13px; }
  hr { border: none; border-top: 1px solid #1f5942; margin: 32px 0; }
</style>
</head>
<body>
<main>
  <h1>verdigraph-mcp</h1>
  <p class="lede">${escapeHtml(SHORT_DESCRIPTION)}</p>
  <div class="pills">${CATEGORIES.map(c => `<span class="pill">${c}</span>`).join("")}</div>

  <h2>Add to Claude Desktop (one-click JSON)</h2>
  <pre><code>${escapeHtml(claudeMcpJson)}</code></pre>

  <h2>Add to Claude Code</h2>
  <pre><code>claude mcp add --transport http verdigraph ${SERVER_BASE_URL}/mcp</code></pre>

  <h2>For autonomous agents</h2>
  <ul>
    <li>MCP endpoint (Streamable HTTP &amp; SSE): <a href="${SERVER_BASE_URL}/mcp"><code>${SERVER_BASE_URL}/mcp</code></a></li>
    <li>SEP-1960 manifest: <a href="${SERVER_BASE_URL}/.well-known/mcp"><code>/.well-known/mcp</code></a></li>
    <li>SEP-1649 server card: <a href="${SERVER_BASE_URL}/.well-known/mcp/server-card.json"><code>/.well-known/mcp/server-card.json</code></a></li>
    <li>llms.txt: <a href="${SERVER_BASE_URL}/llms.txt"><code>/llms.txt</code></a></li>
    <li>OAuth metadata: <a href="${SERVER_BASE_URL}/.well-known/oauth-authorization-server"><code>/.well-known/oauth-authorization-server</code></a></li>
  </ul>

  <h2>Pricing</h2>
  <ul>
    <li>Top-ups: <strong>$5–$500</strong> via Stripe Checkout (USD, livemode).</li>
    <li>Per-call routing fee: <strong>$${ROUTING_FEE_USD.toFixed(3)}</strong>, plus model passthrough at provider rates.</li>
    <li>Insufficient credits returns <code>INSUFFICIENT_CREDITS</code> with no charge taken.</li>
  </ul>

  <h2>Conservation commitment (binding)</h2>
  <p><strong>${CONSERVATION_NUMERATOR * 100 / CONSERVATION_DENOMINATOR}% of net revenue</strong> (gross minus model passthrough) is committed to verified Viridis conservation programs. A monthly cron writes payouts into a public auditable ledger.</p>

  <h2>Tools (${TOOLS.length})</h2>
  <ul>
    ${TOOLS.map(t => `<li><code>${t.name}</code>${t.metered ? "" : " <span class=\"meta\">(free)</span>"} — ${escapeHtml(t.summary)}</li>`).join("\n    ")}
  </ul>

  <hr/>
  <p class="meta">Source: <a href="${REPO_URL}">${REPO_URL}</a> · License: ${LICENSE} · v${SERVER_VERSION}</p>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}
