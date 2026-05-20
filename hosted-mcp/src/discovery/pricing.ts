// src/discovery/pricing.ts — Iter3 P1.1: GET /api/v1/mcp/pricing.
// Single source of truth for per-tool live pricing. Same numbers carried into
// the SEP-1649 server card; this endpoint exists so non-MCP consumers (and
// the marketplace UI) don't have to parse the server card to estimate cost.

import { TOOLS, SERVER_VERSION, ROUTING_FEE_USD, CONSERVATION_NUMERATOR, CONSERVATION_DENOMINATOR } from "./manifest";

export function buildPricingMap() {
  return {
    schema_version: "verdigraph.pricing.v1",
    server_version: SERVER_VERSION,
    base_routing_fee_usd: ROUTING_FEE_USD,
    conservation_share: {
      ratio: `${CONSERVATION_NUMERATOR}/${CONSERVATION_DENOMINATOR}`,
      pct:   (CONSERVATION_NUMERATOR / CONSERVATION_DENOMINATOR) * 100,
      label: `${(CONSERVATION_NUMERATOR / CONSERVATION_DENOMINATOR) * 100}% of net revenue routed to verified conservation`,
    },
    tools: TOOLS.map((t) => ({
      name:    t.name,
      summary: t.summary,
      metered: t.metered,
      ...(t.price_usd !== undefined ? { price_usd: t.price_usd } : {}),
    })),
    topup_url: "https://verdigraph.dev/credits",
    subscription_default_usd: 20,
    notes: [
      "Top up at https://verdigraph.dev/credits — anonymous or authenticated.",
      "Free tools (brain_search, brain_attest_preview, etc.) carry no per-call charge.",
      "brain_attest_purchase: price_usd shown is the standard tier ($199). Enterprise tier ($499) is selected by the tier parameter.",
      "brain_publish: one-time publication fee charged at /mcp call time; idempotent re-publish does NOT charge again.",
      "brain_evolve: dry_run=true short-circuits billing — see /openapi.yaml for the field.",
    ],
  };
}
