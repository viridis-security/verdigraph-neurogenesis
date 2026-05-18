// src/auth/handler.ts — non-protected routes: OAuth consent UI, well-known, health.
//
// VERSION 0.2: actually wires `OAuthProvider.completeAuthorization` so the OAuth
// code flow completes and the McpAgent receives `props.callerId`. Identity model
// is anonymous-with-ULID-subject; GitHub OIDC sign-in lands in a later pass.

import { Hono } from "hono";
import { ulid } from "ulid";
import type { OAuthHelpers, AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../index";

// The OAuthProvider injects `env.OAUTH_PROVIDER` automatically when wired into
// Worker bindings. We re-declare it on the Hono Bindings shape for type-safety.
type AuthBindings = Env & { OAUTH_PROVIDER: OAuthHelpers };

type AuthEnv = { Bindings: AuthBindings };
const app = new Hono<AuthEnv>();

// ── landing page ────────────────────────────────────────────────────────
app.get("/", (c) =>
  c.html(`<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:32rem">
    <h1>Verdigraph MCP</h1>
    <p>Public compute-routing MCP for autonomous agents. 25% of net revenue funds Viridis conservation programs.</p>
    <ul>
      <li><a href="/.well-known/oauth-authorization-server">OAuth metadata</a></li>
      <li><code>POST /register</code> — dynamic client registration (MCP)</li>
      <li><code>GET /mcp</code> — MCP endpoint (OAuth required)</li>
      <li><code>GET /healthz</code> — health check</li>
    </ul>
  </body></html>`),
);

// ── health ──────────────────────────────────────────────────────────────
app.get("/healthz", async (c) => {
  try {
    const r = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json({ ok: r?.ok === 1, environment: c.env.ENVIRONMENT });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── OAuth 2.1 metadata (RFC 8414). Provider also serves this internally;
// this fallback lets the public root link to a stable path.
app.get("/.well-known/oauth-authorization-server", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    authorization_endpoint:        `${origin}/authorize`,
    token_endpoint:                `${origin}/token`,
    registration_endpoint:         `${origin}/register`,
    response_types_supported:      ["code"],
    grant_types_supported:         ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    scopes_supported: ["mcp:read", "mcp:write"],
  });
});

// ── Authorize: GET consent UI, POST completion ──────────────────────────
//
// GET parses the OAuth request, looks up the client, renders a consent page that
// posts back the encoded auth-request payload.
// POST mints the caller row, then calls OAUTH_PROVIDER.completeAuthorization
// to receive the redirectTo URL with ?code=... — the MCP client redeems at /token.

app.get("/authorize", async (c) => {
  const oauthReq: AuthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  if (!client) {
    return c.text(`Unknown OAuth client_id: ${oauthReq.clientId}`, 400);
  }

  // Round-trip the parsed auth request through the form body.
  const encoded = btoa(JSON.stringify(oauthReq));
  const clientName = (client.clientName ?? oauthReq.clientId).replace(/[<>&"']/g, "");
  const scope = (oauthReq.scope ?? []).join(", ") || "(default)";

  return c.html(`<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:32rem">
    <h2>Authorize Verdigraph MCP</h2>
    <p><strong>${clientName}</strong> is requesting access to call
       <code>verdigraph_*</code> tools on your behalf.</p>
    <p>Granting authorization creates a metered caller account. Each successful tool call
       is billed via Stripe at the published per-call routing fee plus model passthrough.
       25% of net revenue routes automatically to Viridis conservation programs.</p>
    <p><small>Requested scope: ${scope}</small></p>
    <form method="POST" action="/authorize">
      <input type="hidden" name="auth_request" value="${encoded}">
      <button type="submit" style="padding:0.5rem 1rem">Approve &amp; continue</button>
    </form>
  </body></html>`);
});

app.post("/authorize", async (c) => {
  const form = await c.req.formData();
  const encoded = form.get("auth_request");
  if (typeof encoded !== "string") {
    return c.text("Missing auth_request in form body", 400);
  }
  let oauthReq: AuthRequest;
  try {
    oauthReq = JSON.parse(atob(encoded)) as AuthRequest;
  } catch {
    return c.text("Malformed auth_request payload", 400);
  }

  // Mint (or fetch) the caller row. Anonymous-with-ULID-subject for v0.2.
  const subject  = `anon-${ulid()}`;
  const callerId = `cal_${ulid()}`;
  const now      = Date.now();

  await c.env.DB
    .prepare(
      `INSERT INTO callers (caller_id, display_name, oauth_subject, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (oauth_subject) DO NOTHING`,
    )
    .bind(callerId, "anonymous", subject, now)
    .run();

  const row = await c.env.DB
    .prepare(`SELECT caller_id, display_name, email FROM callers WHERE oauth_subject = ?1`)
    .bind(subject)
    .first<{ caller_id: string; display_name: string; email: string | null }>();

  const resolvedCaller = row?.caller_id ?? callerId;

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request:  oauthReq,
    userId:   resolvedCaller,
    metadata: {
      display_name:  row?.display_name ?? "anonymous",
      email:         row?.email ?? null,
      oauth_subject: subject,
    },
    scope:    oauthReq.scope ?? ["mcp:read", "mcp:write"],
    props:    { callerId: resolvedCaller },
  });

  return Response.redirect(redirectTo, 302);
});

export const authHandler = app;
