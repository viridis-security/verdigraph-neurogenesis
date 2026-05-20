// src/billing/conservation.ts — monthly 25%-of-net conservation payout.
//
// Wired via wrangler.toml `triggers.crons = ["0 0 1 * *"]` so this runs at
// 00:00 UTC on the 1st of every month for the *previous* calendar month.
//
// ── iter4 H2: counts ALL revenue streams ───────────────────────────────────
// Net revenue for a period is the sum of every revenue stream, not routing
// fees alone:
//   • usage_ledger           — per-call routing fees (success rows)
//   • brain_builds (paid)    — brain unlocks AND attestations (same table;
//                              attestations carry product='attestation')
//   • marketplace_purchases  — published-brain marketplace sales
//
//   net  = (routing gross - routing passthrough)
//        +  brain_builds revenue
//        + (marketplace gross - marketplace Stripe fees)
//   conservation_share = floor(net * CONSERVATION_RATIO_NUM / CONSERVATION_RATIO_DEN)
//
// Every marketplace_conservation_ledger row folded into a payout is linked to
// it via conservation_payout_id, so those rows finally have a consumer.
//
// Idempotency: conservation_payouts is indexed on (period_start, period_end);
// a 'sent' row for the period short-circuits the run.

import { ulid } from "ulid";
import { getStripeClient } from "./stripe";
import { conservationShareUsdMicros } from "./ledger";
import type { Env } from "../index";

export async function runMonthlyConservationCron(
  env: Env,
  opts?: { now?: number },
): Promise<{
  status: "skipped" | "sent" | "pending" | "no_revenue";
  payoutId?: string;
  period_start: number;
  period_end: number;
  net_revenue_usd_micros: number;
  conservation_share_usd_micros: number;
  stripe_transfer_id?: string;
  error?: string;
}> {
  const { periodStart, periodEnd } = previousMonthUtc(
    opts?.now !== undefined ? new Date(opts.now) : new Date(),
  );

  // Skip if a successful payout already exists for this period.
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

  // ── Aggregate every revenue stream for the period ────────────────────────
  // Stream 1 — per-call routing fees (success rows only).
  const routing = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(total_charged_usd_micros), 0) AS gross,
              COALESCE(SUM(model_cost_usd_micros), 0)    AS passthrough
         FROM usage_ledger
        WHERE success = 1 AND occurred_at >= ?1 AND occurred_at < ?2`,
    )
    .bind(periodStart, periodEnd)
    .first<{ gross: number; passthrough: number }>();

  // Stream 2 — brain unlocks AND attestations (both land in brain_builds).
  // A marketplace purchase ALSO writes a brain_builds row (an access grant for
  // the buyer, M6) sharing its stripe_session_id with the marketplace_purchases
  // row. Those are NOT separate revenue — the sale is counted under Stream 3 —
  // so they are excluded here to avoid double-counting.
  const builds = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(amount_usd_micros), 0) AS revenue
         FROM brain_builds
        WHERE status = 'paid' AND created_at >= ?1 AND created_at < ?2
          AND ( stripe_session_id IS NULL
                OR stripe_session_id NOT IN (
                     SELECT stripe_session_id FROM marketplace_purchases
                      WHERE stripe_session_id IS NOT NULL ) )`,
    )
    .bind(periodStart, periodEnd)
    .first<{ revenue: number }>();

  // Stream 3 — marketplace sales (gross minus Stripe fees == net).
  const marketplace = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(gross_usd_micros), 0)      AS gross,
              COALESCE(SUM(stripe_fee_usd_micros), 0) AS fees
         FROM marketplace_purchases
        WHERE status = 'paid' AND created_at >= ?1 AND created_at < ?2`,
    )
    .bind(periodStart, periodEnd)
    .first<{ gross: number; fees: number }>();

  const routingGross       = routing?.gross ?? 0;
  const routingPassthrough = routing?.passthrough ?? 0;
  const buildsRevenue      = builds?.revenue ?? 0;
  const marketplaceGross   = marketplace?.gross ?? 0;
  const marketplaceFees    = marketplace?.fees ?? 0;

  // gross / passthrough / net across all streams. brain_builds revenue has no
  // passthrough; marketplace passthrough is the Stripe fee.
  const gross       = routingGross + buildsRevenue + marketplaceGross;
  const passthrough = routingPassthrough + marketplaceFees;
  const netRevenue  = Math.max(0, gross - passthrough);

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
    // Net revenue below the ratio denominator — nothing to send yet.
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
        `auto-cron conservation share floor(net*ratio) = ${share}; ` +
          `streams: routing+brain_builds+marketplace`,
        now,
      )
      .run();
  }

  // Link every unlinked marketplace_conservation_ledger row in the period to
  // this payout — they now have a consumer (iter4 H2 point 2).
  await env.DB
    .prepare(
      `UPDATE marketplace_conservation_ledger
          SET conservation_payout_id = ?1
        WHERE conservation_payout_id IS NULL
          AND created_at >= ?2 AND created_at < ?3`,
    )
    .bind(payoutId, periodStart, periodEnd)
    .run();

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

  // Stripe transfers use integer cents. 10_000 micros = 1 cent.
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
    // Flip the payout AND every marketplace ledger row it covers to 'sent'.
    await env.DB.batch([
      env.DB
        .prepare(`UPDATE conservation_payouts SET status = 'sent', stripe_transfer_id = ?1 WHERE id = ?2`)
        .bind(transfer.id, payoutId),
      env.DB
        .prepare(
          `UPDATE marketplace_conservation_ledger
              SET payout_status = 'sent', stripe_transfer_id = ?1
            WHERE conservation_payout_id = ?2 AND payout_status = 'pending'`,
        )
        .bind(transfer.id, payoutId),
    ]);
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
  const startYear  = m === 0 ? y - 1 : y;
  const startMonth = m === 0 ? 11    : m - 1;
  const periodStart = Date.UTC(startYear, startMonth, 1, 0, 0, 0, 0);
  const periodEnd   = Date.UTC(y,         m,           1, 0, 0, 0, 0);
  return { periodStart, periodEnd };
}
