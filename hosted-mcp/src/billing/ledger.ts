// src/billing/ledger.ts — usage metering, pricing, ledger writes, conservation split.
//
// Invariants:
//  • Every tool execution writes exactly one usage_ledger row (success or failure).
//  • request_id is per (caller_id) idempotent — replay of the same request_id returns
//    the original ledger row instead of double-charging.
//  • All money is integer micro-USD. No floats.
//  • Conservation share = floor(net_revenue / 4). Floor not round, by genome contract.

import { ulid } from "ulid";
import type { Env } from "../index";

export interface CallContext {
  callerId:  string;
  toolName:  string;
  requestId: string;
  startedAt: number;       // unix ms
}

export interface UsageReport {
  modelUsed:           string | null;
  inputTokens:         number;
  outputTokens:        number;
  modelCostUsdMicros:  number;     // passthrough — what we owe the model provider
  success:             boolean;
  errorCode?:          string;
  latencyMs:           number;
}

export interface LedgerRow {
  id: string;
  callerId: string;
  toolName: string;
  requestId: string;
  modelUsed: string | null;
  inputTokens: number;
  outputTokens: number;
  modelCostUsdMicros: number;
  routingFeeUsdMicros: number;
  totalChargedUsdMicros: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  occurredAt: number;
}

/**
 * Price a call: model passthrough + flat routing fee from env.
 * Returns micro-USD integers.
 */
export function priceCall(
  env: Env,
  report: UsageReport,
): { routingFeeUsdMicros: number; totalChargedUsdMicros: number } {
  const routingFee = parseInt(env.ROUTING_FEE_USD_MICROS, 10);
  if (!Number.isFinite(routingFee) || routingFee < 0) {
    throw new Error(`Invalid ROUTING_FEE_USD_MICROS env: ${env.ROUTING_FEE_USD_MICROS}`);
  }
  // Failed calls: charge no fee, only passthrough (which should also be 0 for failures).
  const total = report.success
    ? report.modelCostUsdMicros + routingFee
    : 0;
  return { routingFeeUsdMicros: report.success ? routingFee : 0, totalChargedUsdMicros: total };
}

/**
 * Idempotent ledger write. If (caller_id, request_id) already exists, returns the
 * existing row without inserting (replay-safe). Otherwise inserts and returns the
 * new row.
 */
export async function writeLedger(
  env: Env,
  ctx: CallContext,
  report: UsageReport,
): Promise<LedgerRow> {
  const { routingFeeUsdMicros, totalChargedUsdMicros } = priceCall(env, report);
  const id = `usg_${ulid()}`;
  const occurredAt = Date.now();

  // SQLite UPSERT idiom: INSERT OR IGNORE then SELECT to detect replay.
  const insert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO usage_ledger
       (id, caller_id, tool_name, request_id, model_used,
        input_tokens, output_tokens,
        model_cost_usd_micros, routing_fee_usd_micros, total_charged_usd_micros,
        latency_ms, success, error_code, occurred_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    )
    .bind(
      id,
      ctx.callerId,
      ctx.toolName,
      ctx.requestId,
      report.modelUsed,
      report.inputTokens,
      report.outputTokens,
      report.modelCostUsdMicros,
      routingFeeUsdMicros,
      totalChargedUsdMicros,
      report.latencyMs,
      report.success ? 1 : 0,
      report.errorCode ?? null,
      occurredAt,
    )
    .run();

  const row = await env.DB
    .prepare(
      `SELECT id, caller_id, tool_name, request_id, model_used,
              input_tokens, output_tokens,
              model_cost_usd_micros, routing_fee_usd_micros, total_charged_usd_micros,
              latency_ms, success, error_code, occurred_at
         FROM usage_ledger
        WHERE caller_id = ?1 AND request_id = ?2`,
    )
    .bind(ctx.callerId, ctx.requestId)
    .first<any>();

  if (!row) throw new Error("Ledger row vanished after insert; likely DB error");

  return {
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
    errorCode: row.error_code ?? undefined,
    occurredAt: row.occurred_at,
  };
}

/**
 * Compute the 25% conservation share for a settled net-revenue figure.
 * Floor division — never over-allocates.
 */
export function conservationShareUsdMicros(env: Env, netRevenueUsdMicros: number): number {
  const num = parseInt(env.CONSERVATION_RATIO_NUM, 10);
  const den = parseInt(env.CONSERVATION_RATIO_DEN, 10);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) {
    throw new Error("Invalid CONSERVATION_RATIO env");
  }
  return Math.floor((netRevenueUsdMicros * num) / den);
}
