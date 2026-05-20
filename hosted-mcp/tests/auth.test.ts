// tests/auth.test.ts — iter4 C1: real GitHub-OIDC authentication & account
// recovery.
//
// Invariant under test: two authorizations performed by the SAME human
// identity resolve to the same caller_id; a DIFFERENT identity resolves to a
// different caller_id. The GitHub token/userinfo HTTP calls are mocked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authHandler } from "../src/auth/handler";
import { D1Shim } from "./helpers/d1";

// ── In-memory fakes for the Worker bindings ────────────────────────────────
class FakeKV {
  store = new Map<string, string>();
  async get(k: string): Promise<string | null> { return this.store.get(k) ?? null; }
  async put(k: string, v: string): Promise<void> { this.store.set(k, v); }
  async delete(k: string): Promise<void> { this.store.delete(k); }
}

interface CompleteCall { userId: string; props: { callerId: string }; oauthSubject: unknown }

function makeEnv(): { env: any; completeCalls: CompleteCall[] } {
  const completeCalls: CompleteCall[] = [];
  const env = {
    DB: new D1Shim(),
    OAUTH_KV: new FakeKV(),
    ENVIRONMENT: "test",
    GITHUB_OAUTH_CLIENT_ID: "gh_client_id",
    GITHUB_OAUTH_CLIENT_SECRET: "gh_client_secret",
    OAUTH_PROVIDER: {
      parseAuthRequest: async (req: Request) => {
        const u = new URL(req.url);
        return {
          clientId:            u.searchParams.get("client_id") ?? "client-test",
          redirectUri:         u.searchParams.get("redirect_uri") ?? "https://client.example/cb",
          scope:               ["mcp:read", "mcp:write"],
          state:               u.searchParams.get("state") ?? "mcp-state",
          codeChallenge:       u.searchParams.get("code_challenge") ?? "challenge",
          codeChallengeMethod: "S256",
          responseType:        "code",
        };
      },
      lookupClient: async (clientId: string) => ({
        clientId, clientName: "Test MCP Client", redirectUris: ["https://client.example/cb"],
      }),
      completeAuthorization: async (opts: any) => {
        completeCalls.push({
          userId: opts.userId,
          props: opts.props,
          oauthSubject: opts.metadata?.oauth_subject,
        });
        return { redirectTo: `${opts.request.redirectUri}?code=authcode_${opts.userId}` };
      },
    },
  };
  return { env, completeCalls };
}

// ── GitHub HTTP mock ───────────────────────────────────────────────────────
function installGitHubMock(user: { id: number; login: string; email?: string | null }): void {
  (globalThis as any).fetch = async (input: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("github.com/login/oauth/access_token")) {
      return new Response(
        JSON.stringify({ access_token: `tok_${user.id}`, token_type: "bearer", scope: "read:user" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("api.github.com/user")) {
      return new Response(
        JSON.stringify({ id: user.id, login: user.login, email: user.email ?? null, name: user.login }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
}

const ORIGIN = "https://verdigraph.dev";

/** Drive the full authorize → callback → complete flow once. Returns caller_id. */
async function runAuthFlow(env: any, user: { id: number; login: string; email?: string | null }): Promise<string> {
  installGitHubMock(user);

  // 1. GET /authorize → 302 to GitHub, carrying our state nonce.
  const r1 = await authHandler.fetch(
    new Request(`${ORIGIN}/authorize?response_type=code&client_id=c1&redirect_uri=${encodeURIComponent("https://client.example/cb")}&code_challenge=abc&state=mcp-state`),
    env,
  );
  expect(r1.status).toBe(302);
  const ghUrl = new URL(r1.headers.get("location")!);
  expect(ghUrl.origin + ghUrl.pathname).toBe("https://github.com/login/oauth/authorize");
  const nonce = ghUrl.searchParams.get("state")!;
  expect(nonce).toBeTruthy();

  // 2. GET /authorize/callback → 200 consent page for the authenticated user.
  const r2 = await authHandler.fetch(
    new Request(`${ORIGIN}/authorize/callback?code=ghcode&state=${encodeURIComponent(nonce)}`),
    env,
  );
  expect(r2.status).toBe(200);
  const html = await r2.text();
  expect(html).toContain(user.login);     // consent page shows the GitHub login
  expect(html).toContain(nonce);          // and carries the state forward

  // 3. POST /authorize → 302 back to the MCP client with an auth code.
  const r3 = await authHandler.fetch(
    new Request(`${ORIGIN}/authorize`, {
      method: "POST",
      body: new URLSearchParams({ state: nonce }),
    }),
    env,
  );
  expect(r3.status).toBe(302);

  const row = env.DB.raw()
    .prepare("SELECT caller_id FROM callers WHERE oauth_subject = ?")
    .get(`github:${user.id}`) as { caller_id: string } | undefined;
  expect(row).toBeTruthy();
  return row!.caller_id;
}

describe("C1 — GitHub-OIDC authentication & account recovery", () => {
  let savedFetch: typeof fetch;
  beforeEach(() => { savedFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = savedFetch; });

  it("the same GitHub identity resolves to the same caller_id on every authorization", async () => {
    const { env, completeCalls } = makeEnv();
    const user = { id: 4242, login: "octocat", email: "octocat@example.com" };

    const first  = await runAuthFlow(env, user);
    const second = await runAuthFlow(env, user);

    expect(first).toBe(second);
    // Exactly one caller row exists for that identity — no duplicate accounts.
    const count = env.DB.raw()
      .prepare("SELECT COUNT(*) AS n FROM callers WHERE oauth_subject = ?")
      .get("github:4242") as { n: number };
    expect(count.n).toBe(1);
    // completeAuthorization received the stable caller_id both times.
    expect(completeCalls.length).toBe(2);
    expect(completeCalls[0]!.props.callerId).toBe(first);
    expect(completeCalls[1]!.props.callerId).toBe(first);
  });

  it("a different GitHub identity resolves to a different caller_id", async () => {
    const { env } = makeEnv();
    const alice = await runAuthFlow(env, { id: 1001, login: "alice" });
    const bob   = await runAuthFlow(env, { id: 2002, login: "bob" });

    expect(alice).not.toBe(bob);
    const callers = env.DB.raw().prepare("SELECT COUNT(*) AS n FROM callers").get() as { n: number };
    expect(callers.n).toBe(2);
  });

  it("account recovery: re-authorizing after 'losing a token' reattaches the original caller_id", async () => {
    // The credit balance is keyed by caller_id; a returning identity must land
    // on the same caller_id so its balance is recovered.
    const { env } = makeEnv();
    const user = { id: 7, login: "returning-user" };

    const original = await runAuthFlow(env, user);
    // Simulate a balance accrued under that caller_id.
    env.DB.raw()
      .prepare("INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at) VALUES (?, ?, ?)")
      .run(original, 25_000_000, Date.now());

    const recovered = await runAuthFlow(env, user);
    expect(recovered).toBe(original);
    const bal = env.DB.raw()
      .prepare("SELECT balance_usd_micros AS b FROM credit_balances WHERE caller_id = ?")
      .get(recovered) as { b: number };
    expect(bal.b).toBe(25_000_000); // balance still attached
  });

  it("GET /authorize is rejected when GitHub sign-in is not configured", async () => {
    const { env } = makeEnv();
    delete env.GITHUB_OAUTH_CLIENT_ID;
    const r = await authHandler.fetch(
      new Request(`${ORIGIN}/authorize?response_type=code&client_id=c1&redirect_uri=https://client.example/cb`),
      env,
    );
    expect(r.status).toBe(503);
  });

  it("POST /authorize refuses a state nonce that never completed GitHub sign-in", async () => {
    // A forged/never-authenticated nonce cannot mint a fundable account.
    const { env } = makeEnv();
    const r = await authHandler.fetch(
      new Request(`${ORIGIN}/authorize`, {
        method: "POST",
        body: new URLSearchParams({ state: "forged-nonce" }),
      }),
      env,
    );
    expect(r.status).toBe(400);
    const count = env.DB.raw().prepare("SELECT COUNT(*) AS n FROM callers").get() as { n: number };
    expect(count.n).toBe(0); // no account created
  });

  it("a consumed state nonce cannot be replayed", async () => {
    const { env } = makeEnv();
    installGitHubMock({ id: 9, login: "single-use" });
    const r1 = await authHandler.fetch(
      new Request(`${ORIGIN}/authorize?response_type=code&client_id=c1&redirect_uri=https://client.example/cb&state=mcp-state`),
      env,
    );
    const nonce = new URL(r1.headers.get("location")!).searchParams.get("state")!;
    await authHandler.fetch(new Request(`${ORIGIN}/authorize/callback?code=x&state=${nonce}`), env);
    const ok = await authHandler.fetch(
      new Request(`${ORIGIN}/authorize`, { method: "POST", body: new URLSearchParams({ state: nonce }) }), env,
    );
    expect(ok.status).toBe(302);
    // Second POST with the same nonce — already consumed.
    const replay = await authHandler.fetch(
      new Request(`${ORIGIN}/authorize`, { method: "POST", body: new URLSearchParams({ state: nonce }) }), env,
    );
    expect(replay.status).toBe(400);
  });
});
