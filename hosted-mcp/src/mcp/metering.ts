// src/mcp/metering.ts — meteredCall helper with exactly-once prepaid-credits gating.
//
// ── Exactly-once invariant (iter4 H1) ──────────────────────────────────────
// For any (caller_id, request_id) pair, across any number of concurrent or
// retried calls, the total credits debited and the total Stripe meter events
// fired are each EXACTLY ONE.
//
// How: the call first RESERVES a usage_ledger row via
//   INSERT ... ON CONFLICT (caller_id, request_id) DO NOTHING
// The UNIQUE index idx_ledger_request_id elects exactly one winner. A losing
// insert (meta.changes === 0) is a replay or a concurrent duplicate: it NEVER
// debits — it waits for the winner to finalize the row and returns it.
//
// The previous implementation did a `SELECT ... WHERE request_id` replay check
// and THEN debited as a separate statement. Two concurrent calls both passed
// the SELECT (no row yet) and both debited — a TOCTOU race. Reserving the row
// before debiting closes that window: the database, not application code,
// decides the single winner.
//
// Order of operations for the winner:
//   1. Reserve the ledger row ('pending').
//   2. Quote the routing fee and debit it (the credit gate — before the body).
//   3. Run the tool body.
//   4. Settle: on failure refund + finalize as one atomic batch; on success
//      apply any model-passthrough delta then finalize.
//   5. Fire the Stripe meter event once, on the transition to settled-success.

import { ulid } from "ulid";
import { priceCall, type LedgerRow, type UsageReport } from "../billing/ledger";
import { recordStripeMeterEvent } from "../billing/stripe";
import {
  tryDebitUsdMicros,
  getBalanceUsdMicros,
  InsufficientCreditsError,
  microsToUsdString,
} from "../billing/credits";
import type { Env } from "../index";

export interface MeteredCallContext {
  callerId:  string;
  toolName:  string;
  requestId: string;
}

export interface MeteredResult<TResult> {
  result?: TResult;
  usage:   Omit<UsageReport, "latencyMs">;
  freeOfCharge?: boolean;
}

export interface MeteredOutput<TResult> {
  result:    TResult;
  row:       LedgerRow;
  replayed:  boolean;
  /** Set when the call failed due to insufficient credits — caller should top up. */
  insufficientCredits?: {
    balance_usd_micros:  number;
    required_usd_micros: number;
    balance_usd:         string;
    required_usd:        string;
  };
}

// How long a losing (replay / concurrent-duplicate) call waits for the winner
// to finalize the shared ledger row before giving up and returning it as-is.
const SETTLE_POLL_MS       = 20;
const SETTLE_POLL_ATTEMPTS = 150; // 150 * 20ms = 3s ceiling

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function recommendTopupUsd(balanceMicros: number, requiredMicros: number): number {
  const gapUsd = Math.max(0, (requiredMicros - balanceMicros) / 1_000_000);
  if (gapUsd <= 5)   return 5;
  if (gapUsd <= 20)  return 20;
  if (gapUsd <= 100) return 100;
  return Math.min(500, Math.ceil(gapUsd / 50) * 50);
}

export async function meteredCall<TResult>(
  env: Env,
  ctx: MeteredCallContext,
  body: () => Promise<MeteredResult<TResult>>,
): Promise<MeteredOutput<TResult>> {
  const t0       = Date.now();
  const ledgerId = `usg_${ulid()}`;

  // ── 1. Reserve the (caller_id, request_id) slot ──────────────────────────
  // ON CONFLICT on the unique index makes exactly one INSERT win. Any other
  // error (FK, etc.) still throws — only the duplicate-key case is a no-op.
  const reservation = await env.DB
    .prepare(
      `INSERT INTO usage_ledger
         (id, caller_id, tool_name, request_id, model_used,
          input_tokens, output_tokens,
          model_cost_usd_micros, routing_fee_usd_micros, total_charged_usd_micros,
          latency_ms, success, error_code, occurred_at, settlement_state)
       VALUES (?1, ?2, ?3, ?4, NULL, 0, 0, 0, 0, 0, 0, 0, NULL, ?5, 'pending')
       ON CONFLICT (caller_id, request_id) DO NOTHING`,
    )
    .bind(ledgerId, ctx.callerId, ctx.toolName, ctx.requestId, t0)
    .run();

  // ── Loser path: replay or concurrent duplicate. Never debit. ─────────────
  if (reservation.meta.changes !== 1) {
    const row = await loadSettledRow(env, ctx.callerId, ctx.requestId);
    return { result: undefined as unknown as TResult, row, replayed: true };
  }

  // ── Winner path ──────────────────────────────────────────────────────────
  // 2. Quote the routing fee and debit it up front — this is the credit gate,
  //    and it must precede the body so a broke caller is rejected before any
  //    work is done. (The provisional debit and the eventual finalize cannot
  //    share one transaction because the body runs between them; the reserved
  //    'pending' row is the durable anchor that makes a *double* charge
  //    impossible, which is the exactly-once invariant.)
  const provisionalReport: UsageReport = {
    modelUsed: null, inputTokens: 0, outputTokens: 0,
    modelCostUsdMicros: 0, success: true, latencyMs: 0,
  };
  const provisionalDebit = priceCall(env, provisionalReport).totalChargedUsdMicros;

  try {
    if (provisionalDebit > 0) await tryDebitUsdMicros(env, ctx.callerId, provisionalDebit);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      // No debit happened. Finalize the reserved row as a failed call.
      const row = await finalizeRow(env, ledgerId, {
        ...provisionalReport, success: false,
        errorCode: "INSUFFICIENT_CREDITS", latencyMs: Date.now() - t0,
      });
      return insufficientResult<TResult>(row, err.balanceUsdMicros, err.requiredUsdMicros, "INSUFFICIENT_CREDITS");
    }
    throw err;
  }

  // 3. Run the body.
  let result: TResult | undefined;
  let usage: Omit<UsageReport, "latencyMs"> = {
    modelUsed: null, inputTokens: 0, outputTokens: 0,
    modelCostUsdMicros: 0, success: true,
  };
  let errorCode: string | undefined;
  let bodyFailed = false;
  try {
    const out = await body();
    result = out.result;
    usage  = out.usage;
    if (out.freeOfCharge) usage = { ...usage, modelCostUsdMicros: 0 };
  } catch (err) {
    bodyFailed = true;
    usage      = { ...usage, success: false };
    errorCode  = (err as Error).name || "ToolError";
    result     = ({ error: (err as Error).message }) as unknown as TResult;
  }

  // 4. Settle.
  // 4a. Body failed → refund the provisional debit and finalize as failed.
  //     Coupled in one atomic batch so a crash cannot leave money refunded
  //     without a settled row, or vice versa.
  if (bodyFailed) {
    const failReport: UsageReport = {
      ...usage, success: false,
      ...(errorCode !== undefined ? { errorCode } : {}),
      latencyMs: Date.now() - t0,
    };
    const row = await settleWithRefund(env, ledgerId, ctx.callerId, provisionalDebit, failReport);
    return { result: (result ?? (undefined as unknown as TResult)), row, replayed: false };
  }

  // 4b. Body succeeded. Charge any model-passthrough delta beyond the routing
  //     fee already debited. modelCost is 0 for every current tool, so the
  //     delta is normally 0 and no second debit happens.
  const finalReport: UsageReport = {
    ...usage, success: true, latencyMs: Date.now() - t0,
  };
  const finalTotal = priceCall(env, finalReport).totalChargedUsdMicros;
  const delta      = finalTotal - provisionalDebit;

  if (delta > 0) {
    try {
      await tryDebitUsdMicros(env, ctx.callerId, delta);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        // Ran the tool but could not bill the passthrough. Refund the
        // provisional debit and finalize as a failed call (atomic batch).
        const failReport: UsageReport = {
          ...usage, success: false,
          errorCode: "INSUFFICIENT_CREDITS_FOR_PASSTHROUGH",
          latencyMs: Date.now() - t0,
        };
        const row = await settleWithRefund(env, ledgerId, ctx.callerId, provisionalDebit, failReport);
        const balanceAfter = await getBalanceUsdMicros(env, ctx.callerId);
        return insufficientResult<TResult>(row, balanceAfter, delta, "INSUFFICIENT_CREDITS_FOR_PASSTHROUGH");
      }
      throw err;
    }
  }

  // 5. Finalize as settled-success, then fire the meter event exactly once.
  const row = await finalizeRow(env, ledgerId, finalReport);

  if (row.success && row.totalChargedUsdMicros > 0) {
    try {
      await recordStripeMeterEvent(env, row);
    } catch {
      // best-effort; never block a tool response on meter delivery
    }
  }

  return { result: (result ?? (undefined as unknown as TResult)), row, replayed: false };
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Build the UPDATE that turns a reserved 'pending' row into a settled one. */
function finalizeStmt(env: Env, ledgerId: string, report: UsageReport) {
  const { routingFeeUsdMicros, totalChargedUsdMicros } = priceCall(env, report);
  return env.DB
    .prepare(
      `UPDATE usage_ledger SET
         model_used               = ?2,
         input_tokens             = ?3,
         output_tokens            = ?4,
         model_cost_usd_micros    = ?5,
         routing_fee_usd_micros   = ?6,
         total_charged_usd_micros = ?7,
         latency_ms               = ?8,
         success                  = ?9,
         error_code               = ?10,
         settlement_state         = 'settled'
       WHERE id = ?1 AND settlement_state = 'pending'`,
    )
    .bind(
      ledgerId,
      report.modelUsed,
      report.inputTokens,
      report.outputTokens,
      report.modelCostUsdMicros,
      routingFeeUsdMicros,
      totalChargedUsdMicros,
      report.latencyMs,
      report.success ? 1 : 0,
      report.errorCode ?? null,
    );
}

/** Build the additive credit (refund) statement. Never fails on balance. */
function creditStmt(env: Env, callerId: string, amount: number) {
  return env.DB
    .prepare(
      `INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT (caller_id) DO UPDATE SET
         balance_usd_micros = balance_usd_micros + excluded.balance_usd_micros,
         updated_at         = excluded.updated_at`,
    )
    .bind(callerId, amount, Date.now());
}

/** Finalize a reserved row (single UPDATE), then read it back as a LedgerRow. */
async function finalizeRow(env: Env, ledgerId: string, report: UsageReport): Promise<LedgerRow> {
  await finalizeStmt(env, ledgerId, report).run();
  return readRow(env, ledgerId);
}

/** Atomically refund `amount` to the caller AND finalize the row, or neither. */
async function settleWithRefund(
  env: Env,
  ledgerId: string,
  callerId: string,
  amount: number,
  report: UsageReport,
): Promise<LedgerRow> {
  const stmts = [finalizeStmt(env, ledgerId, report)];
  if (amount > 0) stmts.unshift(creditStmt(env, callerId, amount));
  await env.DB.batch(stmts);
  return readRow(env, ledgerId);
}

/** Read a settled ledger row by id. */
async function readRow(env: Env, ledgerId: string): Promise<LedgerRow> {
  const row = await env.DB
    .prepare(`SELECT * FROM usage_ledger WHERE id = ?1`)
    .bind(ledgerId)
    .first<any>();
  if (!row) throw new Error(`usage_ledger row vanished after finalize (id=${ledgerId})`);
  return rowFromAny(row);
}

/**
 * Loser path: the row is owned by another (winning) call. Poll until it is
 * 'settled' so the replay returns the genuine, final ledger row.
 */
async function loadSettledRow(env: Env, callerId: string, requestId: string): Promise<LedgerRow> {
  for (let i = 0; i < SETTLE_POLL_ATTEMPTS; i++) {
    const row = await env.DB
      .prepare(`SELECT * FROM usage_ledger WHERE caller_id = ?1 AND request_id = ?2`)
      .bind(callerId, requestId)
      .first<any>();
    if (row && row.settlement_state === "settled") return rowFromAny(row);
    await sleep(SETTLE_POLL_MS);
  }
  // Winner appears stuck/evicted. Return the pending row rather than hanging.
  const row = await env.DB
    .prepare(`SELECT * FROM usage_ledger WHERE caller_id = ?1 AND request_id = ?2`)
    .bind(callerId, requestId)
    .first<any>();
  if (!row) throw new Error("metering reservation vanished before settlement");
  return rowFromAny(row);
}

function insufficientResult<TResult>(
  row: LedgerRow,
  balanceUsdMicros: number,
  requiredUsdMicros: number,
  code: "INSUFFICIENT_CREDITS" | "INSUFFICIENT_CREDITS_FOR_PASSTHROUGH",
): MeteredOutput<TResult> {
  const recommend = recommendTopupUsd(balanceUsdMicros, requiredUsdMicros);
  return {
    result: {
      error: `Insufficient credits (${code}).`,
      error_code: code,
      balance_usd_micros:  balanceUsdMicros,
      required_usd_micros: requiredUsdMicros,
      topup_url: "https://verdigraph.dev/credits",
      recommended_amount_usd: recommend,
      remedy: `Visit https://verdigraph.dev/credits to top up (recommend $${recommend}). ` +
        `Or call verdigraph_create_topup_session for an OAuth'd Stripe link, or ` +
        `verdigraph_redeem_credit_code if you have a vdc_ code.`,
    } as unknown as TResult,
    row,
    replayed: false,
    insufficientCredits: {
      balance_usd_micros:  balanceUsdMicros,
      required_usd_micros: requiredUsdMicros,
      balance_usd:         microsToUsdString(balanceUsdMicros),
      required_usd:        microsToUsdString(requiredUsdMicros),
    },
  };
}

function rowFromAny(row: any): LedgerRow {
  const base = {
    id: row.id,
    callerId: row.caller_id,
    toolName: row.tool_name,
    requestId: row.request_id,
    modelUsed: row.model_used,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    modelCostUsdMicros: row.model_cost_usd_micros,
    routingFeeUsdMicros: row.routing_fee_usd_micros,
    totalChargedUsdMicros: row.total_charged_usd_micros,
    latencyMs: row.latency_ms,
    success: row.success === 1,
    occurredAt: row.occurred_at,
  };
  return row.error_code != null
    ? { ...base, errorCode: row.error_code }
    : base;
}
