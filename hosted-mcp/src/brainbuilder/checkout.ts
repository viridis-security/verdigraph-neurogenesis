// src/brainbuilder/checkout.ts — Stripe Checkout for brain unlocks.
//
// Two products:
//   single_brain_unlock  — $9 one-time, unlocks one brain_id.
//   unlimited_brains     — $19/month subscription, unlocks all brains for caller.
// 25% of net flows through the existing conservation cron — no special-casing here.

import type { Env } from "../index";
import { getStripeClient, ensureStripeCustomer } from "../billing/stripe";

const SINGLE_UNLOCK_USD = 9;
const SUBSCRIPTION_USD  = 19;
const DEFAULT_RETURN_URL = "https://verdigraph.dev/app";

function ulid(): string {
  const t = Date.now().toString(32).toUpperCase().padStart(10, "0");
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let r = ""; for (let i = 0; i < 16; i++) r += alpha[rnd[i]! & 0x1f] ?? "0";
  return (t + r).slice(0, 26);
}

export interface BrainCheckoutRequest {
  callerId:    string;
  brainId:     string;
  product:     "single_brain_unlock" | "unlimited_brains";
  successUrl?: string | undefined;
  cancelUrl?:  string | undefined;
}

export async function createBrainCheckoutSession(env: Env, req: BrainCheckoutRequest) {
  const stripe = getStripeClient(env);
  if (!stripe) throw new Error("Stripe not configured (STRIPE_SECRET_KEY missing)");

  const customerId = await ensureStripeCustomer(env, req.callerId);
  if (!customerId) throw new Error("Stripe customer could not be resolved");

  // Mint a pending build row so the webhook can flip it to 'paid' idempotently.
  const buildId = ulid();
  const amountUsd = req.product === "single_brain_unlock" ? SINGLE_UNLOCK_USD : SUBSCRIPTION_USD;
  const amountMicros = amountUsd * 1_000_000;
  await env.DB.prepare(
    `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(buildId, req.brainId, req.callerId, req.product, amountMicros, Date.now()).run();

  const isSubscription = req.product === "unlimited_brains";
  const successUrl = req.successUrl ?? `${DEFAULT_RETURN_URL}?session_id={CHECKOUT_SESSION_ID}&brain_id=${encodeURIComponent(req.brainId)}&status=success`;
  const cancelUrl  = req.cancelUrl  ?? `${DEFAULT_RETURN_URL}?status=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? "subscription" : "payment",
    customer: customerId,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountUsd * 100,
        ...(isSubscription ? { recurring: { interval: "month" as const } } : {}),
        product_data: {
          name: req.product === "single_brain_unlock"
            ? "Verdigraph brain unlock"
            : "Verdigraph unlimited brains (monthly)",
          description: "25% of net revenue funds verified Viridis conservation programs.",
        },
      },
      quantity: 1,
    }],
    metadata: {
      caller_id:          req.callerId,
      brain_id:           req.brainId,
      build_id:           buildId,
      product:            req.product,
      verdigraph_purpose: "brain_builder_unlock",
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return {
    checkout_url: session.url,
    session_id:   session.id,
    build_id:     buildId,
    product:      req.product,
    amount_usd:   amountUsd,
    expires_at:   session.expires_at,
  };
}
