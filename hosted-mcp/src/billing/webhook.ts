// src/billing/webhook.ts — POST /stripe/webhook
//
// Verifies the Stripe-Signature header, logs every event into stripe_events
// (idempotent by event_id), and synchronously handles customer.created /
// invoice.paid / invoice.payment_failed. Returns 200 on accepted, 4xx on
// signature or parse failures.

import Stripe from "stripe";
import { getStripeClient } from "./stripe";
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
    // Workers runtime requires the async variant which uses Web Crypto.
    event = await stripe.webhooks.constructEventAsync(body, sig, secret);
  } catch (err) {
    return new Response(`Signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  // Idempotent insert into stripe_events. PRIMARY KEY (event_id) prevents replays.
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO stripe_events (event_id, event_type, payload, received_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(event.id, event.type, body, Date.now())
    .run();

  let processError: string | null = null;
  try {
    switch (event.type) {
      case "customer.created":
        await onCustomerCreated(env, event.data.object as Stripe.Customer);
        break;
      case "invoice.paid":
        await onInvoicePaid(env, event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await onInvoicePaymentFailed(env, event.data.object as Stripe.Invoice);
        break;
      default:
        // No-op for events we don't care about. They're still logged in stripe_events.
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

async function onCustomerCreated(env: Env, c: Stripe.Customer): Promise<void> {
  const callerId = c.metadata?.caller_id;
  if (!callerId) return;
  await env.DB
    .prepare(`UPDATE callers SET stripe_customer_id = ?1, updated_at = ?2 WHERE caller_id = ?3`)
    .bind(c.id, Date.now(), callerId)
    .run();
}

async function onInvoicePaid(_env: Env, _inv: Stripe.Invoice): Promise<void> {
  // For v0.2 we don't credit balances here — Stripe's metered subscription does
  // the math. This hook is reserved for future top-up / pre-paid credit flows.
  // Recording in stripe_events is sufficient for reconciliation.
}

async function onInvoicePaymentFailed(_env: Env, _inv: Stripe.Invoice): Promise<void> {
  // Future: mark caller as delinquent, suspend service via callers.is_active=0.
  // For v0.2 we just log via stripe_events.
}
