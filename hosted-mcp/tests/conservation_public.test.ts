// tests/conservation_public.test.ts — public conservation transparency endpoints.
//
// Invariants:
//  1. /conservation/public returns 200 JSON with all expected keys, even when DB is empty.
//  2. Conservation share = floor(net / 4) where net = max(0, gross - passthrough).
//  3. /conservation/badge.svg returns 200 SVG with the live dollar amount embedded.
//  4. Both endpoints are CORS-open (access-control-allow-origin: *).
//  5. Both endpoints are cacheable.

import { describe, expect, it } from "vitest";
import { computeConservationTotals, handleConservationPublic, handleConservationBadge } from "../src/discovery/conservation";

function makeMockEnv(ledgerRow: any, payoutRow: any): any {
  const prepare = (sql: string) => ({
    first: async () => {
      if (sql.includes("FROM usage_ledger"))         return ledgerRow;
      if (sql.includes("FROM conservation_payouts")) return payoutRow;
      return null;
    },
  });
  return { DB: { prepare } };
}

describe("conservation transparency — totals math", () => {
  it("returns zeros when both tables are empty", async () => {
    const env = makeMockEnv(
      { gross_micros: 0, passthrough_micros: 0, calls: 0, callers: 0 },
      { paid_micros: 0, pending_micros: 0, last_paid_at: null },
    );
    const t = await computeConservationTotals(env);
    expect(t.gross_revenue_usd).toBe(0);
    expect(t.net_revenue_usd).toBe(0);
    expect(t.conservation_share_usd).toBe(0);
    expect(t.total_metered_calls).toBe(0);
    expect(t.last_payout_at).toBeNull();
    expect(t.conservation_committed).toBe("25% of net revenue");
  });

  it("computes conservation share as floor(net / 4) and never negative", async () => {
    // Gross $10.00 = 10_000_000 micros, passthrough $4.00 = 4_000_000 micros, net = 6_000_000 micros,
    // conservation = floor(6_000_000 / 4) = 1_500_000 micros = $1.50.
    const env = makeMockEnv(
      { gross_micros: 10_000_000, passthrough_micros: 4_000_000, calls: 12, callers: 3 },
      { paid_micros: 500_000, pending_micros: 1_000_000, last_paid_at: 1779100000000 },
    );
    const t = await computeConservationTotals(env);
    expect(t.gross_revenue_usd).toBe(10);
    expect(t.passthrough_cost_usd).toBe(4);
    expect(t.net_revenue_usd).toBe(6);
    expect(t.conservation_share_usd).toBe(1.5);
    expect(t.paid_out_usd).toBe(0.5);
    expect(t.pending_usd).toBe(1);
    expect(t.total_metered_calls).toBe(12);
    expect(t.total_paying_callers).toBe(3);
    expect(t.last_payout_at).toMatch(/^2026-/);
  });

  it("never returns a negative net or conservation share even if passthrough > gross", async () => {
    const env = makeMockEnv(
      { gross_micros: 2_000_000, passthrough_micros: 5_000_000, calls: 1, callers: 1 },
      { paid_micros: 0, pending_micros: 0, last_paid_at: null },
    );
    const t = await computeConservationTotals(env);
    expect(t.net_revenue_usd).toBe(0);
    expect(t.conservation_share_usd).toBe(0);
  });
});

describe("conservation transparency — HTTP handlers", () => {
  it("/conservation/public returns 200 JSON with CORS open", async () => {
    const env = makeMockEnv(
      { gross_micros: 0, passthrough_micros: 0, calls: 0, callers: 0 },
      { paid_micros: 0, pending_micros: 0, last_paid_at: null },
    );
    const resp = await handleConservationPublic(env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("application/json");
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    expect(resp.headers.get("cache-control")).toMatch(/public.*max-age=\d+/);
    const body = await resp.json() as any;
    expect(body).toHaveProperty("conservation_share_usd");
    expect(body).toHaveProperty("net_revenue_usd");
    expect(body).toHaveProperty("as_of");
  });

  it("/conservation/badge.svg returns 200 SVG with the live amount embedded", async () => {
    const env = makeMockEnv(
      { gross_micros: 8_000_000, passthrough_micros: 0, calls: 4, callers: 2 },
      { paid_micros: 0, pending_micros: 0, last_paid_at: null },
    );
    const resp = await handleConservationBadge(env);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("image/svg+xml");
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
    const body = await resp.text();
    expect(body).toContain("<svg");
    // 8 gross, 0 passthrough, net 8, conservation 2.00
    expect(body).toContain("$2.00");
    expect(body).toContain("conservation");
  });
});
