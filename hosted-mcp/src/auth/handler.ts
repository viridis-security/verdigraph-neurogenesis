// src/auth/handler.ts — non-protected routes: GitHub-OIDC sign-in, OAuth
// consent UI, well-known metadata, health.
//
// ── iter4 C1: real identity & account recovery ─────────────────────────────
// Invariant: two authorizations performed by the same human identity resolve
// to the SAME caller_id (and therefore the same credit balance). A caller who
// loses their token recovers their existing balance simply by re-authorizing.
//
// Identity is established by GitHub OIDC. The numeric, immutable GitHub user id
// becomes `oauth_subject = "github:" + githubUserId`, which is UNIQUE in the
// callers table. The authorize flow:
//
//   GET  /authorize           → stash the MCP AuthRequest in OAUTH_KV under a
//                               random state nonce, redirect to GitHub.
//   GET  /authorize/callback  → exchange the GitHub code, fetch the GitHub
//                               user, derive oauth_subject, render consent.
//   POST /authorize           → upsert the caller row by oauth_subject
//                               (ON CONFLICT DO UPDATE — a fresh caller_id is
//                               minted only when no row exists), then complete
//                               the OAuth code flow.
//
// The oauth_subject is NEVER round-tripped through the browser: it is derived
// server-side from GitHub and held in OAUTH_KV keyed by the state nonce, so a
// caller cannot forge another identity by editing a form field.
//
// Headless / non-interactive agents: the interactive consent flow is, by
// design, IdP-gated and cannot be completed without a browser. A separate
// API-key path for headless agents is documented in hosted-mcp/README.md
// ("Headless agents") and is intentionally NOT part of this interactive flow.

import { Hono } from "hono";
import { ulid } from "ulid";
import type { OAuthHelpers, AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../index";

type AuthBindings = Env & { OAUTH_PROVIDER: OAuthHelpers };
type AuthEnv = { Bindings: AuthBindings };
const app = new Hono<AuthEnv>();

// How long a half-finished authorization may sit in OAUTH_KV.
const AUTH_FLOW_TTL_SECONDS = 600; // 10 minutes
const kvKey = (nonce: string) => `vauth:${nonce}`;

interface PendingAuth {
  stage:       "pending" | "authenticated";
  authRequest: AuthRequest;
  clientName:  string;
  oauthSubject?: string;
  displayName?:  string;
  email?:        string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch),
  );
}

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
    // L4 (Phase 2) hardens error surfaces; keep the body generic even now.
    console.error("healthz DB check failed:", (err as Error).message);
    return c.json({ ok: false }, 500);
  }
});

// ── OAuth 2.1 metadata (RFC 8414) ───────────────────────────────────────
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

// ── GET /authorize — stash the AuthRequest, redirect to GitHub ───────────
app.get("/authorize", async (c) => {
  if (!c.env.GITHUB_OAUTH_CLIENT_ID || !c.env.GITHUB_OAUTH_CLIENT_SECRET) {
    return c.text("GitHub sign-in is not configured on this server.", 503);
  }

  const oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  if (!client) {
    return c.text(`Unknown OAuth client_id: ${oauthReq.clientId}`, 400);
  }

  // Stash the parsed MCP AuthRequest under a single-use state nonce.
  const nonce: string = crypto.randomUUID();
  const pending: PendingAuth = {
    stage: "pending",
    authRequest: oauthReq,
    clientName: client.clientName ?? oauthReq.clientId,
  };
  await c.env.OAUTH_KV.put(kvKey(nonce), JSON.stringify(pending), {
    expirationTtl: AUTH_FLOW_TTL_SECONDS,
  });

  const origin = new URL(c.req.url).origin;
  const ghUrl = new URL("https://github.com/login/oauth/authorize");
  ghUrl.searchParams.set("client_id", c.env.GITHUB_OAUTH_CLIENT_ID);
  ghUrl.searchParams.set("redirect_uri", `${origin}/authorize/callback`);
  ghUrl.searchParams.set("scope", "read:user");
  ghUrl.searchParams.set("state", nonce);
  ghUrl.searchParams.set("allow_signup", "true");
  return c.redirect(ghUrl.toString(), 302);
});

// ── GET /authorize/callback — exchange the GitHub code, render consent ───
app.get("/authorize/callback", async (c) => {
  const code  = c.req.query("code");
  const nonce = c.req.query("state");
  if (!code || !nonce) {
    return c.text("Missing code or state from the GitHub callback.", 400);
  }

  const raw = await c.env.OAUTH_KV.get(kvKey(nonce));
  if (!raw) {
    return c.text("Authorization session expired or invalid — restart the flow.", 400);
  }
  const saved = JSON.parse(raw) as PendingAuth;

  const origin = new URL(c.req.url).origin;
  let oauthSubject: string;
  let displayName: string;
  let email: string | null;
  try {
    const token = await exchangeGitHubCode(c.env, code, `${origin}/authorize/callback`);
    const user  = await fetchGitHubUser(token);
    // The numeric GitHub id is immutable — a username can be changed, the id
    // cannot — so it is the stable basis for identity.
    oauthSubject = `github:${user.id}`;
    displayName  = user.login;
    email        = user.email;
  } catch (err) {
    console.error("GitHub sign-in failed:", (err as Error).message);
    return c.text("GitHub sign-in failed — please restart authorization.", 502);
  }

  const authenticated: PendingAuth = {
    stage: "authenticated",
    authRequest: saved.authRequest,
    clientName:  saved.clientName,
    oauthSubject,
    displayName,
    email,
  };
  await c.env.OAUTH_KV.put(kvKey(nonce), JSON.stringify(authenticated), {
    expirationTtl: AUTH_FLOW_TTL_SECONDS,
  });

  return c.html(renderConsentPage(nonce, displayName, saved.clientName, saved.authRequest.scope ?? []));
});

// ── POST /authorize — upsert the caller, complete the OAuth code flow ────
app.post("/authorize", async (c) => {
  const form  = await c.req.formData();
  const nonce = form.get("state");
  if (typeof nonce !== "string") {
    return c.text("Missing state in form body.", 400);
  }

  const raw = await c.env.OAUTH_KV.get(kvKey(nonce));
  if (!raw) {
    return c.text("Authorization session expired — restart the flow.", 400);
  }
  const saved = JSON.parse(raw) as PendingAuth;
  if (saved.stage !== "authenticated" || !saved.oauthSubject) {
    return c.text("Sign in with GitHub before approving.", 400);
  }
  // Single-use: consume the nonce so the consent cannot be replayed.
  await c.env.OAUTH_KV.delete(kvKey(nonce));

  const now = Date.now();
  // Mint a caller_id only when this identity has never been seen. ON CONFLICT
  // on the UNIQUE oauth_subject column means a returning identity keeps its
  // original caller_id — that is account recovery.
  const freshCallerId = `cal_${ulid()}`;
  await c.env.DB
    .prepare(
      `INSERT INTO callers (caller_id, display_name, oauth_subject, email, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (oauth_subject) DO UPDATE SET
         updated_at   = excluded.updated_at,
         display_name = excluded.display_name,
         email        = excluded.email`,
    )
    .bind(freshCallerId, saved.displayName ?? "github-user", saved.oauthSubject, saved.email ?? null, now)
    .run();

  const row = await c.env.DB
    .prepare(`SELECT caller_id, display_name, email FROM callers WHERE oauth_subject = ?1`)
    .bind(saved.oauthSubject)
    .first<{ caller_id: string; display_name: string; email: string | null }>();
  if (!row) {
    console.error("caller row missing after upsert for", saved.oauthSubject);
    return c.text("Account provisioning failed — please retry.", 500);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: saved.authRequest,
    userId:  row.caller_id,
    metadata: {
      display_name:  row.display_name,
      email:         row.email,
      oauth_subject: saved.oauthSubject,
    },
    scope: saved.authRequest.scope ?? ["mcp:read", "mcp:write"],
    props: { callerId: row.caller_id },
  });

  return Response.redirect(redirectTo, 302);
});

// ── GitHub OIDC helpers ─────────────────────────────────────────────────

async function exchangeGitHubCode(env: AuthBindings, code: string, redirectUri: string): Promise<string> {
  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id:     env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri:  redirectUri,
    }),
  });
  if (!resp.ok) throw new Error(`github_token_exchange_http_${resp.status}`);
  const data = (await resp.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`github_token_exchange_failed:${data.error ?? "no_token"}`);
  return data.access_token;
}

async function fetchGitHubUser(token: string): Promise<{ id: number; login: string; email: string | null }> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept:        "application/vnd.github+json",
      "user-agent":  "verdigraph-mcp",
    },
  });
  if (!resp.ok) throw new Error(`github_user_http_${resp.status}`);
  const u = (await resp.json()) as { id?: number; login?: string; email?: string | null };
  if (typeof u.id !== "number") throw new Error("github_user_missing_id");
  return { id: u.id, login: String(u.login ?? `user-${u.id}`), email: u.email ?? null };
}

function renderConsentPage(nonce: string, githubLogin: string, clientName: string, scope: string[]): string {
  const safeLogin  = escapeHtml(githubLogin);
  const safeClient = escapeHtml(clientName);
  const safeScope  = escapeHtml(scope.join(", ") || "(default)");
  return `<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:32rem">
    <h2>Authorize Verdigraph MCP</h2>
    <p>Signed in as <strong>${safeLogin}</strong> (GitHub).</p>
    <p><strong>${safeClient}</strong> is requesting access to call
       <code>verdigraph_*</code> tools on your behalf.</p>
    <p>Granting authorization binds this client to your metered caller account.
       Each successful tool call is billed via Stripe at the published per-call
       routing fee plus model passthrough. 25% of net revenue routes
       automatically to Viridis conservation programs.</p>
    <p>If you have authorized before, your existing balance is reattached —
       this is how you recover an account after losing a token.</p>
    <p><small>Requested scope: ${safeScope}</small></p>
    <form method="POST" action="/authorize">
      <input type="hidden" name="state" value="${escapeHtml(nonce)}">
      <button type="submit" style="padding:0.5rem 1rem">Approve &amp; continue</button>
    </form>
  </body></html>`;
}

export const authHandler = app;
