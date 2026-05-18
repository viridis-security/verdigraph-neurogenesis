// src/billing/conservation.ts — monthly 25%-of-net conservation payout.
//
// Wired via wrangler.toml `triggers.crons = ["0 0 1 * *"]` so this runs at
// 00:00 UTC on the 1st of every month for the *previous* calendar month.
//
// Aggregates usage_ledger rows where success=1 in [period_start, period_end),
// computes net = sum(total_charged - model_cost), conservation share = floor(net/4),
// inserts a conservation_payouts row with status='pending', then calls
// stripe.transfers.create to CONSERVATION_RECIPIENT. On success the row flips to
// 'sent' with stripe_transfer_id; on failure it stays 'pending' for retry.
//
// Idempotency: conservation_payouts is indexed on (period_start, period_end);
// we skip if a non-failed row already exists for the period.

import { ulid } from "ulid";
import { getStripeClient } from "./stripe";
import { conservationShareUsdMicros } from "./ledger";
import type { Env } from "../index";

export async function runMonthlyConservationCron(env: Env): Promise<{
  status: "skipped" | "sent" | "pending" | "no_revenue";
  payoutId?: string;
  period_start: number;
  period_end: number;
  net_revenue_usd_micros: number;
  conservation_share_usd_micros: number;
  stripe_transfer_id?: string;
  error?: string;
}> {
  const { periodStart, periodEnd } = previousMonthUtc();

  // Skip if a successful or pending payout already exists for this period.
  const existing = await env.DB
    .prepare(
      `SELECT id, status, stripe_transfer_id FROM conservation_payouts
        WHERE period_start = ?1 AND period_end = ?2
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(periodStart, periodEnd)
    .first<{ id: string; status: string; stripe_transfer_id: string | null }>();
  if (existing && existing.status === "sent") {
    const base = {
      status: "skipped" as const,
      payoutId: existing.id,
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: 0,
      conservation_share_usd_micros: 0,
    };
    return existing.stripe_transfer_id
      ? { ...base, stripe_transfer_id: existing.stripe_transfer_id }
      : base;
  }

  // Aggregate prior-month usage. Only success=1 rows contribute.
  const agg = await env.DB
    .prepare(
      `SELECT
         COALESCE(SUM(total_charged_usd_micros), 0)              AS gross,
         COALESCE(SUM(model_cost_usd_micros), 0)                 AS passthrough
       FROM usage_ledger
       WHERE success = 1
         AND occurred_at >= ?1
         AND occurred_at <  ?2`,
    )
    .bind(periodStart, periodEnd)
    .first<{ gross: number; passthrough: number }>();

  const gross        = agg?.gross ?? 0;
  const passthrough  = agg?.passthrough ?? 0;
  const netRevenue   = Math.max(0, gross - passthrough);

  if (netRevenue === 0) {
    return {
      status: "no_revenue",
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: 0,
      conservation_share_usd_micros: 0,
    };
  }

  const share = conservationShareUsdMicros(env, netRevenue);
  if (share === 0) {
    // Net revenue below 4 micro-USD — nothing to send.
    return {
      status: "no_revenue",
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: netRevenue,
      conservation_share_usd_micros: 0,
    };
  }

  const recipient = env.CONSERVATION_RECIPIENT;
  const payoutId  = existing?.id ?? `pay_${ulid()}`;
  const now       = Date.now();

  if (!existing) {
    await env.DB
      .prepare(
        `INSERT INTO conservation_payouts
           (id, period_start, period_end,
            gross_revenue_usd_micros, passthrough_cost_usd_micros,
            net_revenue_usd_micros,   conservation_share_usd_micros,
            recipient, stripe_transfer_id, status, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, 'pending', ?9, ?10)`,
      )
      .bind(
        payoutId,
        periodStart,
        periodEnd,
        gross,
        passthrough,
        netRevenue,
        share,
        recipient ?? "unconfigured",
        `auto-cron monthly conservation share floor(net/4) = ${share}`,
        now,
      )
      .run();
  }

  const stripe = getStripeClient(env);
  if (!stripe || !recipient) {
    return {
      status: "pending",
      payoutId,
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: netRevenue,
      conservation_share_usd_micros: share,
      error: !stripe ? "Stripe not configured" : "CONSERVATION_RECIPIENT not configured",
    };
  }

  // Stripe transfers use integer cents. Floor-divide micros->cents (10_000 micros = 1 cent).
  // floor(share/10_000) is safe: if share is below 10_000 micros (= $0.01), we have nothing
  // to transfer and leave the row pending until next month's aggregation rolls forward.
  const amountCents = Math.floor(share / 10_000);
  if (amountCents <= 0) {
    return {
      status: "pending",
      payoutId,
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: netRevenue,
      conservation_share_usd_micros: share,
      error: "share below $0.01 — accumulating",
    };
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: recipient,
      transfer_group: `verdigraph-conservation-${periodStart}`,
      metadata: {
        payout_id: payoutId,
        period_start: String(periodStart),
        period_end: String(periodEnd),
        net_revenue_usd_micros: String(netRevenue),
        conservation_share_usd_micros: String(share),
      },
    });
    await env.DB
      .prepare(
        `UPDATE conservation_payouts
            SET status = 'sent', stripe_transfer_id = ?1
          WHERE id = ?2`,
      )
      .bind(transfer.id, payoutId)
      .run();
    return {
      status: "sent",
      payoutId,
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: netRevenue,
      conservation_share_usd_micros: share,
      stripe_transfer_id: transfer.id,
    };
  } catch (err) {
    // Leave the row 'pending' — next month's cron run picks it up.
    return {
      status: "pending",
      payoutId,
      period_start: periodStart,
      period_end:   periodEnd,
      net_revenue_usd_micros: netRevenue,
      conservation_share_usd_micros: share,
      error: (err as Error).message,
    };
  }
}

/** Returns [periodStart, periodEnd) for the prior UTC calendar month, in unix ms. */
function previousMonthUtc(now: Date = new Date()): { periodStart: number; periodEnd: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  // Start of prior month
  const startYear  = m === 0 ? y - 1 : y;
  const startMonth = m === 0 ? 11    : m - 1;
  const periodStart = Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0);
  // End of prior month == start of current month
  const periodEnd   = Date.UTC(y,         m,           1, 0, 0, 0, 0);
  return { periodStart, periodEnd };
}
