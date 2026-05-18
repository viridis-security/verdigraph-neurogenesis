// src/billing/credits.ts — prepaid credit balance ledger.
//
// Invariants:
//  • balance_usd_micros is integer micro-USD, never floats.
//  • Deduction is atomic and conditional: a single SQL UPDATE with
//    WHERE balance_usd_micros >= ?required succeeds or no-ops. Concurrent
//    calls cannot overspend even with replicated D1 reads.
//  • Credits (topups) are idempotent on stripe_session_id via stripe_events PK.
//  • Replay of an already-billed (caller_id, request_id) never re-deducts —
//    meteredCall short-circuits before reaching deduction.

import type { Env } from "../index";

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly callerId: string,
    public readonly balanceUsdMicros: number,
    public readonly requiredUsdMicros: number,
  ) {
    super(
      `Insufficient credits for caller ${callerId}: balance ${balanceUsdMicros} μUSD, ` +
      `required ${requiredUsdMicros} μUSD. Call verdigraph_create_topup_session to add funds.`,
    );
    this.name = "InsufficientCreditsError";
  }
}

/** Read current balance. Returns 0 if no row exists yet. */
export async function getBalanceUsdMicros(env: Env, callerId: string): Promise<number> {
  const row = await env.DB
    .prepare(`SELECT balance_usd_micros FROM credit_balances WHERE caller_id = ?1`)
    .bind(callerId)
    .first<{ balance_usd_micros: number }>();
  return row?.balance_usd_micros ?? 0;
}

/**
 * Atomically deduct `amount` from the caller's balance, only if it covers `amount`.
 * Returns the new balance on success, throws InsufficientCreditsError otherwise.
 *
 * Behavior: a single UPDATE ... WHERE balance >= amount. If the row exists and the
 * balance is sufficient, the deduction lands and `meta.changes` is 1. Otherwise
 * we read the current balance and throw.
 */
export async function tryDebitUsdMicros(
  env: Env,
  callerId: string,
  amount: number,
): Promise<number> {
  if (amount <= 0) return getBalanceUsdMicros(env, callerId);

  const now = Date.now();
  const update = await env.DB
    .prepare(
      `UPDATE credit_balances
          SET balance_usd_micros = balance_usd_micros - ?1,
              updated_at         = ?2
        WHERE caller_id = ?3
          AND balance_usd_micros >= ?1`,
    )
    .bind(amount, now, callerId)
    .run();

  if (update.meta.changes === 1) {
    const after = await getBalanceUsdMicros(env, callerId);
    return after;
  }
  // Either no row or insufficient. Surface the real balance.
  const balance = await getBalanceUsdMicros(env, callerId);
  throw new InsufficientCreditsError(callerId, balance, amount);
}

/**
 * Atomically credit a caller's balance (idempotent via the caller — the
 * webhook layer enforces stripe_session idempotency via stripe_events PK).
 * Creates the row on first credit.
 */
export async function creditUsdMicros(
  env: Env,
  callerId: string,
  amount: number,
): Promise<number> {
  if (amount <= 0) return getBalanceUsdMicros(env, callerId);
  const now = Date.now();
  await env.DB
    .prepare(
      `INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (caller_id) DO UPDATE SET
         balance_usd_micros = balance_usd_micros + excluded.balance_usd_micros,
         updated_at         = excluded.updated_at`,
    )
    .bind(callerId, amount, now)
    .run();
  return getBalanceUsdMicros(env, callerId);
}

/** Helper: micro-USD → human "$X.YYY" for error messages and UIs. */
export function microsToUsdString(amount: number): string {
  return `$${(amount / 1_000_000).toFixed(6)}`;
}
