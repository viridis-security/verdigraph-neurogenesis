// tests/metering.test.ts — iter4 H1: exactly-once metering under concurrency.
//
// Invariant under test: for any (caller_id, request_id) pair, across any number
// of concurrent or retried calls, the total credits debited and the total
// Stripe meter events fired are each EXACTLY ONE.
//
// The DB is a real in-memory SQLite instance (tests/helpers/d1.ts) built from
// the repo's actual migrations, so the UNIQUE (caller_id, request_id) index —
// the mechanism that elects the single winner — is genuinely exercised.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Count Stripe meter events without a live Stripe account. The mock replaces
// the stripe module for every importer, including src/mcp/metering.ts.
const hoisted = vi.hoisted(() => ({ meterEvents: 0 }));
vi.mock("../src/billing/stripe", () => ({
  recordStripeMeterEvent: async () => { hoisted.meterEvents++; },
  getStripeClient: () => null,
  ensureStripeCustomer: async () => null,
}));

import { meteredCall, type MeteredResult } from "../src/mcp/metering";
import { makeTestEnv, seedCaller, seedBalance } from "./helpers/d1";

const ROUTING_FEE = 2_000; // ROUTING_FEE_USD_MICROS in makeTestEnv

function okBody(tag: () => void) {
  return async (): Promise<MeteredResult<{ ok: boolean }>> => {
    tag();
    return {
      result: { ok: true },
      usage: { modelUsed: null, inputTokens: 0, outputTokens: 0, modelCostUsdMicros: 0, success: true },
    };
  };
}

async function ledgerCount(env: any, callerId: string, requestId: string): Promise<number> {
  const r = (await env.DB
    .prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE caller_id = ?1 AND request_id = ?2")
    .bind(callerId, requestId)
    .first()) as { n: number };
  return r.n;
}

async function balance(env: any, callerId: string): Promise<number> {
  const r = (await env.DB
    .prepare("SELECT balance_usd_micros AS b FROM credit_balances WHERE caller_id = ?1")
    .bind(callerId)
    .first()) as { b: number } | null;
  return r?.b ?? 0;
}

describe("H1 — exactly-once metering under concurrency", () => {
  beforeEach(() => { hoisted.meterEvents = 0; });

  it("N concurrent calls sharing one (caller_id, request_id): one debit, one row, one meter event", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_h1");
    seedBalance(env, "cal_h1", 1_000_000); // $1.00

    const N = 12;
    const ctx = { callerId: "cal_h1", toolName: "verdigraph_test", requestId: "req-shared" };
    let bodyRuns = 0;

    const outputs = await Promise.all(
      Array.from({ length: N }, () => meteredCall(env, ctx, okBody(() => { bodyRuns++; }))),
    );

    // exactly one usage_ledger row
    expect(await ledgerCount(env, "cal_h1", "req-shared")).toBe(1);
    // exactly one debit — balance dropped by exactly one routing fee
    expect(await balance(env, "cal_h1")).toBe(1_000_000 - ROUTING_FEE);
    // exactly one Stripe meter event
    expect(hoisted.meterEvents).toBe(1);
    // the body ran exactly once (only the winner executes it)
    expect(bodyRuns).toBe(1);
    // exactly one non-replay winner; every call resolves to the same final row
    const winners = outputs.filter((o) => !o.replayed);
    expect(winners.length).toBe(1);
    expect(outputs.every((o) => o.row.id === winners[0]!.row.id)).toBe(true);
    expect(outputs.every((o) => o.row.success === true)).toBe(true);
    expect(outputs.every((o) => o.row.totalChargedUsdMicros === ROUTING_FEE)).toBe(true);
  });

  it("sequential replay of the same request_id never double-charges", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_seq");
    seedBalance(env, "cal_seq", 50_000);
    const ctx = { callerId: "cal_seq", toolName: "verdigraph_test", requestId: "req-once" };
    let bodyRuns = 0;

    const first = await meteredCall(env, ctx, okBody(() => { bodyRuns++; }));
    const second = await meteredCall(env, ctx, okBody(() => { bodyRuns++; }));
    const third = await meteredCall(env, ctx, okBody(() => { bodyRuns++; }));

    expect(bodyRuns).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(third.replayed).toBe(true);
    expect(await balance(env, "cal_seq")).toBe(50_000 - ROUTING_FEE);
    expect(await ledgerCount(env, "cal_seq", "req-once")).toBe(1);
    expect(hoisted.meterEvents).toBe(1);
  });

  it("distinct request_ids are billed independently", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_multi");
    seedBalance(env, "cal_multi", 1_000_000);
    await Promise.all([
      meteredCall(env, { callerId: "cal_multi", toolName: "t", requestId: "r1" }, okBody(() => {})),
      meteredCall(env, { callerId: "cal_multi", toolName: "t", requestId: "r2" }, okBody(() => {})),
      meteredCall(env, { callerId: "cal_multi", toolName: "t", requestId: "r3" }, okBody(() => {})),
    ]);
    expect(await balance(env, "cal_multi")).toBe(1_000_000 - 3 * ROUTING_FEE);
    expect(hoisted.meterEvents).toBe(3);
  });

  it("insufficient credits: no debit, row settled as a failed call, no meter event", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_broke");
    seedBalance(env, "cal_broke", 500); // below the 2000 routing fee
    const out = await meteredCall(
      env,
      { callerId: "cal_broke", toolName: "t", requestId: "req-broke" },
      okBody(() => { throw new Error("body must not run when credit gate fails"); }),
    );
    expect(out.row.success).toBe(false);
    expect(out.insufficientCredits).toBeTruthy();
    expect(await balance(env, "cal_broke")).toBe(500); // untouched
    expect(hoisted.meterEvents).toBe(0);
    const row = (await env.DB
      .prepare("SELECT settlement_state, error_code FROM usage_ledger WHERE caller_id=?1 AND request_id=?2")
      .bind("cal_broke", "req-broke")
      .first()) as { settlement_state: string; error_code: string };
    expect(row.settlement_state).toBe("settled");
    expect(row.error_code).toBe("INSUFFICIENT_CREDITS");
  });

  it("body failure refunds the provisional debit atomically and settles the row failed", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_fail");
    seedBalance(env, "cal_fail", 100_000);
    const out = await meteredCall(
      env,
      { callerId: "cal_fail", toolName: "t", requestId: "req-fail" },
      async () => { throw new Error("tool blew up"); },
    );
    expect(out.row.success).toBe(false);
    // provisional debit was refunded — balance is whole again
    expect(await balance(env, "cal_fail")).toBe(100_000);
    expect(hoisted.meterEvents).toBe(0);
    const row = (await env.DB
      .prepare("SELECT settlement_state, total_charged_usd_micros AS t FROM usage_ledger WHERE caller_id=?1 AND request_id=?2")
      .bind("cal_fail", "req-fail")
      .first()) as { settlement_state: string; t: number };
    expect(row.settlement_state).toBe("settled");
    expect(row.t).toBe(0);
  });
});
