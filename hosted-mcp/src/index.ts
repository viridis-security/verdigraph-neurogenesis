// src/index.ts — Worker entrypoint for verdigraph-mcp (hosted).

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { authHandler }     from "./auth/handler";
import { VerdigraphAgent } from "./mcp/agent";
import { runMonthlyConservationCron } from "./billing/conservation";
import { tryHandleDiscovery } from "./discovery/handlers";
import { handleConservationPublic, handleConservationBadge } from "./discovery/conservation";

export interface Env {
  DB:                D1Database;
  OAUTH_KV:          KVNamespace;
  STATE_BUCKET:      R2Bucket;
  VERDIGRAPH_AGENT:  DurableObjectNamespace;

  // Injected by OAuthProvider.
  OAUTH_PROVIDER:    OAuthHelpers;

  STRIPE_SECRET_KEY?:        string;
  STRIPE_WEBHOOK_SECRET?:    string;
  STRIPE_METER_EVENT_NAME?:  string;
  ANTHROPIC_API_KEY?:        string;
  CONSERVATION_RECIPIENT?:   string;
  ENVIRONMENT:               string;
  ROUTING_FEE_USD_MICROS:    string;
  CONSERVATION_RATIO_NUM:    string;
  CONSERVATION_RATIO_DEN:    string;
}

export { VerdigraphAgent };

// McpAgent.serve returns a { fetch } handler. transport: "auto" accepts both
// Streamable HTTP (modern clients, MCP Inspector) and legacy SSE.
const mcpApiHandler = (VerdigraphAgent as any).serve("/mcp", { binding: "VERDIGRAPH_AGENT", transport: "auto" });

const oauthProvider = new OAuthProvider({
  apiRoute:                   "/mcp",
  apiHandler:                 mcpApiHandler,
  defaultHandler:             authHandler as any,
  authorizeEndpoint:          "/authorize",
  tokenEndpoint:              "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Stripe webhook bypasses OAuth and discovery — signature-verified inside the handler.
    if (url.pathname === "/stripe/webhook") {
      const { handleStripeWebhook } = await import("./billing/webhook");
      return handleStripeWebhook(request, env);
    }

    // Public conservation transparency endpoints — read-only D1 aggregates, no OAuth.
    if (url.pathname === "/conservation/public" && (request.method === "GET" || request.method === "HEAD")) {
      return handleConservationPublic(env);
    }
    if (url.pathname === "/conservation/badge.svg" && (request.method === "GET" || request.method === "HEAD")) {
      return handleConservationBadge(env);
    }

    // Iter3 P1.3 — conservation drill-downs.
    if (url.pathname === "/conservation/public/months" && (request.method === "GET" || request.method === "HEAD")) {
      const { handleMonths } = await import("./discovery/conservation_drilldowns");
      return handleMonths(env);
    }
    if (url.pathname === "/conservation/public/brains" && (request.method === "GET" || request.method === "HEAD")) {
      const { handleBrains } = await import("./discovery/conservation_drilldowns");
      return handleBrains(env);
    }
    if (url.pathname === "/conservation/public/payouts" && (request.method === "GET" || request.method === "HEAD")) {
      const { handlePayouts } = await import("./discovery/conservation_drilldowns");
      return handlePayouts(env);
    }
    // Iter5 — /credits HTML scrapped; POST /credits/checkout remains as the credits API.
    if (url.pathname === "/credits/checkout" && request.method === "POST") {
      const { createCreditsCheckout } = await import("./billing/credits_page");
      try {
        const body = await request.json() as {
          amount_usd: number;
          caller_id?: string;
          buyer_email?: string;
          is_subscription?: boolean;
          success_url?: string;
          cancel_url?: string;
        };
        const out = await createCreditsCheckout(env, {
          amountUsd: body.amount_usd,
          callerId: body.caller_id ?? null,
          buyerEmail: body.buyer_email ?? null,
          isSubscription: !!body.is_subscription,
          successUrl: body.success_url,
          cancelUrl: body.cancel_url,
        });
        return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: (e as Error).message }), { status: 400, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
      }
    }
    // Iter5 — /credits/success, /connect HTML pages scrapped.
    // Stripe success_url now points at the GitHub README's "After payment" anchor.
    // For backward compat with already-emitted Stripe success URLs (e.g. Justin's $10),
    // /credits/success returns a JSON envelope with the code (if any) and a pointer
    // to the README; agents/bots can still parse it without rendering HTML.
    if (url.pathname === "/credits/success" && (request.method === "GET" || request.method === "HEAD")) {
      const sessionId = url.searchParams.get("session_id");
      let code: string | null = null;
      if (sessionId) {
        try {
          const { getCodeBySession } = await import("./billing/credit_codes");
          const row = await getCodeBySession(env, sessionId);
          if (row && row.status === "pending") code = row.code;
        } catch { /* best-effort */ }
      }
      const body = {
        ok: true,
        message: code
          ? "Payment received. Single-use credit code below — redeem via verdigraph_redeem_credit_code(code) in your authenticated MCP session."
          : "Payment received. Credits landed on the caller_id in the Stripe session metadata (if any). Run verdigraph_get_balance to confirm.",
        ...(code ? { code } : {}),
        next_steps_url: "https://github.com/viridis-security/verdigraph-neurogenesis#redeeming-credits",
      };
      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // Iter3 P1.1 — pricing endpoint.
    if (url.pathname === "/api/v1/mcp/pricing" && (request.method === "GET" || request.method === "HEAD")) {
      const { buildPricingMap } = await import("./discovery/pricing");
      return new Response(JSON.stringify(buildPricingMap(), null, 2), {
        status: 200,
        headers: {
          "content-type":  "application/json; charset=utf-8",
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        },
      });
    }

    // Attestation public key — env-dependent, must be served before the pure discovery handlers.
    if (url.pathname === "/.well-known/verdigraph-attest-pubkey" && (request.method === "GET" || request.method === "HEAD")) {
      const pub = (env as any).VERDIGRAPH_ATTEST_PUBKEY as string | undefined;
      const body = pub
        ? `# Verdigraph attestation public key (Ed25519, raw 32-byte hex)\n# Verify with WebCrypto SubtleCrypto.verify({ name: "Ed25519" }, pubKey, sig, canonical(body))\n${pub}\n`
        : "# attestation_unavailable: VERDIGRAPH_ATTEST_PUBKEY is not configured on this Worker.\n";
      return new Response(body, {
        status: pub ? 200 : 503,
        headers: {
          "content-type":  "text/plain; charset=utf-8",
          "cache-control": pub ? "public, max-age=3600" : "no-store",
          "access-control-allow-origin": "*",
        },
      });
    }

    // Public discovery surfaces (landing, /.well-known/mcp, /llms.txt, etc.).
    // These short-circuit before OAuth and require no authentication.
    const discoveryResponse = tryHandleDiscovery(request);
    if (discoveryResponse) return discoveryResponse;

    // Brain-builder shop — live MCP build environment for the user's LLM agent.
    // Routes under /app/* are public for the preview path; OAuth-gated checkout
    // is delegated to the existing billing flow under the OAuth provider below.
    if (url.pathname === "/app" || url.pathname.startsWith("/app/")) {
      const { tryHandleBrainBuilder } = await import("./brainbuilder/handlers");
      const r = await tryHandleBrainBuilder(request, env);
      if (r) return r;
    }

    // Everything else (OAuth flow + /mcp tool calls) goes through the OAuth provider.
    return (oauthProvider as any).fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMonthlyConservationCron(env));
  },
};
