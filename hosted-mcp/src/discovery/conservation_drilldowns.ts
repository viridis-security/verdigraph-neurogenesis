// src/discovery/conservation_drilldowns.ts — Iter3 P1.3.
//
// /conservation/public         — existing rollup (other file).
// /conservation/public/months  — per-month aggregates.
// /conservation/public/brains  — per-brain contribution (pseudonymous for private).
// /conservation/public/payouts — payout transactions (audit trail).
// /conservation                — HTML drill-down page rendering all four.

import type { Env } from "../index";

interface MonthRow {
  month: string;
  gross_revenue_usd: number;
  net_revenue_usd: number;
  conservation_share_usd: number;
  paid_out_usd: number;
  payout_tx_id?: string | null;
  payout_recipient?: string | null;
}
interface BrainRow {
  brain_id_or_hash: string;
  agent_name?: string | null;
  contribution_usd: number;
  purchase_count: number;
  first_contributed_at?: string | null;
}
interface PayoutRow {
  month: string;
  amount_usd: number;
  recipient: string;
  tx_ref: string;
  verified_at?: string | null;
}

const HEADERS = {
  "content-type":  "application/json; charset=utf-8",
  "cache-control": "public, max-age=60",
  "access-control-allow-origin": "*",
};

function micros(n: number | null | undefined): number {
  return (n ?? 0) / 1_000_000;
}

export async function handleMonths(env: Env): Promise<Response> {
  // Aggregate from conservation_payouts table (existing 25%-of-net routing cron)
  // + marketplace_conservation_ledger (10% per marketplace purchase).
  // Bucket by (period_start month, period_yyyymm).
  const months = new Map<string, MonthRow>();

  // 1. Routing-revenue track: conservation_payouts (period_start is unix ms).
  const cp = await env.DB.prepare(
    `SELECT period_start, gross_revenue_usd_micros, net_revenue_usd_micros,
            conservation_share_usd_micros, stripe_transfer_id, status, recipient
       FROM conservation_payouts
      ORDER BY period_start DESC`
  ).all<any>();
  for (const r of cp.results ?? []) {
    const m = new Date(r.period_start).toISOString().slice(0, 7);
    const existing = months.get(m) ?? { month: m, gross_revenue_usd: 0, net_revenue_usd: 0, conservation_share_usd: 0, paid_out_usd: 0, payout_tx_id: null, payout_recipient: null };
    existing.gross_revenue_usd      += micros(r.gross_revenue_usd_micros);
    existing.net_revenue_usd        += micros(r.net_revenue_usd_micros);
    existing.conservation_share_usd += micros(r.conservation_share_usd_micros);
    if (r.status === "sent") {
      existing.paid_out_usd  += micros(r.conservation_share_usd_micros);
      existing.payout_tx_id   = r.stripe_transfer_id || existing.payout_tx_id;
      existing.payout_recipient = r.recipient || existing.payout_recipient;
    }
    months.set(m, existing);
  }

  // 2. Marketplace track: marketplace_conservation_ledger has period_yyyymm = 202605 etc.
  try {
    const mp = await env.DB.prepare(
      `SELECT period_yyyymm, SUM(share_usd_micros) AS share, SUM(CASE WHEN payout_status='sent' THEN share_usd_micros ELSE 0 END) AS paid
         FROM marketplace_conservation_ledger
        GROUP BY period_yyyymm
        ORDER BY period_yyyymm DESC`
    ).all<any>();
    for (const r of mp.results ?? []) {
      const yyyy = Math.floor(r.period_yyyymm / 100);
      const mm   = String(r.period_yyyymm % 100).padStart(2, "0");
      const m    = `${yyyy}-${mm}`;
      const existing = months.get(m) ?? { month: m, gross_revenue_usd: 0, net_revenue_usd: 0, conservation_share_usd: 0, paid_out_usd: 0, payout_tx_id: null, payout_recipient: null };
      existing.conservation_share_usd += micros(r.share);
      existing.paid_out_usd           += micros(r.paid);
      months.set(m, existing);
    }
  } catch { /* table may not exist on stale envs; ignore */ }

  const out = [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
  return new Response(JSON.stringify(out), { status: 200, headers: HEADERS });
}

export async function handleBrains(env: Env): Promise<Response> {
  // Iter4.2 proprietary pivot — brains are private. No per-brain attribution is
  // surfaced publicly. Conservation contribution is aggregated only via /months
  // (gross/net rollup) and /payouts (the actual transactions). This route
  // returns an empty array to remain HTTP-200 for any consumer that pinned it.
  return new Response(JSON.stringify([]), { status: 200, headers: HEADERS });
}

export async function handlePayouts(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT period_start, conservation_share_usd_micros, recipient, stripe_transfer_id, status
       FROM conservation_payouts
      WHERE status = 'sent'
      ORDER BY period_start DESC`
  ).all<any>();
  const out: PayoutRow[] = (rows.results ?? []).map((r) => ({
    month: new Date(r.period_start).toISOString().slice(0, 7),
    amount_usd: micros(r.conservation_share_usd_micros),
    recipient: r.recipient,
    tx_ref: r.stripe_transfer_id || "",
    verified_at: r.period_start ? new Date(r.period_start).toISOString() : null,
  }));
  return new Response(JSON.stringify(out), { status: 200, headers: HEADERS });
}

// iter5 — renderConservationHtml deleted (HTML page scrapped; JSON drill-downs remain)
