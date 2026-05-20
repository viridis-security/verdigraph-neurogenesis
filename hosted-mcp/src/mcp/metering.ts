// src/mcp/metering.ts — meteredTool helper with prepaid-credits gating.
//
// Order of operations for a metered call:
//  1. Replay check — if (caller_id, request_id) already in usage_ledger, return cached row.
//  2. Quote the call — compute total_charged_usd_micros (routing fee + passthrough).
//  3. Atomic credit debit — UPDATE credit_balances ... WHERE balance >= total. On
//     insufficient credits: write a success=0, error_code='INSUFFICIENT_CREDITS' ledger
//     row and return a payload pointing the caller at verdigraph_create_topup_session.
//  4. Run the tool body. On exception: refund the debit, write failure row, return error.
//  5. On success: write success row, fire Stripe meter event (best-effort).

import type { Env } from "../index";
import { writeLedger, priceCall, type CallContext, type LedgerRow, type UsageReport } from "../billing/ledger";
import { recordStripeMeterEvent } from "../billing/stripe";
import { tryDebitUsdMicros, creditUsdMicros, getBalanceUsdMicros, InsufficientCreditsError, microsToUsdString } from "../billing/credits";

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
  const t0 = Date.now();
  const callCtx: CallContext = { ...ctx, startedAt: t0 };

  // 1. Replay short-circuit
  const existing = await env.DB
    .prepare(`SELECT * FROM usage_ledger WHERE caller_id = ?1 AND request_id = ?2 LIMIT 1`)
    .bind(ctx.callerId, ctx.requestId)
    .first<any>();
  if (existing) {
    return {
      result: undefined as unknown as TResult,
      row: rowFromAny(existing),
      replayed: true,
    };
  }

  // 2. Quote the call optimistically (assume success). Failures rewrite to 0 below.
  //    For now we know the routing fee; passthrough is filled by the body. We deduct
  //    only the routing fee up front (most tools don't burn model tokens). If a tool
  //    later reports modelCostUsdMicros > 0, we top-deduct after the body runs.
  const provisionalReport: UsageReport = {
    modelUsed: null, inputTokens: 0, outputTokens: 0,
    modelCostUsdMicros: 0, success: true, latencyMs: 0,
  };
  const quote = priceCall(env, provisionalReport);
  const provisionalDebit = quote.totalChargedUsdMicros;

  // 3. Atomic debit
  try {
    if (provisionalDebit > 0) await tryDebitUsdMicros(env, ctx.callerId, provisionalDebit);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      const row = await writeLedger(env, callCtx, {
        ...provisionalReport,
        success: false,
        errorCode: "INSUFFICIENT_CREDITS",
        latencyMs: Date.now() - t0,
      });
      const recommend = recommendTopupUsd(err.balanceUsdMicros, err.requiredUsdMicros);
      return {
        result: {
          error: err.message,
          error_code: "INSUFFICIENT_CREDITS",
          balance_usd_micros:  err.balanceUsdMicros,
          required_usd_micros: err.requiredUsdMicros,
          topup_url: "https://verdigraph.dev/credits",
          recommended_amount_usd: recommend,
          remedy: `Visit https://verdigraph.dev/credits to top up (recommend $${recommend}). Or call verdigraph_create_topup_session for an OAuth'd Stripe link, or verdigraph_redeem_credit_code if you have a vdc_ code.`,
        } as unknown as TResult,
        row,
        replayed: false,
        insufficientCredits: {
          balance_usd_micros:  err.balanceUsdMicros,
          required_usd_micros: err.requiredUsdMicros,
          balance_usd:         microsToUsdString(err.balanceUsdMicros),
          required_usd:        microsToUsdString(err.requiredUsdMicros),
        },
      };
    }
    throw err;
  }

  // 4. Run the body
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
    usage = { ...usage, success: false };
    errorCode = (err as Error).name || "ToolError";
    result = ({ error: (err as Error).message }) as unknown as TResult;
  }

  // 4b. If model passthrough cost > 0, deduct the delta now. Failures here mean we
  //     ran the tool but couldn't bill the passthrough — record as success=true but
  //     log a warning via error_code. Refund logic below handles outright failure.
  let passthroughDebit = 0;
  if (!bodyFailed && usage.modelCostUsdMicros > 0) {
    passthroughDebit = usage.modelCostUsdMicros;
    try {
      await tryDebitUsdMicros(env, ctx.callerId, passthroughDebit);
    } catch (err) {
      // Caller spent down to zero mid-call. Refund the provisional, leave a row.
      await creditUsdMicros(env, ctx.callerId, provisionalDebit);
      const row = await writeLedger(env, callCtx, {
        ...usage,
        success: false,
        errorCode: "INSUFFICIENT_CREDITS_FOR_PASSTHROUGH",
        latencyMs: Date.now() - t0,
      });
      const balanceAfter = await getBalanceUsdMicros(env, ctx.callerId);
      const recommend2 = recommendTopupUsd(balanceAfter, passthroughDebit);
      return {
        result: {
          error: (err as Error).message,
          error_code: "INSUFFICIENT_CREDITS_FOR_PASSTHROUGH",
          balance_usd_micros:  balanceAfter,
          required_usd_micros: passthroughDebit,
          topup_url: "https://verdigraph.dev/credits",
          recommended_amount_usd: recommend2,
          remedy: `Visit https://verdigraph.dev/credits to top up (recommend $${recommend2}). Or call verdigraph_create_topup_session for an OAuth'd Stripe link.`,
        } as unknown as TResult,
        row,
        replayed: false,
        insufficientCredits: {
          balance_usd_micros:  balanceAfter,
          required_usd_micros: passthroughDebit,
          balance_usd:         microsToUsdString(balanceAfter),
          required_usd:        microsToUsdString(passthroughDebit),
        },
      };
    }
  }

  // 5. Failure → refund the provisional. Success → write ledger + fire meter event.
  if (bodyFailed) {
    await creditUsdMicros(env, ctx.callerId, provisionalDebit);
  }

  const report: UsageReport = errorCode !== undefined
    ? { ...usage, latencyMs: Date.now() - t0, errorCode }
    : { ...usage, latencyMs: Date.now() - t0 };

  const row = await writeLedger(env, callCtx, report);

  if (row.success && row.totalChargedUsdMicros > 0) {
    try {
      await recordStripeMeterEvent(env, row);
    } catch {
      // best-effort; never block a tool response on meter delivery
    }
  }

  return { result: (result ?? (undefined as unknown as TResult)), row, replayed: false };
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
