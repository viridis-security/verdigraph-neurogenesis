// src/index.ts — Worker entrypoint for verdigraph-mcp (hosted).

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { authHandler }     from "./auth/handler";
import { VerdigraphAgent } from "./mcp/agent";
import { runMonthlyConservationCron } from "./billing/conservation";

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
    if (url.pathname === "/stripe/webhook") {
      const { handleStripeWebhook } = await import("./billing/webhook");
      return handleStripeWebhook(request, env);
    }
    return (oauthProvider as any).fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runMonthlyConservationCron(env));
  },
};
