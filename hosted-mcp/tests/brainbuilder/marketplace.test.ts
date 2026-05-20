// tests/brainbuilder/marketplace.test.ts — split math + invariants.
// Pure-function tests of computeSplit and estimateStripeFeeMicros — no Worker bindings.

import { describe, it, expect } from "vitest";
import { computeSplit, estimateStripeFeeMicros } from "../../src/brainbuilder/marketplace";

describe("computeSplit", () => {
  it("M4: shares sum exactly to net (no rounding leak)", () => {
    const cases = [9_000_000, 10_000_000, 19_999_999, 1, 13, 99_000_000, 0, 7];
    for (const g of cases) {
      const fee = estimateStripeFeeMicros(g);
      const s = computeSplit(g, fee);
      expect(s.creator_share + s.viridis_share + s.conservation_share).toBe(s.net_micros);
    }
  });

  it("M5: creator gets exactly 70% (floor), viridis exactly 20% (floor), conservation captures the rest", () => {
    const g = 9_000_000;            // $9.00
    const fee = 0;                  // ignore Stripe fee for ratio test
    const s = computeSplit(g, fee);
    expect(s.creator_share).toBe(Math.floor(g * 0.70));
    expect(s.viridis_share).toBe(Math.floor(g * 0.20));
    expect(s.conservation_share).toBe(g - s.creator_share - s.viridis_share);
    // Sanity: conservation ≥ 10% (it captures rounding so is at least floor(10%)).
    expect(s.conservation_share).toBeGreaterThanOrEqual(Math.floor(g * 0.10));
  });

  it("rejects negative gross", () => {
    expect(() => computeSplit(-1, 0)).toThrow();
  });

  it("clamps net to zero when Stripe fee exceeds gross", () => {
    const s = computeSplit(100, 1000);
    expect(s.net_micros).toBe(0);
    expect(s.creator_share + s.viridis_share + s.conservation_share).toBe(0);
  });

  it("free listings produce zero shares", () => {
    const s = computeSplit(0, 0);
    expect(s.creator_share).toBe(0);
    expect(s.viridis_share).toBe(0);
    expect(s.conservation_share).toBe(0);
  });
});

describe("estimateStripeFeeMicros", () => {
  it("returns 0 for free transactions", () => {
    expect(estimateStripeFeeMicros(0)).toBe(0);
  });
  it("scales 2.9% + 30c", () => {
    // $10 gross => $0.29 + $0.30 = $0.59
    const fee = estimateStripeFeeMicros(10_000_000);
    expect(fee).toBe(290_000 + 300_000);
  });
  it("scales monotonically", () => {
    expect(estimateStripeFeeMicros(99_000_000)).toBeGreaterThan(estimateStripeFeeMicros(9_000_000));
  });
});
