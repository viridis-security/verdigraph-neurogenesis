// src/billing/webhook.ts — POST /stripe/webhook
//
// Signature-verified, idempotent. Handles:
//   • checkout.session.completed  → credit caller's credit_balances row
//   • customer.created            → backfill stripe_customer_id on caller
//   • invoice.paid                → log (placeholder for metered-subscription path)
//   • invoice.payment_failed      → log (placeholder)
//
// Idempotency is layered:
//   1. stripe_events PK on event_id — Stripe retries never insert twice.
//   2. INSERT OR IGNORE — if we've already processed the event, no-op.
//   3. The credit_balances UPSERT is itself idempotent (additive credit per event_id
//      only if not already applied — we check stripe_events.processed_at).

import Stripe from "stripe";
import { getStripeClient } from "./stripe";
import { creditUsdMicros } from "./credits";
import type { Env } from "../index";

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const stripe = getStripeClient(env);
  if (!stripe) return new Response("Stripe not configured", { status: 503 });

  const sig = request.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 503 });

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (err) {
    return new Response(`Signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  // Idempotent insert. If we've seen this event_id before, ROW_INSERTED returns 0.
  const insert = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO stripe_events (event_id, event_type, payload, received_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(event.id, event.type, body, Date.now())
    .run();
  const isNewEvent = insert.meta.changes === 1;

  // If we've already processed this event, return 200 without re-running side effects.
  if (!isNewEvent) {
    const prev = await env.DB
      .prepare(`SELECT processed_at FROM stripe_events WHERE event_id = ?1`)
      .bind(event.id)
      .first<{ processed_at: number | null }>();
    return new Response(
      JSON.stringify({ received: true, replayed: true, processed_at: prev?.processed_at }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  let processError: string | null = null;
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutSessionCompleted(env, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.created":
        await onCustomerCreated(env, event.data.object as Stripe.Customer);
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        // Reserved for future metered-subscription path; logged via stripe_events only.
        break;
      default:
        // No-op for unhandled types. Still logged.
        break;
    }
    await env.DB
      .prepare(`UPDATE stripe_events SET processed_at = ?1 WHERE event_id = ?2`)
      .bind(Date.now(), event.id)
      .run();
  } catch (err) {
    processError = (err as Error).message;
    await env.DB
      .prepare(`UPDATE stripe_events SET error = ?1 WHERE event_id = ?2`)
      .bind(processError, event.id)
      .run();
  }

  return new Response(
    JSON.stringify({ received: true, event_type: event.type, error: processError }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function onCheckoutSessionCompleted(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  // Only credit topups (not future product sales).
  if (session.metadata?.verdigraph_purpose !== "credit_topup") return;
  if (session.payment_status !== "paid") return; // Stripe sometimes fires before payment captured

  const callerId = session.metadata?.caller_id;
  const amountMicrosStr = session.metadata?.amount_usd_micros;
  if (!callerId || !amountMicrosStr) {
    throw new Error(`checkout.session.completed missing caller_id or amount_usd_micros in metadata (session=${session.id})`);
  }
  const amountMicros = parseInt(amountMicrosStr, 10);
  if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
    throw new Error(`Invalid amount_usd_micros in session metadata: ${amountMicrosStr}`);
  }

  // Verify the stripe amount matches the metadata (defense against tampering).
  const expectedCents = Math.round(amountMicros / 10_000);
  if (session.amount_total !== expectedCents) {
    throw new Error(
      `Amount mismatch on session ${session.id}: metadata says ${amountMicros} μUSD ` +
      `(${expectedCents} cents) but Stripe says ${session.amount_total} cents`,
    );
  }

  await creditUsdMicros(env, callerId, amountMicros);
}

async function onCustomerCreated(env: Env, c: Stripe.Customer): Promise<void> {
  const callerId = c.metadata?.caller_id;
  if (!callerId) return;
  await env.DB
    .prepare(`UPDATE callers SET stripe_customer_id = ?1, updated_at = ?2 WHERE caller_id = ?3`)
    .bind(c.id, Date.now(), callerId)
    .run();
}
