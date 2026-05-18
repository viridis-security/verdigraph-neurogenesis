// src/billing/stripe.ts — Stripe client factory + meter-event recording.

import Stripe from "stripe";
import type { Env } from "../index";
import type { LedgerRow } from "./ledger";

const METER_EVENT_NAME_DEFAULT = "verdigraph_calls";

export function getStripeClient(env: Env): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
    maxNetworkRetries: 2,
    timeout: 10_000,
  });
}

export async function ensureStripeCustomer(env: Env, callerId: string): Promise<string | null> {
  const stripe = getStripeClient(env);
  if (!stripe) return null;

  const row = await env.DB
    .prepare(`SELECT stripe_customer_id, display_name, email FROM callers WHERE caller_id = ?1`)
    .bind(callerId)
    .first<{ stripe_customer_id: string | null; display_name: string; email: string | null }>();
  if (!row) throw new Error(`Unknown caller_id when ensuring Stripe customer: ${callerId}`);
  if (row.stripe_customer_id) return row.stripe_customer_id;

  // Build params conditionally so we never pass `email: undefined` (exactOptionalPropertyTypes).
  const params: Stripe.CustomerCreateParams = {
    name: row.display_name,
    metadata: { caller_id: callerId },
  };
  if (row.email) params.email = row.email;

  const customer = await stripe.customers.create(params);
  await env.DB
    .prepare(`UPDATE callers SET stripe_customer_id = ?1, updated_at = ?2 WHERE caller_id = ?3`)
    .bind(customer.id, Date.now(), callerId)
    .run();
  return customer.id;
}

export async function recordStripeMeterEvent(env: Env, row: LedgerRow): Promise<void> {
  const stripe = getStripeClient(env);
  if (!stripe) return;
  if (!row.success || row.totalChargedUsdMicros <= 0) return;

  const customerId = await ensureStripeCustomer(env, row.callerId);
  if (!customerId) return;

  const meterName = env.STRIPE_METER_EVENT_NAME ?? METER_EVENT_NAME_DEFAULT;
  const event: any = await (stripe as any).v2.billing.meterEvents.create({
    event_name: meterName,
    payload: {
      stripe_customer_id: customerId,
      value: String(row.totalChargedUsdMicros),
    },
  });

  await env.DB
    .prepare(`UPDATE usage_ledger SET stripe_usage_event_id = ?1 WHERE id = ?2`)
    .bind(event?.identifier ?? event?.id ?? null, row.id)
    .run();
}
