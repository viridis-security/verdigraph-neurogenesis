// tests/conservation_cron.test.ts — iter4 H2: conservation cron counts every
// revenue stream.
//
// Invariant under test: for any payout period,
//   conservation_share = floor(ratio * net_revenue)
// where net_revenue is the sum of EVERY revenue stream — per-call routing fees,
// brain unlocks, attestations, and marketplace sales — not routing fees alone.

import { describe, it, expect } from "vitest";
import { runMonthlyConservationCron } from "../src/billing/conservation";
import { bookPurchase, estimateStripeFeeMicros } from "../src/brainbuilder/marketplace";
import { makeTestEnv, seedCaller } from "./helpers/d1";

// Run the cron as if "now" is mid-June 2026 → the payout period is May 2026.
const CRON_NOW  = Date.UTC(2026, 5, 15); // 2026-06-15
const IN_PERIOD = Date.UTC(2026, 4, 15); // 2026-05-15 — inside [May 1, Jun 1)

function seedBrain(env: any, brainId: string, callerId: string): void {
  env.DB.raw()
    .prepare(
      `INSERT INTO brains (brain_id, caller_id, content_hash, input_format, input_sha256,
         input_bytes, node_count, edge_count, agent_name, artifact_r2_key, invariants_passed, created_at)
       VALUES (?, ?, 'h', 'verdigraph_genome', 's', 1, 1, 0, 'a', 'r2', 1, ?)`,
    )
    .run(brainId, callerId, IN_PERIOD);
}

describe("H2 — conservation cron counts all revenue streams", () => {
  it("net_revenue and conservation_share reflect the sum of all four sources", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_h2");
    const db = env.DB.raw();

    // ── Source 1: usage_ledger (per-call routing fee) ──────────────────────
    const ROUTING_GROSS = 10_001;
    const ROUTING_PASSTHROUGH = 2_000;
    const routingNet = ROUTING_GROSS - ROUTING_PASSTHROUGH; // 8_001
    db.prepare(
      `INSERT INTO usage_ledger (id, caller_id, tool_name, request_id, input_tokens, output_tokens,
         model_cost_usd_micros, routing_fee_usd_micros, total_charged_usd_micros,
         latency_ms, success, occurred_at, settlement_state)
       VALUES ('usg_h2', 'cal_h2', 't', 'r-h2', 0, 0, ?, ?, ?, 1, 1, ?, 'settled')`,
    ).run(ROUTING_PASSTHROUGH, ROUTING_GROSS - ROUTING_PASSTHROUGH, ROUTING_GROSS, IN_PERIOD);

    // ── Source 2: brain_builds — a brain unlock ────────────────────────────
    seedBrain(env, "BRAINUNLOCKH2000000000000A", "cal_h2");
    const UNLOCK_AMOUNT = 5_000_000;
    db.prepare(
      `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, status, created_at)
       VALUES ('bld_unlock', 'BRAINUNLOCKH2000000000000A', 'cal_h2', 'single_brain_unlock', ?, 'paid', ?)`,
    ).run(UNLOCK_AMOUNT, IN_PERIOD);

    // ── Source 3: brain_builds — an attestation ────────────────────────────
    seedBrain(env, "BRAINATTESTH2000000000000A", "cal_h2");
    const ATTEST_AMOUNT = 3_000_000;
    db.prepare(
      `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, status, created_at)
       VALUES ('bld_attest', 'BRAINATTESTH2000000000000A', 'cal_h2', 'attestation', ?, 'paid', ?)`,
    ).run(ATTEST_AMOUNT, IN_PERIOD);

    // ── Source 4: a marketplace sale (booked via the real bookPurchase) ────
    seedCaller(env, "cal_creator");
    seedCaller(env, "cal_buyer");
    seedBrain(env, "BRAINMARKETH2000000000000A", "cal_creator");
    db.prepare(
      `INSERT INTO marketplace_listings (listing_id, brain_id, creator_caller_id, parent_brain_id,
         title, description, price_usd_micros, status, visibility, view_count, purchase_count, created_at, updated_at)
       VALUES ('LISTINGMARKETH20000000000A', 'BRAINMARKETH2000000000000A', 'cal_creator', NULL,
         'T', 'D', 9000000, 'published', 'public', 0, 0, ?, ?)`,
    ).run(IN_PERIOD, IN_PERIOD);
    const MKT_GROSS = 9_000_000;
    const MKT_FEE = estimateStripeFeeMicros(MKT_GROSS);
    const marketplaceNet = MKT_GROSS - MKT_FEE;
    await bookPurchase(env, {
      listingId: "LISTINGMARKETH20000000000A",
      buyerCallerId: "cal_buyer",
      stripeSessionId: "cs_test_h2",
      grossUsdMicros: MKT_GROSS,
      stripeFeeMicros: MKT_FEE,
    });
    // bookPurchase stamps created_at = Date.now(); backdate into the period so
    // the cron's [periodStart, periodEnd) window is deterministic.
    db.prepare(`UPDATE marketplace_purchases SET created_at = ?`).run(IN_PERIOD);
    db.prepare(`UPDATE marketplace_conservation_ledger SET created_at = ?`).run(IN_PERIOD);

    // ── Run the cron for May 2026 ──────────────────────────────────────────
    const expectedNet = routingNet + UNLOCK_AMOUNT + ATTEST_AMOUNT + marketplaceNet;
    const expectedShare = Math.floor(expectedNet / 4); // CONSERVATION_RATIO 1/4

    const result = await runMonthlyConservationCron(env, { now: CRON_NOW });

    expect(result.net_revenue_usd_micros).toBe(expectedNet);
    expect(result.conservation_share_usd_micros).toBe(expectedShare);

    // The persisted conservation_payouts row carries the same figures and
    // satisfies the CHECK (share == net / 4).
    const payout = db.prepare(
      `SELECT net_revenue_usd_micros AS net, conservation_share_usd_micros AS share,
              gross_revenue_usd_micros AS gross, passthrough_cost_usd_micros AS passthrough
         FROM conservation_payouts WHERE id = ?`,
    ).get(result.payoutId) as any;
    expect(payout.net).toBe(expectedNet);
    expect(payout.share).toBe(expectedShare);
    expect(payout.gross - payout.passthrough).toBe(expectedNet);

    // Point 2: the marketplace conservation ledger row was linked to the payout.
    const linked = db.prepare(
      `SELECT conservation_payout_id AS pid FROM marketplace_conservation_ledger`,
    ).get() as any;
    expect(linked.pid).toBe(result.payoutId);
  });

  it("routing fees alone are NOT the whole story — brain_builds revenue is counted", async () => {
    // Regression guard: a period with ZERO usage_ledger rows but a paid
    // brain_build must still produce a conservation payout.
    const env = makeTestEnv();
    seedCaller(env, "cal_only_builds");
    seedBrain(env, "BRAINONLYBUILDS0000000000A", "cal_only_builds");
    env.DB.raw().prepare(
      `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, status, created_at)
       VALUES ('bld_only', 'BRAINONLYBUILDS0000000000A', 'cal_only_builds', 'single_brain_unlock', 4000000, 'paid', ?)`,
    ).run(IN_PERIOD);

    const result = await runMonthlyConservationCron(env, { now: CRON_NOW });
    expect(result.net_revenue_usd_micros).toBe(4_000_000);
    expect(result.conservation_share_usd_micros).toBe(1_000_000);
  });

  it("a period with no revenue at all yields no payout", async () => {
    const env = makeTestEnv();
    const result = await runMonthlyConservationCron(env, { now: CRON_NOW });
    expect(result.status).toBe("no_revenue");
    expect(result.conservation_share_usd_micros).toBe(0);
  });
});
