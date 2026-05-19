// src/discovery/manifest.ts — canonical metadata for verdigraph-mcp.
//
// One source of truth used by /.well-known/mcp (SEP-1960), /.well-known/mcp/server-card.json
// (SEP-1649), /llms.txt, and the public landing page. Keep all human-readable copy here so
// updates ripple to every discovery surface in one edit.

export const SERVER_BASE_URL = "https://verdigraph-mcp.hartjustin6.workers.dev";
export const REPO_URL        = "https://github.com/viridis-security/verdigraph-neurogenesis";
export const HOMEPAGE_URL    = "https://verdigraph-mcp.hartjustin6.workers.dev";
export const LICENSE         = "MIT";
export const SERVER_VERSION  = "0.2.0";
export const VENDOR_NAME     = "Viridis LLC";
export const VENDOR_URL      = "https://viridis.eco"; // placeholder; update when set

export const ROUTING_FEE_USD = 0.002;        // matches ROUTING_FEE_USD_MICROS=2000 in wrangler.toml
export const CONSERVATION_NUMERATOR   = 1;
export const CONSERVATION_DENOMINATOR = 4;   // 25% of net revenue

// 14 metered + 2 free billing tools — keep in sync with src/mcp/agent.ts registrations.
export interface ToolDescriptor {
  name: string;
  summary: string;
  metered: boolean;
}

export const TOOLS: ToolDescriptor[] = [
  { name: "verdigraph_choose_compute_profile", summary: "Pick the cheapest reliable model + thinking budget for a task.", metered: true },
  { name: "verdigraph_list_profiles",          summary: "List compute profiles with cost-per-1k token rates.",          metered: true },
  { name: "verdigraph_create_agent",           summary: "Initialize a developmental agent from a genome.",              metered: true },
  { name: "verdigraph_list_agents",            summary: "List the caller's active agents.",                              metered: true },
  { name: "verdigraph_get_graph_summary",      summary: "Return node, edge, and ledger counts for an agent's graph.",   metered: true },
  { name: "verdigraph_get_agent_state",        summary: "Return the agent's full developmental state.",                 metered: true },
  { name: "verdigraph_submit_evaluation",      summary: "Submit a task evaluation; growth/pruning fires automatically.", metered: true },
  { name: "verdigraph_best_next_steps",        summary: "Suggest the cheapest reliable route for a pending task.",      metered: true },
  { name: "verdigraph_get_ledger",             summary: "Return the developmental ledger (immutable event log).",       metered: true },
  { name: "verdigraph_save_agent_state",       summary: "Snapshot an agent's state to R2.",                              metered: true },
  { name: "verdigraph_load_agent_state",       summary: "Rehydrate an agent from a saved snapshot.",                    metered: true },
  { name: "verdigraph_delete_agent",           summary: "Permanently remove an agent and its state.",                    metered: true },
  { name: "verdigraph_should_use_cache",       summary: "Decide whether a task should hit the response cache.",          metered: true },
  { name: "verdigraph_should_escalate",        summary: "Decide whether to escalate to a higher-tier model.",            metered: true },
  { name: "verdigraph_get_balance",            summary: "Return the caller's current prepaid USD credit balance.",       metered: false },
  { name: "verdigraph_create_topup_session",   summary: "Create a Stripe Checkout session ($5–$500) to top up credits.", metered: false },
];

export const CATEGORIES = [
  "compute-routing",
  "agent-economy",
  "agent-to-agent",
  "metered",
  "oauth-2.1",
  "conservation",
  "developmental-agents",
  "neuromorphic",
];

export const KEYWORDS = [
  "verdigraph", "mcp", "hosted-mcp", "paid-mcp", "compute-routing", "agent-economy",
  "agent-to-agent", "a2a", "metered", "stripe", "conservation", "oauth", "viridis",
  "cognitive-graph", "self-evolving", "neuromorphic", "developmental-ai",
];

export const SHORT_DESCRIPTION =
  "Hosted, OAuth-authenticated, pay-per-call MCP for agent-to-agent compute routing. " +
  "Prepaid USD credits via Stripe Checkout, atomic ledger, 25% of net revenue auto-routes to verified conservation.";

export const LONG_DESCRIPTION =
  "Verdigraph is a self-evolving cognitive substrate exposed as a paid, OAuth-authenticated MCP. " +
  "Other autonomous agents (Claude, GPT, custom) can pay per call to: choose the cheapest reliable compute profile " +
  "for a task, manage long-lived developmental agents whose cognitive graphs grow and prune based on real outcomes, " +
  "and emit an immutable evaluation ledger. Prepaid credits via Stripe Checkout ($5–$500 top-ups), " +
  "atomic micro-USD debit with INSUFFICIENT_CREDITS on zero balance, 25% of net revenue committed to verified " +
  "Viridis conservation programs, monthly transparency cron writes payouts to a public auditable ledger.";

export const CONTACT_EMAIL = "hartjustin6@gmail.com";

export const OAUTH = {
  authorization_endpoint:                  `${SERVER_BASE_URL}/authorize`,
  token_endpoint:                          `${SERVER_BASE_URL}/token`,
  registration_endpoint:                   `${SERVER_BASE_URL}/register`,
  authorization_server_metadata_endpoint:  `${SERVER_BASE_URL}/.well-known/oauth-authorization-server`,
  grant_types_supported:                   ["authorization_code", "refresh_token"],
  code_challenge_methods_supported:        ["S256"],
  scopes_supported:                        ["mcp"],
};

// SEP-1960 — /.well-known/mcp manifest.
export function buildSep1960Manifest() {
  return {
    schema_version: "0.1.0",
    server: {
      name:        "verdigraph-mcp",
      version:     SERVER_VERSION,
      description: SHORT_DESCRIPTION,
      homepage:    HOMEPAGE_URL,
      repository:  REPO_URL,
      license:     LICENSE,
      vendor:      { name: VENDOR_NAME, url: VENDOR_URL, contact: CONTACT_EMAIL },
    },
    endpoints: [
      { transport: "streamable_http", url: `${SERVER_BASE_URL}/mcp` },
      { transport: "sse",             url: `${SERVER_BASE_URL}/mcp` },
    ],
    capabilities: {
      tools:     { count: TOOLS.length, free: TOOLS.filter(t => !t.metered).length, metered: TOOLS.filter(t => t.metered).length },
      resources: { supported: false },
      prompts:   { supported: false },
      logging:   { supported: false },
    },
    authentication: {
      type:                "oauth2",
      flows:               ["authorization_code+pkce"],
      dynamic_registration: true,
      ...OAUTH,
    },
    pricing: {
      model:            "prepaid_credits",
      currency:         "USD",
      topup_min_usd:    5,
      topup_max_usd:    500,
      routing_fee_usd:  ROUTING_FEE_USD,
      passthrough:      "Model costs (when invoked) are passed through at provider rates and added to the routing fee.",
      conservation_share: {
        numerator:   CONSERVATION_NUMERATOR,
        denominator: CONSERVATION_DENOMINATOR,
        note:        "25% of NET revenue (gross minus passthrough) is committed to verified conservation programs and aggregated by a monthly cron.",
        public_ledger: `${SERVER_BASE_URL}/conservation/public`,
      },
    },
    security_policies: {
      data_retention:      "Per-caller agent state in R2, indefinite until delete_agent. Webhook events 90d.",
      payment_processor:   "Stripe (livemode). Card data never touches the Worker.",
      pii:                 "Email collected by Stripe at Checkout time; not persisted on Worker beyond the callers row.",
      oauth_scope_filter:  "Single 'mcp' scope; all tools authorized by token; no per-tool scopes yet.",
    },
    categories: CATEGORIES,
    keywords:   KEYWORDS,
  };
}

// SEP-1649 — server-card.json (richer per-server metadata).
export function buildServerCard() {
  return {
    schema_version: "0.1.0",
    name:        "verdigraph-mcp",
    title:       "Verdigraph — paid hosted MCP for compute routing",
    version:     SERVER_VERSION,
    description: SHORT_DESCRIPTION,
    long_description: LONG_DESCRIPTION,
    homepage:    HOMEPAGE_URL,
    repository:  REPO_URL,
    license:     LICENSE,
    icon:        `${SERVER_BASE_URL}/icon.svg`,
    vendor: {
      name:    VENDOR_NAME,
      url:     VENDOR_URL,
      contact: CONTACT_EMAIL,
    },
    tools: TOOLS.map(t => ({
      name:    t.name,
      summary: t.summary,
      metered: t.metered,
    })),
    categories: CATEGORIES,
    keywords:   KEYWORDS,
    install: {
      claude_desktop: {
        type: "remote",
        url:  `${SERVER_BASE_URL}/mcp`,
      },
      claude_code: {
        cmd: `claude mcp add --transport http verdigraph ${SERVER_BASE_URL}/mcp`,
      },
    },
  };
}
