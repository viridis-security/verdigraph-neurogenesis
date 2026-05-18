// tests/compute.test.ts — invariant checks for the compute optimizer port.
// Parity with verdigraph/compute.py::ComputeOptimizer.choose_profile.
import { describe, expect, it } from "vitest";
import {
  chooseProfile, DEFAULT_PROFILES, usdToMicros,
  shouldUseCache, shouldEscalate,
  type ComputeProfile, type TaskProfile,
} from "../src/verdigraph/compute";

const PROFILES: ComputeProfile[] = DEFAULT_PROFILES;

function task(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    id: "t1",
    task_type: "issue_triage",
    difficulty: 0.5,
    risk: 0.2,
    expected_input_tokens: 2000,
    expected_output_tokens: 500,
    min_quality: 0.7,
    requires_local: false,
    metadata: {},
    ...overrides,
  };
}

describe("chooseProfile", () => {
  it("picks the cheapest reliable profile when min_quality is moderate", () => {
    const decision = chooseProfile(PROFILES, task({ min_quality: 0.7, risk: 0.1, difficulty: 0.3 }));
    // Cache is highest quality (1.0) AND cheapest (0 cost) — it wins by the scoring rule.
    // But cache.exact_match has max_context_tokens=1 which fails the context check
    // (input=2000+output=500 > 1), so the next eligible cheapest is haiku.
    expect(decision.profile_id).toBe("claude-haiku-4-5");
  });

  it("never returns a profile below min_quality", () => {
    for (let q = 0.5; q <= 0.95; q += 0.05) {
      const decision = chooseProfile(PROFILES, task({ min_quality: q }));
      const chosen = PROFILES.find((p) => p.id === decision.profile_id)!;
      expect(chosen.quality_score).toBeGreaterThanOrEqual(q);
    }
  });

  it("throws if no profile satisfies the constraints", () => {
    expect(() =>
      chooseProfile(PROFILES, task({ min_quality: 0.999, requires_local: true })),
    ).toThrow(/No compute profile/);
  });

  it("falls back to a local-only profile when requires_local=true", () => {
    // cache.exact_match is local=true with quality 1.0 but context 1 — bump tokens down.
    const decision = chooseProfile(PROFILES, task({
      requires_local: true,
      expected_input_tokens: 0,
      expected_output_tokens: 0,
      min_quality: 0.5,
    }));
    expect(decision.profile_id).toBe("cache.exact_match");
  });

  it("rejects profiles whose context window is too small", () => {
    const big = task({ expected_input_tokens: 250_000, expected_output_tokens: 0, min_quality: 0.6 });
    // All 200k-context profiles fail; cache.exact_match (max=1) also fails.
    expect(() => chooseProfile(PROFILES, big)).toThrow(/No compute profile/);
  });
});

describe("usdToMicros", () => {
  it("rounds to nearest micro (no dust accumulation)", () => {
    expect(usdToMicros(0.0000014)).toBe(1);
    expect(usdToMicros(0.0000016)).toBe(2);
    expect(usdToMicros(1.234567)).toBe(1_234_567);
  });
  it("maps zero and large values predictably", () => {
    expect(usdToMicros(0)).toBe(0);
    expect(usdToMicros(1)).toBe(1_000_000);
  });
});

describe("cache/escalation policies", () => {
  it("rejects cache on high risk regardless of confidence", () => {
    expect(shouldUseCache(0.99, 0.8)).toBe(false);
  });
  it("uses cache when confidence >= threshold and risk is low", () => {
    expect(shouldUseCache(0.9,  0.2)).toBe(true);
    expect(shouldUseCache(0.85, 0.2)).toBe(false);
  });
  it("escalates when current confidence < required (risk inflates required)", () => {
    expect(shouldEscalate(0.7, 0.2)).toBe(true);  // required=0.78
    expect(shouldEscalate(0.9, 0.2)).toBe(false);
    // risk above 0.5 raises the bar
    expect(shouldEscalate(0.85, 0.9)).toBe(true); // required ≈ 0.78 + 0.1 = 0.88 > 0.85
  });
});
