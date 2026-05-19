// src/discovery/conservation.ts — public conservation transparency surface.
//
// Returns running totals from D1's conservation_payouts and usage_ledger tables.
// All public (no OAuth). Cacheable for 5 minutes. Embeddable badge SVG for any
// MCP server, README, or marketing surface to display the live total.

import type { Env } from "../index";

const JSON_HEADERS = (maxAge: number) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": `public, max-age=${maxAge}`,
  "access-control-allow-origin": "*",
});

const SVG_HEADERS = (maxAge: number) => ({
  "content-type": "image/svg+xml; charset=utf-8",
  "cache-control": `public, max-age=${maxAge}`,
  "access-control-allow-origin": "*",
});

export interface ConservationTotals {
  gross_revenue_usd:        number;
  passthrough_cost_usd:     number;
  net_revenue_usd:          number;
  conservation_share_usd:   number;
  conservation_committed:   string;   // "25% of net revenue"
  paid_out_usd:             number;
  pending_usd:              number;
  total_paying_callers:     number;
  total_metered_calls:      number;
  last_payout_at:           string | null;
  as_of:                    string;   // ISO timestamp
}

/**
 * Aggregate live totals from D1. Returns zeros if tables are empty.
 * Safe to call on every request because the queries scan small tables and the
 * response is cached for 5 minutes at the edge.
 */
export async function computeConservationTotals(env: Env): Promise<ConservationTotals> {
  // Lifetime usage_ledger aggregates.
  const ledger = await env.DB
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN success=1 THEN total_charged_usd_micros ELSE 0 END), 0) AS gross_micros,
        COALESCE(SUM(CASE WHEN success=1 THEN model_cost_usd_micros    ELSE 0 END), 0) AS passthrough_micros,
        SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) AS calls,
        COUNT(DISTINCT caller_id) AS callers
      FROM usage_ledger
    `)
    .first<{ gross_micros: number; passthrough_micros: number; calls: number; callers: number }>();

  // Lifetime payout aggregates.
  const payouts = await env.DB
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status='paid'    THEN conservation_share_usd_micros ELSE 0 END), 0) AS paid_micros,
        COALESCE(SUM(CASE WHEN status='pending' THEN conservation_share_usd_micros ELSE 0 END), 0) AS pending_micros,
        MAX(CASE WHEN status='paid' THEN created_at ELSE NULL END) AS last_paid_at
      FROM conservation_payouts
    `)
    .first<{ paid_micros: number; pending_micros: number; last_paid_at: number | null }>();

  const grossMicros        = ledger?.gross_micros        ?? 0;
  const passthroughMicros  = ledger?.passthrough_micros  ?? 0;
  const netMicros          = Math.max(0, grossMicros - passthroughMicros);
  const conservationMicros = Math.floor(netMicros / 4);

  return {
    gross_revenue_usd:      grossMicros / 1_000_000,
    passthrough_cost_usd:   passthroughMicros / 1_000_000,
    net_revenue_usd:        netMicros / 1_000_000,
    conservation_share_usd: conservationMicros / 1_000_000,
    conservation_committed: "25% of net revenue",
    paid_out_usd:           (payouts?.paid_micros ?? 0) / 1_000_000,
    pending_usd:            (payouts?.pending_micros ?? 0) / 1_000_000,
    total_paying_callers:   ledger?.callers ?? 0,
    total_metered_calls:    ledger?.calls   ?? 0,
    last_payout_at:         payouts?.last_paid_at ? new Date(payouts.last_paid_at).toISOString() : null,
    as_of:                  new Date().toISOString(),
  };
}

export async function handleConservationPublic(env: Env): Promise<Response> {
  const totals = await computeConservationTotals(env);
  return new Response(JSON.stringify(totals, null, 2), { status: 200, headers: JSON_HEADERS(300) });
}

export async function handleConservationBadge(env: Env): Promise<Response> {
  const totals = await computeConservationTotals(env);
  const amount = totals.conservation_share_usd;
  const label  = "conservation";
  const value  = `$${amount.toFixed(2)} (25% of net)`;
  return new Response(renderBadge(label, value), { status: 200, headers: SVG_HEADERS(300) });
}

/**
 * Render a shields.io-style "for-the-badge" SVG. Self-contained; no external
 * deps so it works offline and is cacheable forever per response.
 */
function renderBadge(label: string, value: string): string {
  // Rough text width estimation — 6.5 px/char for the bold value, 6 px/char for label.
  const labelW = Math.max(40, label.length * 6 + 16);
  const valueW = Math.max(40, value.length * 7 + 16);
  const totalW = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="#0f3d2e"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="14">${label}</text>
    <text x="${labelW + valueW / 2}" y="14" font-weight="bold">${value}</text>
  </g>
</svg>`;
}
