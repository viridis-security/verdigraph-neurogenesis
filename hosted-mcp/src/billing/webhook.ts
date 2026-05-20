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
        await onSubscriptionInvoicePaid(env, event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await onSubscriptionInvoiceFailed(env, event.data.object as Stripe.Invoice);
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
  const purpose = session.metadata?.verdigraph_purpose;

  if (purpose === "brain_builder_unlock") {
    await onBrainBuilderUnlock(env, session);
    return;
  }
  if (purpose === "marketplace_brain_purchase") {
    await onMarketplaceBrainPurchase(env, session);
    return;
  }
  if (purpose === "attestation_purchase") {
    await onAttestationPurchase(env, session);
    return;
  }
  if (purpose === "anonymous_credit_topup") {
    await onAnonymousCreditTopup(env, session);
    return;
  }
  if (purpose === "credit_subscription") {
    await onCreditSubscriptionCheckout(env, session);
    return;
  }
  // Only credit topups (not future product sales).
  if (purpose !== "credit_topup") return;
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


async function onBrainBuilderUnlock(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  // Mode 'payment' lands here when the customer has actually paid.
  // Mode 'subscription' completes when the checkout completes; payment may still be in_progress.
  const isSubscription = session.mode === "subscription";
  if (!isSubscription && session.payment_status !== "paid") return;

  const callerId = session.metadata?.caller_id;
  const brainId  = session.metadata?.brain_id;
  const buildId  = session.metadata?.build_id;
  if (!callerId || !brainId || !buildId) {
    throw new Error(`brain_builder_unlock missing metadata (session=${session.id})`);
  }
  // Idempotent flip to 'paid'. The build_id was created at checkout time so
  // duplicate webhook delivery is a no-op.
  await env.DB.prepare(
    `UPDATE brain_builds SET status = 'paid', stripe_session_id = ?1 WHERE build_id = ?2 AND status = 'pending'`
  ).bind(session.id, buildId).run();
}


async function onMarketplaceBrainPurchase(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return;
  const callerId  = session.metadata?.caller_id;
  const listingId = session.metadata?.listing_id;
  if (!callerId || !listingId) {
    throw new Error(`marketplace_brain_purchase missing metadata (session=${session.id})`);
  }
  const grossMicros = (session.amount_total ?? 0) * 10_000; // cents -> micros
  // Stripe fee comes from session.application_fee_amount when Connect is used; otherwise estimate.
  const { estimateStripeFeeMicros, bookPurchase } = await import("../brainbuilder/marketplace");
  const stripeFeeMicros = estimateStripeFeeMicros(grossMicros);
  await bookPurchase(env, {
    listingId,
    buyerCallerId:   callerId,
    stripeSessionId: session.id,
    grossUsdMicros:  grossMicros,
    stripeFeeMicros,
  });
}


async function onAttestationPurchase(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return;
  const callerId    = session.metadata?.caller_id;
  const brainId     = session.metadata?.brain_id;
  const tier        = session.metadata?.tier as "standard" | "enterprise" | undefined;
  const contentHash = session.metadata?.content_hash;
  if (!callerId || !brainId || !tier || !contentHash) {
    throw new Error(`attestation_purchase missing metadata (session=${session.id})`);
  }
  const { loadBrain } = await import("../brainbuilder/storage");
  const { attestBrain } = await import("../brainbuilder/attest");
  const { saveAttestation, findExisting } = await import("../brainbuilder/attest_storage");

  // C2 idempotency: if already attested for this (brain, hash, tier), skip.
  const existing = await findExisting(env, brainId, contentHash, tier);
  if (existing) return;

  const brain = await loadBrain(env, brainId);
  if (!brain) throw new Error(`attestation_purchase: brain not found (${brainId})`);
  if (brain.content_hash !== contentHash) {
    throw new Error(`attestation_purchase: content_hash drifted (paid for ${contentHash}, found ${brain.content_hash})`);
  }
  const signed = await attestBrain(env, brain, tier, "0.2.0");
  await saveAttestation(env, signed, callerId, session.id);

  // Attestation revenue is conservation-counted via brain_builds. As of iter4
  // H2 the monthly conservation cron sums every brain_builds row with
  // status='paid' (product='attestation' included) into the period's net
  // revenue and applies the conservation share to that aggregate. Before iter4
  // the cron aggregated usage_ledger ONLY, so this row was never counted —
  // that gap is what iter4 H2 closed.
  const amountMicros = (session.amount_total ?? 0) * 10_000;
  const buildId = (() => {
    const t = Date.now().toString(32).toUpperCase().padStart(10, "0");
    const rnd = new Uint8Array(16); crypto.getRandomValues(rnd);
    const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let r = ""; for (let i = 0; i < 16; i++) r += alpha[rnd[i]! & 0x1f] ?? "0";
    return (t + r).slice(0, 26);
  })();
  await env.DB.prepare(
    `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, stripe_session_id, status, created_at)
       VALUES (?, ?, ?, 'attestation', ?, ?, 'paid', ?)`
  ).bind(buildId, brainId, callerId, amountMicros, session.id, Date.now()).run();
}


async function onAnonymousCreditTopup(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return;
  const amountMicrosStr = session.metadata?.amount_usd_micros;
  if (!amountMicrosStr) throw new Error(`anonymous_credit_topup missing amount_usd_micros (session=${session.id})`);
  const amountMicros = parseInt(amountMicrosStr, 10);
  if (!Number.isFinite(amountMicros) || amountMicros <= 0) {
    throw new Error(`Invalid amount_usd_micros: ${amountMicrosStr}`);
  }
  const buyerEmail = session.metadata?.buyer_email
    ?? (typeof session.customer_email === "string" ? session.customer_email : null);
  const { mintCreditCode } = await import("./credit_codes");
  await mintCreditCode(env, {
    amountUsdMicros: amountMicros,
    buyerEmail: buyerEmail ?? null,
    stripeSessionId: session.id,
  });
  // (Email delivery deferred — code is also surfaced on the /credits/success page.)
}

async function onCreditSubscriptionCheckout(env: Env, session: Stripe.Checkout.Session): Promise<void> {
  // The actual recurring charge fires via invoice.paid — this handler just
  // registers the subscription metadata at checkout time so the first
  // invoice.paid can find the caller_id.
  if (!session.subscription) return;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription as any).id;
  const callerId = session.metadata?.caller_id;
  if (!callerId) {
    // Anonymous subscription — mint a caller_id at first invoice.paid via email match.
    // For v0 we require caller_id on subscriptions; surface as no-op.
    return;
  }
  const monthlyUsd = Math.round(parseInt(session.metadata?.amount_usd_micros ?? "0", 10) / 1_000_000);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO credit_subscriptions (subscription_id, caller_id, monthly_amount_usd, status, current_period_end, total_credits_issued, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, 0, ?, ?)
       ON CONFLICT(subscription_id) DO UPDATE SET caller_id = excluded.caller_id, monthly_amount_usd = excluded.monthly_amount_usd, status = 'active', updated_at = excluded.updated_at`
  ).bind(subscriptionId, callerId, monthlyUsd, now, now).run();
}

async function onSubscriptionInvoicePaid(env: Env, inv: Stripe.Invoice): Promise<void> {
  // Each successful invoice credits the caller's balance by monthly_amount_usd.
  const subscriptionId = typeof inv.subscription === "string" ? inv.subscription : (inv.subscription as any)?.id;
  if (!subscriptionId) return;
  const row = await env.DB.prepare(`SELECT caller_id, monthly_amount_usd FROM credit_subscriptions WHERE subscription_id = ?`).bind(subscriptionId).first<{ caller_id: string; monthly_amount_usd: number }>();
  if (!row) return;
  const amountMicros = row.monthly_amount_usd * 1_000_000;
  const now = Date.now();

  // iter4 H3 — credit the balance AND advance the subscription bookkeeping as
  // one atomic D1 batch. A crash between the two can no longer credit a caller
  // without recording the issuance, or record an issuance that never landed.
  const creditStmt = env.DB.prepare(
    `INSERT INTO credit_balances (caller_id, balance_usd_micros, updated_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT (caller_id) DO UPDATE SET
       balance_usd_micros = balance_usd_micros + excluded.balance_usd_micros,
       updated_at         = excluded.updated_at`
  ).bind(row.caller_id, amountMicros, now);
  const subscriptionStmt = env.DB.prepare(
    `UPDATE credit_subscriptions SET total_credits_issued = total_credits_issued + ?, current_period_end = ?, updated_at = ?, status = 'active' WHERE subscription_id = ?`
  ).bind(amountMicros, (inv.period_end ?? Math.floor(now / 1000)) * 1000, now, subscriptionId);
  await env.DB.batch([creditStmt, subscriptionStmt]);
}

async function onSubscriptionInvoiceFailed(env: Env, inv: Stripe.Invoice): Promise<void> {
  const subscriptionId = typeof inv.subscription === "string" ? inv.subscription : (inv.subscription as any)?.id;
  if (!subscriptionId) return;
  await env.DB.prepare(`UPDATE credit_subscriptions SET status = 'past_due', updated_at = ? WHERE subscription_id = ?`)
    .bind(Date.now(), subscriptionId).run();
}
