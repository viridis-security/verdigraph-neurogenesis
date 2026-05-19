// tests/discovery.test.ts — Verify public discovery surface for verdigraph-mcp.
//
// Invariants:
//  1. All discovery routes return 200 with the correct content-type.
//  2. None require OAuth — the handler is pure and env-independent.
//  3. SEP-1960 manifest contains required keys and the tool count matches manifest.ts.
//  4. SEP-1649 server card lists every tool registered in manifest.TOOLS.
//  5. /llms.txt and the landing page embed the live MCP URL so agents/crawlers
//     can find the endpoint from any discovery surface.
//  6. HEAD returns headers without body.
//  7. OPTIONS preflight returns 204 + CORS headers.
//  8. Unknown paths return null (so the OAuth pipeline still handles them).
//  9. Sitemap is valid XML.

import { describe, expect, it } from "vitest";
import { tryHandleDiscovery } from "../src/discovery/handlers";
import { TOOLS, SERVER_BASE_URL, buildSep1960Manifest, buildServerCard } from "../src/discovery/manifest";

const BASE = SERVER_BASE_URL; // matches the canonical live URL the manifest advertises

function GET(path: string): Request {
  return new Request(`${BASE}${path}`, { method: "GET" });
}
function HEAD(path: string): Request {
  return new Request(`${BASE}${path}`, { method: "HEAD" });
}
function OPTIONS(path: string): Request {
  return new Request(`${BASE}${path}`, { method: "OPTIONS" });
}

describe("discovery handler — routing", () => {
  it("returns null for unknown paths (so OAuth pipeline still runs)", () => {
    expect(tryHandleDiscovery(GET("/mcp"))).toBeNull();
    expect(tryHandleDiscovery(GET("/authorize"))).toBeNull();
    expect(tryHandleDiscovery(GET("/register"))).toBeNull();
    expect(tryHandleDiscovery(GET("/token"))).toBeNull();
    expect(tryHandleDiscovery(GET("/stripe/webhook"))).toBeNull();
    expect(tryHandleDiscovery(GET("/random-thing"))).toBeNull();
  });

  it("returns null for non-GET non-HEAD non-OPTIONS methods", () => {
    const post = new Request(`${BASE}/.well-known/mcp`, { method: "POST" });
    expect(tryHandleDiscovery(post)).toBeNull();
  });

  it("does not touch the OAuth metadata endpoint (owned by OAuth provider)", () => {
    expect(tryHandleDiscovery(GET("/.well-known/oauth-authorization-server"))).toBeNull();
  });
});

describe("discovery handler — landing /", () => {
  it("returns 200 HTML with OG + Schema.org markup and the Claude install JSON", async () => {
    const resp = tryHandleDiscovery(GET("/"))!;
    expect(resp).not.toBeNull();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    const body = await resp.text();
    expect(body).toContain("verdigraph-mcp");
    expect(body).toContain('og:title');
    expect(body).toContain('application/ld+json');
    expect(body).toMatch(/"@type":\s*"SoftwareApplication"/);
    expect(body).toContain(`${SERVER_BASE_URL}/mcp`); // Add-to-Claude JSON has the live URL
    expect(body).toContain(`/.well-known/mcp`);       // discovery surface advertised
  });
});

describe("discovery handler — /.well-known/mcp (SEP-1960)", () => {
  it("returns 200 JSON manifest with all required top-level keys", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp"))!;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("application/json");
    const m = await resp.json() as ReturnType<typeof buildSep1960Manifest>;
    for (const k of ["schema_version","server","endpoints","capabilities","authentication","pricing","security_policies","categories","keywords"]) {
      expect(m).toHaveProperty(k);
    }
  });

  it("advertises both streamable_http and sse transports at /mcp", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp"))!;
    const m    = await resp.json() as any;
    const transports = m.endpoints.map((e: any) => e.transport);
    expect(transports).toEqual(expect.arrayContaining(["streamable_http", "sse"]));
    for (const e of m.endpoints) expect(e.url).toBe(`${SERVER_BASE_URL}/mcp`);
  });

  it("tool counts match manifest.TOOLS", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp"))!;
    const m    = await resp.json() as any;
    expect(m.capabilities.tools.count).toBe(TOOLS.length);
    expect(m.capabilities.tools.free).toBe(TOOLS.filter(t => !t.metered).length);
    expect(m.capabilities.tools.metered).toBe(TOOLS.filter(t => t.metered).length);
  });

  it("pricing reflects 25% conservation share (1/4) and the routing fee", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp"))!;
    const m    = await resp.json() as any;
    expect(m.pricing.conservation_share.numerator).toBe(1);
    expect(m.pricing.conservation_share.denominator).toBe(4);
    expect(m.pricing.routing_fee_usd).toBeCloseTo(0.002, 5);
    expect(m.pricing.topup_min_usd).toBe(5);
    expect(m.pricing.topup_max_usd).toBe(500);
  });

  it("also serves /.well-known/mcp.json as an alias", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp.json"))!;
    expect(resp.status).toBe(200);
    const m = await resp.json() as any;
    expect(m.server.name).toBe("verdigraph-mcp");
  });
});

describe("discovery handler — /.well-known/mcp/server-card.json (SEP-1649)", () => {
  it("returns 200 JSON listing every tool with summary + metered flag", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp/server-card.json"))!;
    expect(resp.status).toBe(200);
    const card = await resp.json() as ReturnType<typeof buildServerCard>;
    expect(card.tools.length).toBe(TOOLS.length);
    for (const t of TOOLS) {
      const entry = card.tools.find(x => x.name === t.name);
      expect(entry).toBeDefined();
      expect(entry!.metered).toBe(t.metered);
    }
  });

  it("exposes a one-click Claude Desktop install block pointing at /mcp", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp/server-card.json"))!;
    const card = await resp.json() as any;
    expect(card.install.claude_desktop.url).toBe(`${SERVER_BASE_URL}/mcp`);
    expect(card.install.claude_code.cmd).toContain(`${SERVER_BASE_URL}/mcp`);
  });
});

describe("discovery handler — /llms.txt", () => {
  it("returns 200 plaintext referencing the MCP endpoint and SEP manifest", async () => {
    const resp = tryHandleDiscovery(GET("/llms.txt"))!;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/plain");
    const body = await resp.text();
    expect(body).toContain(`${SERVER_BASE_URL}/mcp`);
    expect(body).toContain(`/.well-known/mcp`);
    expect(body).toContain("Pricing");
    expect(body).toContain(`${TOOLS.length}`);
  });

  it("also serves /llms-full.txt with long description", async () => {
    const resp = tryHandleDiscovery(GET("/llms-full.txt"))!;
    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toContain("Long description");
  });
});

describe("discovery handler — /robots.txt + /sitemap.xml + /icon.svg", () => {
  it("/robots.txt allows everything and points at the sitemap", async () => {
    const resp = tryHandleDiscovery(GET("/robots.txt"))!;
    expect(resp.status).toBe(200);
    const body = await resp.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain(`Sitemap: ${SERVER_BASE_URL}/sitemap.xml`);
  });

  it("/sitemap.xml is valid XML with the canonical URLs", async () => {
    const resp = tryHandleDiscovery(GET("/sitemap.xml"))!;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("application/xml");
    const body = await resp.text();
    expect(body).toContain('<?xml');
    expect(body).toContain(`${SERVER_BASE_URL}/.well-known/mcp`);
    expect(body).toContain(`${SERVER_BASE_URL}/llms.txt`);
  });

  it("/icon.svg returns SVG image", async () => {
    const resp = tryHandleDiscovery(GET("/icon.svg"))!;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("image/svg+xml");
    const body = await resp.text();
    expect(body).toContain("<svg");
  });
});

describe("discovery handler — HEAD + OPTIONS", () => {
  it("HEAD returns 200 with headers and no body", async () => {
    const resp = tryHandleDiscovery(HEAD("/.well-known/mcp"))!;
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("application/json");
    const body = await resp.text();
    expect(body).toBe("");
  });

  it("OPTIONS on /.well-known/mcp returns 204 with CORS allow-origin: *", () => {
    const resp = tryHandleDiscovery(OPTIONS("/.well-known/mcp"))!;
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS on /llms.txt returns 204 with CORS allow-origin: *", () => {
    const resp = tryHandleDiscovery(OPTIONS("/llms.txt"))!;
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("discovery handler — caching", () => {
  it("/.well-known/mcp is cacheable", async () => {
    const resp = tryHandleDiscovery(GET("/.well-known/mcp"))!;
    expect(resp.headers.get("cache-control")).toMatch(/public.*max-age=\d+/);
  });

  it("/llms.txt is cacheable", async () => {
    const resp = tryHandleDiscovery(GET("/llms.txt"))!;
    expect(resp.headers.get("cache-control")).toMatch(/public.*max-age=\d+/);
  });
});
