// src/billing/credits_page.ts — iter5: HTML scrapped. createCreditsCheckout retained as the API used by POST /credits/checkout and by the credit-subscription MCP tool.

import type { Env } from "../index";
import { getStripeClient, ensureStripeCustomer } from "./stripe";

const ROUTING_FEE_USD = 0.002;                // matches manifest.ts
const DEFAULT_SUCCESS = "https://verdigraph.dev/credits/success";
const DEFAULT_CANCEL  = "https://verdigraph.dev/credits?status=cancelled";

export interface CheckoutArgs {
  amountUsd:       number;
  callerId?:       string | null | undefined;
  buyerEmail?:     string | null | undefined;
  successUrl?:     string | undefined;
  cancelUrl?:      string | undefined;
  isSubscription?: boolean | undefined;
}

export async function createCreditsCheckout(env: Env, args: CheckoutArgs): Promise<{ checkout_url: string; session_id: string }> {
  if (!Number.isFinite(args.amountUsd) || args.amountUsd < 5 || args.amountUsd > 500) {
    throw new Error("amount_usd out of range ($5-$500)");
  }
  const stripe = getStripeClient(env);
  if (!stripe) throw new Error("Stripe not configured on this Worker");

  const isSub = !!args.isSubscription;
  const amountCents = Math.round(args.amountUsd * 100);

  // Resolve customer:
  //   - caller_id present → ensure caller's Stripe customer (same as existing topup path)
  //   - else if email → create or look up Stripe customer by email (anonymous path)
  //   - else: Stripe will collect email at checkout (mode: 'payment' allows this)
  let customerId: string | undefined;
  if (args.callerId) {
    customerId = await ensureStripeCustomer(env, args.callerId) ?? undefined;
  } else if (args.buyerEmail) {
    // Find-or-create by email. For anonymous flow we don't pre-create a callers row
    // (the webhook mints a credit code instead). We just need a Stripe customer
    // so the email is captured.
    const list = await stripe.customers.list({ email: args.buyerEmail, limit: 1 });
    customerId = list.data[0]?.id;
    if (!customerId) {
      const c = await stripe.customers.create({
        email: args.buyerEmail,
        metadata: { verdigraph_anonymous: "true" },
      });
      customerId = c.id;
    }
  }

  const purpose = args.callerId
    ? "credit_topup"
    : (isSub ? "credit_subscription" : "anonymous_credit_topup");

  const params: any = {
    mode: isSub ? "subscription" : "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        ...(isSub ? { recurring: { interval: "month" as const } } : {}),
        product_data: {
          name: isSub ? `Verdigraph API credits ($${args.amountUsd}/month auto-refill)` : `Verdigraph API credits ($${args.amountUsd} USD)`,
          description: isSub
            ? "Monthly auto-refill of routing-fee credits. Cancel anytime; unused credits never expire."
            : "Prepaid USD credits for Verdigraph MCP routing-fee calls.",
        },
      },
      quantity: 1,
    }],
    metadata: {
      verdigraph_purpose: purpose,
      ...(args.callerId ? { caller_id: args.callerId } : {}),
      amount_usd_micros: String(args.amountUsd * 1_000_000),
      ...(args.buyerEmail ? { buyer_email: args.buyerEmail } : {}),
    },
    success_url: args.successUrl ?? `${DEFAULT_SUCCESS}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  args.cancelUrl  ?? DEFAULT_CANCEL,
  };
  if (customerId) params.customer = customerId;
  else if (args.buyerEmail) params.customer_email = args.buyerEmail;
  if (!isSub) {
    params.payment_intent_data = {
      metadata: {
        verdigraph_purpose: purpose,
        amount_usd_micros: String(args.amountUsd * 1_000_000),
        ...(args.callerId ? { caller_id: args.callerId } : {}),
      },
    };
  }
  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { checkout_url: session.url, session_id: session.id };
}

// iter5 — renderCreditsHtml deleted (HTML credits page scrapped)

// iter5 — renderCreditsSuccessHtml deleted (HTML success page scrapped; JSON-only)
