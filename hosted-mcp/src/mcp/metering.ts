// src/mcp/metering.ts — meteredTool helper: wraps a tool body with billing.

import type { Env } from "../index";
import { writeLedger, type CallContext, type LedgerRow, type UsageReport } from "../billing/ledger";
import { recordStripeMeterEvent } from "../billing/stripe";

export interface MeteredCallContext {
  callerId:  string;
  toolName:  string;
  requestId: string;
}

export interface MeteredResult<TResult> {
  result?:   TResult;
  usage:     Omit<UsageReport, "latencyMs">;
  freeOfCharge?: boolean;
}

export interface MeteredOutput<TResult> {
  result:    TResult;
  row:       LedgerRow;
  replayed:  boolean;
}

export async function meteredCall<TResult>(
  env: Env,
  ctx: MeteredCallContext,
  body: () => Promise<MeteredResult<TResult>>,
): Promise<MeteredOutput<TResult>> {
  const t0 = Date.now();
  const callCtx: CallContext = { ...ctx, startedAt: t0 };

  // Replay short-circuit
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

  let result: TResult | undefined;
  let usage: Omit<UsageReport, "latencyMs"> = {
    modelUsed: null, inputTokens: 0, outputTokens: 0,
    modelCostUsdMicros: 0, success: true,
  };
  let errorCode: string | undefined;
  try {
    const out = await body();
    result = out.result;
    usage  = out.usage;
    if (out.freeOfCharge) {
      usage = { ...usage, modelCostUsdMicros: 0 };
    }
  } catch (err) {
    usage  = { ...usage, success: false };
    errorCode = (err as Error).name || "ToolError";
    result = ({ error: (err as Error).message }) as unknown as TResult;
  }

  // Build the UsageReport carefully: only set errorCode when defined
  // (exactOptionalPropertyTypes rejects `errorCode: undefined`).
  const report: UsageReport = errorCode !== undefined
    ? { ...usage, latencyMs: Date.now() - t0, errorCode }
    : { ...usage, latencyMs: Date.now() - t0 };

  const row = await writeLedger(env, callCtx, report);

  if (row.success && row.totalChargedUsdMicros > 0) {
    try {
      await recordStripeMeterEvent(env, row);
    } catch {
      // never block the tool response on meter delivery
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
