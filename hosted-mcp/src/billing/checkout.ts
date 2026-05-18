// src/billing/checkout.ts — Stripe Checkout sessions for prepaid topups.
//
// Caller hits verdigraph_create_topup_session (or POST /billing/topup with bearer)
// with a desired amount in USD. Worker creates a Stripe Checkout session in
// mode=payment with caller_id in metadata. Caller opens the returned URL, pays
// with card. The /stripe/webhook handler watches for checkout.session.completed
// and credits the caller's credit_balances row idempotently.
//
// Limits: $5 minimum, $500 maximum per topup. Tunable via env vars later.

import { getStripeClient, ensureStripeCustomer } from "./stripe";
import type { Env } from "../index";

const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 500;
const DEFAULT_RETURN_URL = "https://verdigraph.ai/billing/return"; // placeholder; not yet built

export interface TopupRequest {
  callerId:   string;
  amountUsd:  number;
  successUrl?: string;
  cancelUrl?:  string;
}

export interface TopupSession {
  checkout_url: string;
  session_id:   string;
  amount_usd:   number;
  amount_usd_micros: number;
  expires_at:   number;   // unix seconds
}

export async function createTopupSession(env: Env, req: TopupRequest): Promise<TopupSession> {
  if (!Number.isFinite(req.amountUsd)) throw new Error("amount_usd must be a finite number");
  if (req.amountUsd < MIN_TOPUP_USD) {
    throw new Error(`Minimum topup is $${MIN_TOPUP_USD} USD (got $${req.amountUsd})`);
  }
  if (req.amountUsd > MAX_TOPUP_USD) {
    throw new Error(`Maximum topup is $${MAX_TOPUP_USD} USD (got $${req.amountUsd})`);
  }

  const stripe = getStripeClient(env);
  if (!stripe) throw new Error("Stripe not configured on this Worker (STRIPE_SECRET_KEY missing)");

  const customerId = await ensureStripeCustomer(env, req.callerId);
  if (!customerId) throw new Error("Stripe customer could not be resolved for caller");

  const amountCents = Math.round(req.amountUsd * 100);
  const amountMicros = Math.round(req.amountUsd * 1_000_000);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `Verdigraph credits ($${req.amountUsd.toFixed(2)} USD)`,
          description: "Prepaid credits for Verdigraph compute-routing tool calls. 25% of net revenue funds verified Viridis conservation programs.",
        },
      },
      quantity: 1,
    }],
    metadata: {
      caller_id:          req.callerId,
      amount_usd_micros:  String(amountMicros),
      verdigraph_purpose: "credit_topup",
    },
    payment_intent_data: {
      metadata: {
        caller_id:         req.callerId,
        amount_usd_micros: String(amountMicros),
      },
    },
    success_url: req.successUrl ?? `${DEFAULT_RETURN_URL}?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url:  req.cancelUrl  ?? `${DEFAULT_RETURN_URL}?status=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");

  return {
    checkout_url:        session.url,
    session_id:          session.id,
    amount_usd:          req.amountUsd,
    amount_usd_micros:   amountMicros,
    expires_at:          session.expires_at,
  };
}
