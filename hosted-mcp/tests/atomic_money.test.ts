// tests/atomic_money.test.ts — iter4 H3: atomic multi-statement money paths.
//
// Invariant under test: every money mutation that spans more than one SQL
// statement either fully applies or fully rolls back — no partial state is
// ever observable.
//
// The DB is a real in-memory SQLite instance built from the repo migrations,
// so D1 batch semantics (one transaction, all-or-nothing) and the FOREIGN KEY
// / CHECK constraints that make a forced mid-batch failure realistic are all
// genuinely enforced.

import { describe, it, expect } from "vitest";
import { redeemCreditCode } from "../src/billing/credit_codes";
import { bookPurchase, estimateStripeFeeMicros, computeSplit } from "../src/brainbuilder/marketplace";
import { makeTestEnv, seedCaller } from "./helpers/d1";

function seedCreditCode(env: any, code: string, amountUsdMicros: number, status = "pending"): void {
  env.DB.raw()
    .prepare(
      `INSERT INTO credit_codes (code, amount_usd_micros, status, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(code, amountUsdMicros, status, Date.now());
}

function codeStatus(env: any, code: string): string | undefined {
  const r = env.DB.raw().prepare(`SELECT status FROM credit_codes WHERE code = ?`).get(code) as
    | { status: string }
    | undefined;
  return r?.status;
}

function balance(env: any, callerId: string): number {
  const r = env.DB.raw()
    .prepare(`SELECT balance_usd_micros AS b FROM credit_balances WHERE caller_id = ?`)
    .get(callerId) as { b: number } | undefined;
  return r?.b ?? 0;
}

describe("H3 — redeemCreditCode is atomic", () => {
  it("happy path: code flips to redeemed AND balance is credited", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_redeem");
    seedCreditCode(env, "vdc_HAPPY", 5_000_000);

    const out = await redeemCreditCode(env, "vdc_HAPPY", "cal_redeem");

    expect(out.redeemed).toBe(true);
    expect(out.amount_usd_micros).toBe(5_000_000);
    expect(codeStatus(env, "vdc_HAPPY")).toBe("redeemed");
    expect(balance(env, "cal_redeem")).toBe(5_000_000);
  });

  it("replay: a second redemption of the same code never double-credits", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_replay");
    seedCreditCode(env, "vdc_REPLAY", 3_000_000);

    const first = await redeemCreditCode(env, "vdc_REPLAY", "cal_replay");
    const second = await redeemCreditCode(env, "vdc_REPLAY", "cal_replay");

    expect(first.redeemed).toBe(true);
    expect(second.redeemed).toBe(false);
    expect(second.reason).toBe("already_redeemed");
    expect(balance(env, "cal_replay")).toBe(3_000_000); // credited exactly once
  });

  it("ACCEPTANCE: a failure on the second statement leaves the code NOT consumed", async () => {
    // Force the credit (statement 2) to fail: redeem for a caller that does not
    // exist in `callers`. The INSERT into credit_balances violates the FOREIGN
    // KEY, so the whole batch — including the claim (statement 1) — rolls back.
    const env = makeTestEnv();
    seedCreditCode(env, "vdc_GHOST", 9_000_000);
    // NOTE: deliberately no seedCaller("cal_ghost").

    const out = await redeemCreditCode(env, "vdc_GHOST", "cal_ghost");

    expect(out.redeemed).toBe(false);
    // The code was NOT consumed — it is still redeemable.
    expect(codeStatus(env, "vdc_GHOST")).toBe("pending");
    // No credit balance row was created.
    expect(balance(env, "cal_ghost")).toBe(0);
  });

  it("after a rolled-back attempt the code is still redeemable by a valid caller", async () => {
    const env = makeTestEnv();
    seedCreditCode(env, "vdc_RETRY", 1_000_000);
    const failed = await redeemCreditCode(env, "vdc_RETRY", "cal_ghost2");
    expect(failed.redeemed).toBe(false);
    expect(codeStatus(env, "vdc_RETRY")).toBe("pending");

    seedCaller(env, "cal_real");
    const ok = await redeemCreditCode(env, "vdc_RETRY", "cal_real");
    expect(ok.redeemed).toBe(true);
    expect(balance(env, "cal_real")).toBe(1_000_000);
  });

  it("concurrent redemption of one code by two callers: exactly one wins", async () => {
    const env = makeTestEnv();
    seedCaller(env, "cal_a");
    seedCaller(env, "cal_b");
    seedCreditCode(env, "vdc_RACE", 7_000_000);

    const [ra, rb] = await Promise.all([
      redeemCreditCode(env, "vdc_RACE", "cal_a"),
      redeemCreditCode(env, "vdc_RACE", "cal_b"),
    ]);

    const winners = [ra, rb].filter((r) => r.redeemed);
    expect(winners.length).toBe(1);
    // The code is credited exactly once, in total, across both callers.
    expect(balance(env, "cal_a") + balance(env, "cal_b")).toBe(7_000_000);
    expect(codeStatus(env, "vdc_RACE")).toBe("redeemed");
  });
});

describe("H3 — bookPurchase commits all five writes atomically", () => {
  function seedListing(env: any): { listingId: string; brainId: string } {
    const now = Date.now();
    seedCaller(env, "cal_creator");
    seedCaller(env, "cal_buyer");
    const brainId = "BRAINBOOKPURCHASE00000000AA";
    env.DB.raw()
      .prepare(
        `INSERT INTO brains (brain_id, caller_id, content_hash, input_format, input_sha256,
           input_bytes, node_count, edge_count, agent_name, artifact_r2_key, invariants_passed, created_at)
         VALUES (?, ?, 'hash', 'verdigraph_genome', 'sha', 10, 4, 2, 'agent', 'r2/key', 1, ?)`,
      )
      .run(brainId, "cal_creator", now);
    const listingId = "LISTINGBOOKPURCHASE0000000A";
    env.DB.raw()
      .prepare(
        `INSERT INTO marketplace_listings (listing_id, brain_id, creator_caller_id, parent_brain_id,
           title, description, price_usd_micros, status, visibility, view_count, purchase_count, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'Title', 'Desc', 9000000, 'published', 'public', 0, 0, ?, ?)`,
      )
      .run(listingId, brainId, "cal_creator", now, now);
    return { listingId, brainId };
  }

  it("happy path: purchase, creator balance, conservation ledger, unlock, counter all land", async () => {
    const env = makeTestEnv();
    const { listingId, brainId } = seedListing(env);
    const gross = 9_000_000;
    const fee = estimateStripeFeeMicros(gross);
    const split = computeSplit(gross, fee);

    await bookPurchase(env, {
      listingId,
      buyerCallerId: "cal_buyer",
      stripeSessionId: "cs_test_bookpurchase",
      grossUsdMicros: gross,
      stripeFeeMicros: fee,
    });

    const db = env.DB.raw();
    const purchase = db.prepare(`SELECT * FROM marketplace_purchases WHERE stripe_session_id = ?`).get("cs_test_bookpurchase") as any;
    expect(purchase).toBeTruthy();
    expect(purchase.net_usd_micros).toBe(split.net_micros);

    const creatorBal = db.prepare(`SELECT owed_usd_micros AS o FROM marketplace_creator_balances WHERE caller_id = ?`).get("cal_creator") as any;
    expect(creatorBal.o).toBe(split.creator_share);

    const cons = db.prepare(`SELECT share_usd_micros AS s FROM marketplace_conservation_ledger WHERE purchase_id = ?`).get(purchase.purchase_id) as any;
    expect(cons.s).toBe(split.conservation_share);

    const unlock = db.prepare(`SELECT COUNT(*) AS n FROM brain_builds WHERE brain_id = ? AND caller_id = ? AND status = 'paid'`).get(brainId, "cal_buyer") as any;
    expect(unlock.n).toBe(1);

    const listing = db.prepare(`SELECT purchase_count AS c FROM marketplace_listings WHERE listing_id = ?`).get(listingId) as any;
    expect(listing.c).toBe(1);
  });

  it("idempotent: re-booking the same Stripe session is a no-op", async () => {
    const env = makeTestEnv();
    const { listingId } = seedListing(env);
    const args = {
      listingId,
      buyerCallerId: "cal_buyer",
      stripeSessionId: "cs_test_idem",
      grossUsdMicros: 9_000_000,
      stripeFeeMicros: estimateStripeFeeMicros(9_000_000),
    };
    await bookPurchase(env, args);
    await bookPurchase(env, args);
    const n = env.DB.raw().prepare(`SELECT COUNT(*) AS n FROM marketplace_purchases`).get() as any;
    expect(n.n).toBe(1);
  });
});
