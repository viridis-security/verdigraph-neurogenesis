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
import { creditUsdMicros } from "./credits";

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

export async function redeemCreditCode(env: Env, code: string, callerId: string): Promise<{
  redeemed: boolean;
  amount_usd_micros?: number;
  reason?: string;
}> {
  // Atomic claim: UPDATE gated on status='pending'. Returns 0 rows if already redeemed.
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE credit_codes
        SET status = 'redeemed', redeemed_by_caller = ?, redeemed_at = ?
      WHERE code = ? AND status = 'pending'`
  ).bind(callerId, now, code).run();

  // D1 returns meta.changes for UPDATE
  const changed = (result as any).meta?.changes ?? 0;
  if (!changed) {
    // Either code doesn't exist, or already redeemed/refunded.
    const row = await env.DB.prepare(`SELECT status FROM credit_codes WHERE code = ?`).bind(code).first<{ status: string }>();
    if (!row) return { redeemed: false, reason: "code_not_found" };
    if (row.status === "redeemed") return { redeemed: false, reason: "already_redeemed" };
    if (row.status === "refunded") return { redeemed: false, reason: "refunded" };
    return { redeemed: false, reason: "claim_race" };
  }

  // Credit the caller's balance. Read the amount from the now-redeemed row.
  const row = await env.DB.prepare(`SELECT amount_usd_micros FROM credit_codes WHERE code = ?`).bind(code).first<{ amount_usd_micros: number }>();
  if (!row) throw new Error("credit_codes_invariant_violation");
  await creditUsdMicros(env, callerId, row.amount_usd_micros);
  return { redeemed: true, amount_usd_micros: row.amount_usd_micros };
}

export async function getCodeBySession(env: Env, stripeSessionId: string): Promise<CreditCodeRow | null> {
  return await env.DB.prepare(`SELECT * FROM credit_codes WHERE stripe_session_id = ?`).bind(stripeSessionId).first<CreditCodeRow>();
}
