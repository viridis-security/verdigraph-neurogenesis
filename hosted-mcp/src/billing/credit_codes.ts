// src/billing/credit_codes.ts — anonymous credit codes + redemption (C-INV1, C-INV5).
//
// Flow:
//   1. Human visits /credits, picks amount, optionally enters caller_id.
//   2. POST /credits/checkout → Stripe Checkout session is minted.
//   3. On checkout.session.completed (verdigraph_purpose: "anonymous_credit_topup"):
//      - If caller_id is in metadata → credit that caller directly (skip code).
//      - Otherwise → mint a 'vdc_<24-char-crockford>' code; persist with status='pending'.
//   4. Success page shows the code; webhook email also sends it.
//   5. Bot calls verdigraph_redeem_credit_code(code) → atomic claim + credit.

import type { Env } from "../index";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newCreditCode(): string {
  const rnd = new Uint8Array(24);
  crypto.getRandomValues(rnd);
  let s = ""; for (let i = 0; i < 24; i++) s += ALPHABET[rnd[i]! & 0x1f] ?? "0";
  return "vdc_" + s;
}

export interface CreditCodeRow {
  code: string;
  amount_usd_micros: number;
  status: "pending" | "redeemed" | "refunded";
  buyer_email: string | null;
  stripe_session_id: string | null;
  redeemed_by_caller: string | null;
  created_at: number;
  redeemed_at: number | null;
}

export async function mintCreditCode(env: Env, args: {
  amountUsdMicros: number;
  buyerEmail: string | null;
  stripeSessionId: string;
}): Promise<CreditCodeRow> {
  const now = Date.now();
  // Idempotency: if a code already exists for this Stripe session, return it.
  const existing = await env.DB.prepare(
    `SELECT * FROM credit_codes WHERE stripe_session_id = ?`
  ).bind(args.stripeSessionId).first<CreditCodeRow>();
  if (existing) return existing;

  // Mint a fresh code. Retry on extremely unlikely collision.
  for (let i = 0; i < 5; i++) {
    const code = newCreditCode();
    try {
      await env.DB.prepare(
        `INSERT INTO credit_codes (code, amount_usd_micros, status, buyer_email, stripe_session_id, created_at)
         VALUES (?, ?, 'pending', ?, ?, ?)`
      ).bind(code, args.amountUsdMicros, args.buyerEmail, args.stripeSessionId, now).run();
      return {
        code, amount_usd_micros: args.amountUsdMicros, status: "pending",
        buyer_email: args.buyerEmail, stripe_session_id: args.stripeSessionId,
        redeemed_by_caller: null, created_at: now, redeemed_at: null,
      };
    } catch (e) {
      // Unique-constraint clash on `code`; retry.
      if (i === 4) throw e;
    }
  }
  throw new Error("credit_code_mint_failed");
}

// Module-level monotonic redemption clock. Guarantees two redemptions handled
// by the same isolate receive distinct redeemed_at values, so a same-caller
// self-race cannot double-credit: the credit statement is gated on the exact
// redeemed_at written by its sibling claim within the same atomic batch.
let lastRedeemTs = 0;
function nextRedeemTs(): number {
  const now = Date.now();
  lastRedeemTs = now > lastRedeemTs ? now : lastRedeemTs + 1;
  return lastRedeemTs;
}

/**
 * Redeem a credit code (iter4 H3 — atomic money path).
 *
 * The claim (flip code to 'redeemed') and the credit (add to the caller's
 * balance) run as ONE D1 batch — a single transaction. Either both apply or
 * neither does, so a crash or DB error mid-sequence can never burn a code
 * without delivering its credit (or vice versa).
 *
 * The credit is an INSERT...SELECT gated on (code, status='redeemed',
 * redeemed_by_caller, redeemed_at) so it produces a balance row ONLY when this
 * exact claim landed — a claim that lost a concurrent race yields an empty
 * SELECT and applies no credit.
 */
export async function redeemCreditCode(env: Env, code: string, callerId: string): Promise<{
  redeemed: boolean;
  amount_usd_micros?: number;
  reason?: string;
}> {
  // 1. Read-only pre-check — resolves not-found / already-redeemed / refunded
  //    (including every replay) without mutating anything.
  const pre = await env.DB.prepare(
    `SELECT status, amount_usd_micros FROM credit_codes WHERE code = ?`
  ).bind(code).first<{ status: string; amount_usd_micros: number }>();
  if (!pre) return { redeemed: false, reason: "code_not_found" };
  if (pre.status === "redeemed") return { redeemed: false, reason: "already_redeemed" };
  if (pre.status === "refunded") return { redeemed: false, reason: "refunded" };

  // 2. Claim + credit as one atomic batch (single transaction).
  const redeemedAt = nextRedeemTs();
  const claim = env.DB.prepare(
    `UPDATE credit_codes
        SET status = 'redeemed', redeemed_by_caller = ?1, redeemed_at = ?2
      WHERE code = ?3 AND status = 'pending'`
  ).bind(callerId, redeemedAt, code);
  const credit = env.DB.prepare(
    `INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at)
     SELECT ?1, cc.amount_usd_micros, ?2
       FROM credit_codes cc
      WHERE cc.code = ?3
        AND cc.status = 'redeemed'
        AND cc.redeemed_by_caller = ?1
        AND cc.redeemed_at = ?2
     ON CONFLICT (caller_id) DO UPDATE SET
       balance_usd_micros = balance_usd_micros + excluded.balance_usd_micros,
       updated_at         = excluded.updated_at`
  ).bind(callerId, redeemedAt, code);

  let results: D1Result[];
  try {
    results = await env.DB.batch([claim, credit]);
  } catch {
    // Batch rolled back — the code remains 'pending' and no credit was applied.
    return { redeemed: false, reason: "redeem_failed" };
  }

  const claimed = (results[0]?.meta?.changes ?? 0) === 1;
  if (!claimed) {
    // Lost a race to a concurrent redeemer between the pre-check and the batch.
    return { redeemed: false, reason: "claim_race" };
  }
  return { redeemed: true, amount_usd_micros: pre.amount_usd_micros };
}

export async function getCodeBySession(env: Env, stripeSessionId: string): Promise<CreditCodeRow | null> {
  return await env.DB.prepare(`SELECT * FROM credit_codes WHERE stripe_session_id = ?`).bind(stripeSessionId).first<CreditCodeRow>();
}
