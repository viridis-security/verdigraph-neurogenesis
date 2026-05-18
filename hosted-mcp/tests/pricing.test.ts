// tests/pricing.test.ts — invariant checks for billing math.
// These exercise pure functions (no DB) so they run in CI without a Worker.
import { describe, expect, it } from "vitest";
import { conservationShareUsdMicros, priceCall } from "../src/billing/ledger";

const ENV = {
  ROUTING_FEE_USD_MICROS: "2000",
  CONSERVATION_RATIO_NUM: "1",
  CONSERVATION_RATIO_DEN: "4",
} as any;

describe("priceCall", () => {
  it("adds routing fee to model cost on success", () => {
    const r = priceCall(ENV, {
      modelUsed: "claude-haiku-4-5",
      inputTokens: 1000,
      outputTokens: 500,
      modelCostUsdMicros: 5000,
      success: true,
      latencyMs: 400,
    });
    expect(r.routingFeeUsdMicros).toBe(2000);
    expect(r.totalChargedUsdMicros).toBe(7000);
  });

  it("charges nothing on failure", () => {
    const r = priceCall(ENV, {
      modelUsed: null,
      inputTokens: 0,
      outputTokens: 0,
      modelCostUsdMicros: 0,
      success: false,
      errorCode: "NO_FEASIBLE_PROFILE",
      latencyMs: 12,
    });
    expect(r.totalChargedUsdMicros).toBe(0);
    expect(r.routingFeeUsdMicros).toBe(0);
  });
});

describe("conservationShareUsdMicros", () => {
  it("returns 25% of net revenue (floor)", () => {
    expect(conservationShareUsdMicros(ENV, 1_000_000)).toBe(250_000);
    expect(conservationShareUsdMicros(ENV, 1_234_567)).toBe(308_641); // floor(1234567/4)
    expect(conservationShareUsdMicros(ENV, 0)).toBe(0);
  });
  it("never over-allocates (sum check)", () => {
    // For any net N, conservation + retained <= N (floor div guarantees this).
    for (const n of [1, 7, 99, 1_000_001, 9_999_999]) {
      const share = conservationShareUsdMicros(ENV, n);
      expect(share * 4).toBeLessThanOrEqual(n);
    }
  });
});
