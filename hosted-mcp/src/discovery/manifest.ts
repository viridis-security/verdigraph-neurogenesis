// src/discovery/manifest.ts — canonical metadata for verdigraph-mcp.
//
// One source of truth used by /.well-known/mcp (SEP-1960), /.well-known/mcp/server-card.json
// (SEP-1649), /llms.txt, and the public landing page. Keep all human-readable copy here so
// updates ripple to every discovery surface in one edit.

export const SERVER_BASE_URL = "https://verdigraph.dev";
export const REPO_URL        = "https://github.com/viridis-security/verdigraph-neurogenesis";
export const HOMEPAGE_URL    = "https://verdigraph.dev";
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
  // Iter3 P1.1: live per-call price for metered tools. Free tools may omit.
  // ROUTING_FEE_USD ($0.002) applies to most metered MCP tools; surface-fee
  // tools (brain_evolve, brain_attest_purchase) carry their own rate.
  price_usd?: number;
}

export const TOOLS: ToolDescriptor[] = [
  { name: "verdigraph_choose_compute_profile", summary: "Pick the cheapest reliable model + thinking budget for a task.", metered: true, price_usd: 0.002 },
  { name: "verdigraph_list_profiles",          summary: "List compute profiles with cost-per-1k token rates.",          metered: true, price_usd: 0.002 },
  { name: "verdigraph_create_agent",           summary: "Initialize a developmental agent from a genome.",              metered: true, price_usd: 0.002 },
  { name: "verdigraph_list_agents",            summary: "List the caller's active agents.",                              metered: true, price_usd: 0.002 },
  { name: "verdigraph_get_graph_summary",      summary: "Return node, edge, and ledger counts for an agent's graph.",   metered: true, price_usd: 0.002 },
  { name: "verdigraph_get_agent_state",        summary: "Return the agent's full developmental state.",                 metered: true, price_usd: 0.002 },
  { name: "verdigraph_submit_evaluation",      summary: "Submit a task evaluation; growth/pruning fires automatically.", metered: true, price_usd: 0.002 },
  { name: "verdigraph_best_next_steps",        summary: "Suggest the cheapest reliable route for a pending task.",      metered: true, price_usd: 0.002 },
  { name: "verdigraph_get_ledger",             summary: "Return the developmental ledger (immutable event log).",       metered: true, price_usd: 0.002 },
  { name: "verdigraph_save_agent_state",       summary: "Snapshot an agent's state to R2.",                              metered: true, price_usd: 0.002 },
  { name: "verdigraph_load_agent_state",       summary: "Rehydrate an agent from a saved snapshot.",                    metered: true, price_usd: 0.002 },
  { name: "verdigraph_delete_agent",           summary: "Permanently remove an agent and its state.",                    metered: true, price_usd: 0.002 },
  { name: "verdigraph_should_use_cache",       summary: "Decide whether a task should hit the response cache.",          metered: true, price_usd: 0.002 },
  { name: "verdigraph_should_escalate",        summary: "Decide whether to escalate to a higher-tier model.",            metered: true, price_usd: 0.002 },
  { name: "verdigraph_get_balance",            summary: "Return the caller's current prepaid USD credit balance.",       metered: false },
  { name: "verdigraph_create_topup_session",   summary: "Create a Stripe Checkout session ($5–$500) to top up credits.", metered: false },
  { name: "verdigraph_topup_url",              summary: "Return the public /credits URL to hand to a human for anonymous purchase.", metered: false },
  { name: "verdigraph_redeem_credit_code",     summary: "Redeem a single-use vdc_ credit code (atomic claim + balance credit).", metered: false },
  { name: "verdigraph_create_subscription",    summary: "Create a recurring $20/month credit auto-refill subscription.",       metered: false },
  // ── Brain-builder shop (live MCP build environment) ──────────────────
  { name: "brain_pair_session",                summary: "Pair an authenticated agent with a browser build session (BYO LLM).", metered: false },
  { name: "brain_list_formats",                summary: "List supported agent file formats for brain import.",          metered: false },
  { name: "brain_import",                      summary: "Deterministically build a Verdigraph brain from an agent file.", metered: true, price_usd: 0.002 },
  { name: "brain_get",                         summary: "Fetch a brain artifact (paywall-gated; subscription unlocks all).", metered: true, price_usd: 0.002 },
  { name: "brain_verify",                      summary: "Re-run the 9 brain invariants against an existing brain.",      metered: true, price_usd: 0.002 },
  { name: "brain_evolve",                      summary: "Apply task events to mutate a brain under its growth_rules.",    metered: true, price_usd: 0.05 },
  { name: "brain_checkout",                    summary: "Create a Stripe Checkout session ($9 one-time or $19/mo).",     metered: false },
  // iter4.2 — marketplace tools removed (proprietary pivot). Brains are private
  // property of the caller that built them. The Ed25519 attestation tier remains
  // how an owner proves a brain's structure to downstream auditors.
  // ── Compliance attestation tier (signed Ed25519) ─────────────────────
  { name: "brain_attest_preview",              summary: "Preview an unsigned attestation for a brain (free).",                metered: false },
  { name: "brain_attest_purchase",             summary: "Purchase a signed Ed25519 attestation ($199 standard / $499 enterprise).", metered: true, price_usd: 199.0 },
  { name: "brain_attest_verify",               summary: "Verify a signed attestation's signature and content_hash.",          metered: false },
];

export const CATEGORIES = [
  "developer-tools",
  "private-cognition",
  "deterministic-builds",
  "compliance-attestation",
  "oauth-2.1",
  "mcp",
];

export const KEYWORDS = [
  "verdigraph", "mcp", "hosted-mcp", "private-cognition", "deterministic-builds",
  "content-addressed", "developer-tools", "secure-build-environment",
  "compliance-attestation", "ed25519", "oauth", "viridis",
  "cognitive-graph", "neuromorphic",
];

export const SHORT_DESCRIPTION =
  "A secure development environment for builders constructing private cognitive graphs. " +
  "Deterministic content-addressed brain artifacts, free preview, optional Ed25519-signed compliance attestation.";

export const LONG_DESCRIPTION =
  "Verdigraph is a secure development environment for builders constructing private cognitive graphs. " +
  "Drop in an agent file (Claude project export, OpenAI Assistant config, Verdigraph genome, prompt list) and " +
  "your own LLM constructs an inspectable cognitive brain in real time — with a content-addressed brain_id and " +
  "content_hash that are byte-identical on every rebuild. Brains are private property of the building caller_id; " +
  "the public surface only exposes a deterministic id, a free structural preview, and an optional Ed25519-signed " +
  "compliance attestation (audit-grade, regulator-facing). Bring your own LLM. Prepaid USD credits via Stripe Checkout.";

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
      ...(t.price_usd !== undefined ? { price_usd: t.price_usd } : {}),
    })),
    categories: CATEGORIES,
    keywords:   KEYWORDS,
    install: {
      claude_desktop: {
        type: "remote",
        url:  `${SERVER_BASE_URL}/mcp`,
        config_snippet: {
          mcpServers: {
            verdigraph: { type: "http", url: `${SERVER_BASE_URL}/mcp` },
          },
        },
      },
      claude_code: {
        cmd: `claude mcp add --transport http verdigraph ${SERVER_BASE_URL}/mcp`,
      },
      cowork: {
        type: "remote",
        url:  `${SERVER_BASE_URL}/mcp`,
        instructions: "Cowork → Settings → Connectors → Add custom MCP server → paste the URL.",
      },
      onboarding_url: `${SERVER_BASE_URL}/connect`,
    },
    // Iter3 P1.5
    openapi_url: `${SERVER_BASE_URL}/openapi.yaml`,
    // Iter3 P0.2 — SEP-1649 amendment proposal: uri_schemes field
    uri_schemes: [
      {
        scheme:      "verdigraph://brain/",
        resolves_to: `${SERVER_BASE_URL}/app/brains/{id}`,
        format:      "Crockford-base32, 26 chars",
        example:     "verdigraph://brain/G0HMXXZ360QZWNVHHWKXMHZVCJ",
      },
      {
        scheme:      "verdigraph://genome/",
        resolves_to: `${SERVER_BASE_URL}/app/genomes/{id}`,
        format:      "future",
        example:     "verdigraph://genome/<reserved>",
      },
    ],
    uri_handler_install: {
      macos:   `${SERVER_BASE_URL}/scripts/uri-handler/install-macos.sh`,
      windows: `${SERVER_BASE_URL}/scripts/uri-handler/install-windows.ps1`,
      linux:   `${SERVER_BASE_URL}/scripts/uri-handler/install-linux.sh`,
    },
  };
}
