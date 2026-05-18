// tests/credits.test.ts — credit-balance ledger invariants.
//
// Uses an in-memory fake of the D1Database surface used by credits.ts and
// metering.ts. Verifies:
//  • Atomic deduct succeeds only when balance >= amount.
//  • Insufficient credits throws InsufficientCreditsError with accurate fields.
//  • Concurrent deducts don't overspend (last writer wins per UPDATE, but the
//    WHERE clause guards correctness).
//  • Credit is additive and idempotent at the caller layer (webhook layer
//    handles event-id idempotency separately).

import { describe, expect, it, beforeEach } from "vitest";
import { creditUsdMicros, tryDebitUsdMicros, getBalanceUsdMicros, InsufficientCreditsError, microsToUsdString } from "../src/billing/credits";

// ── Minimal D1Database fake — exactly what credits.ts uses ──────────────
class FakeD1 {
  rows: Map<string, { balance_usd_micros: number; updated_at: number }> = new Map();

  prepare(sql: string) {
    const self = this;
    let bound: any[] = [];
    return {
      bind(...args: any[]) {
        bound = args;
        return this;
      },
      async first<T>(): Promise<T | null> {
        if (/SELECT balance_usd_micros FROM credit_balances WHERE caller_id/.test(sql)) {
          const row = self.rows.get(bound[0]);
          return (row ? { balance_usd_micros: row.balance_usd_micros } : null) as any;
        }
        return null;
      },
      async run(): Promise<{ meta: { changes: number } }> {
        if (/UPDATE credit_balances/.test(sql)) {
          const [amount, updated_at, callerId] = bound;
          const row = self.rows.get(callerId);
          if (row && row.balance_usd_micros >= amount) {
            row.balance_usd_micros -= amount;
            row.updated_at = updated_at;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (/INSERT INTO credit_balances/.test(sql)) {
          const [callerId, amount, updated_at] = bound;
          const existing = self.rows.get(callerId);
          if (existing) {
            existing.balance_usd_micros += amount;
            existing.updated_at = updated_at;
          } else {
            self.rows.set(callerId, { balance_usd_micros: amount, updated_at });
          }
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
    };
  }
}

const ENV = (db: FakeD1) => ({ DB: db } as any);

describe("credits.creditUsdMicros", () => {
  let db: FakeD1;
  beforeEach(() => { db = new FakeD1(); });

  it("creates the row on first credit", async () => {
    const balance = await creditUsdMicros(ENV(db), "cal_a", 5_000_000);
    expect(balance).toBe(5_000_000);
  });

  it("is additive across multiple credits", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 5_000_000);
    await creditUsdMicros(ENV(db), "cal_a", 3_000_000);
    expect(await getBalanceUsdMicros(ENV(db), "cal_a")).toBe(8_000_000);
  });

  it("ignores zero or negative amounts", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 0);
    await creditUsdMicros(ENV(db), "cal_a", -100);
    expect(await getBalanceUsdMicros(ENV(db), "cal_a")).toBe(0);
  });

  it("isolates callers", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 1_000_000);
    await creditUsdMicros(ENV(db), "cal_b", 2_000_000);
    expect(await getBalanceUsdMicros(ENV(db), "cal_a")).toBe(1_000_000);
    expect(await getBalanceUsdMicros(ENV(db), "cal_b")).toBe(2_000_000);
  });
});

describe("credits.tryDebitUsdMicros", () => {
  let db: FakeD1;
  beforeEach(() => { db = new FakeD1(); });

  it("deducts when balance covers amount", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 10_000);
    const after = await tryDebitUsdMicros(ENV(db), "cal_a", 2_000);
    expect(after).toBe(8_000);
  });

  it("throws InsufficientCreditsError when balance is too low", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 1_000);
    let caught: InsufficientCreditsError | null = null;
    try { await tryDebitUsdMicros(ENV(db), "cal_a", 2_000); }
    catch (e) { caught = e as InsufficientCreditsError; }
    expect(caught).toBeInstanceOf(InsufficientCreditsError);
    expect(caught!.callerId).toBe("cal_a");
    expect(caught!.balanceUsdMicros).toBe(1_000);
    expect(caught!.requiredUsdMicros).toBe(2_000);
  });

  it("throws when no row exists at all", async () => {
    await expect(() => tryDebitUsdMicros(ENV(db), "cal_nobody", 1)).rejects.toThrow(InsufficientCreditsError);
  });

  it("does not overspend under concurrent deducts (atomic UPDATE semantics)", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 10_000);
    // Both attempts try to take 7000 — only one should succeed.
    const results = await Promise.allSettled([
      tryDebitUsdMicros(ENV(db), "cal_a", 7_000),
      tryDebitUsdMicros(ENV(db), "cal_a", 7_000),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected  = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(await getBalanceUsdMicros(ENV(db), "cal_a")).toBe(3_000);
  });

  it("does not deduct for zero or negative amounts", async () => {
    await creditUsdMicros(ENV(db), "cal_a", 5_000);
    expect(await tryDebitUsdMicros(ENV(db), "cal_a", 0)).toBe(5_000);
    expect(await tryDebitUsdMicros(ENV(db), "cal_a", -100)).toBe(5_000);
  });
});

describe("credits.microsToUsdString", () => {
  it("formats with six decimal places", () => {
    expect(microsToUsdString(0)).toBe("$0.000000");
    expect(microsToUsdString(2_000)).toBe("$0.002000");
    expect(microsToUsdString(1_000_000)).toBe("$1.000000");
    expect(microsToUsdString(5_500_000)).toBe("$5.500000");
  });
});
