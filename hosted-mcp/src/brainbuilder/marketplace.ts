// src/brainbuilder/marketplace.ts — published-brains marketplace core.
//
// Enforces M1-M8 invariants in app code where SQL CHECKs don't suffice.

import type { Env } from "../index";
import { loadBrain, saveBrain } from "./storage";
import { verifyBrain } from "./invariants";
import { BrainArtifact } from "./schema";

const MAX_PRICE_USD_MICROS = 99 * 1_000_000;

function ulid(): string {
  const t = Date.now().toString(32).toUpperCase().padStart(10, "0");
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let r = ""; for (let i = 0; i < 16; i++) r += alpha[rnd[i]! & 0x1f] ?? "0";
  return (t + r).slice(0, 26);
}

export interface ListingRow {
  listing_id:          string;
  brain_id:            string;
  creator_caller_id:   string;
  parent_brain_id:     string | null;
  title:               string;
  description:         string;
  price_usd_micros:    number;
  status:              "published" | "unpublished";
  visibility:          "public" | "unlisted";
  view_count:          number;
  purchase_count:      number;
  created_at:          number;
  updated_at:          number;
}

// ─── Publish / unpublish ──────────────────────────────────────────────────

export interface PublishArgs {
  callerId:        string;
  brainId:         string;
  title:           string;
  description:     string;
  priceUsdMicros:  number;
  visibility?:     "public" | "unlisted" | undefined;
}

export async function publishBrain(env: Env, args: PublishArgs): Promise<ListingRow> {
  if (args.priceUsdMicros < 0 || args.priceUsdMicros > MAX_PRICE_USD_MICROS) {
    throw new Error(`price out of range: $0-$99 (got ${args.priceUsdMicros / 1_000_000})`);
  }
  if (!args.title.trim()) throw new Error("title required");
  if (!args.description.trim()) throw new Error("description required");

  // M1: only creator can publish.
  const owner = await env.DB.prepare(`SELECT caller_id FROM brains WHERE brain_id = ?`).bind(args.brainId).first<{ caller_id: string | null }>();
  if (!owner) throw new Error("brain_not_found");
  if (owner.caller_id !== args.callerId) throw new Error("not_brain_owner");

  const visibility = args.visibility === "unlisted" ? "unlisted" : "public";

  // Iter3 P0.1: idempotent re-publish — if a published listing already exists
  // for this (creator, brain_id), update it in place rather than minting a new
  // listing_id. Preserves Stripe linkage, fork lineage, view/purchase counts.
  const existing = await env.DB.prepare(
    `SELECT listing_id FROM marketplace_listings WHERE brain_id = ? AND creator_caller_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 1`
  ).bind(args.brainId, args.callerId).first<{ listing_id: string }>();
  if (existing) {
    const now = Date.now();
    await env.DB.prepare(
      `UPDATE marketplace_listings SET title = ?, description = ?, price_usd_micros = ?, visibility = ?, updated_at = ? WHERE listing_id = ?`
    ).bind(args.title, args.description, args.priceUsdMicros, visibility, now, existing.listing_id).run();
    return await getListing(env, existing.listing_id) as ListingRow;
  }

  // M3: discover any parent linkage (i.e., this brain was created by brain_fork).
  const parent = await env.DB.prepare(`SELECT parent_brain_id FROM marketplace_listings WHERE brain_id = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(args.brainId).first<{ parent_brain_id: string | null }>();

  const listing_id = ulid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO marketplace_listings
       (listing_id, brain_id, creator_caller_id, parent_brain_id, title, description,
        price_usd_micros, status, visibility, view_count, purchase_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, 0, 0, ?, ?)`
  ).bind(
    listing_id, args.brainId, args.callerId, parent?.parent_brain_id ?? null,
    args.title, args.description, args.priceUsdMicros, visibility, now, now,
  ).run();

  return await getListing(env, listing_id) as ListingRow;
}

export async function unpublishListing(env: Env, callerId: string, listingId: string): Promise<void> {
  const row = await getListing(env, listingId);
  if (!row) throw new Error("listing_not_found");
  if (row.creator_caller_id !== callerId) throw new Error("not_listing_owner");
  await env.DB.prepare(`UPDATE marketplace_listings SET status = 'unpublished', updated_at = ? WHERE listing_id = ?`)
    .bind(Date.now(), listingId).run();
}

export async function getListing(env: Env, listingId: string): Promise<ListingRow | null> {
  return await env.DB.prepare(`SELECT * FROM marketplace_listings WHERE listing_id = ?`).bind(listingId).first<ListingRow>();
}

// ─── Search ───────────────────────────────────────────────────────────────

export interface SearchArgs {
  q?:               string | undefined;
  format?:          string | undefined;
  provider?:        string | undefined;
  minNodes?:        number | undefined;
  maxNodes?:        number | undefined;
  sort?:            "recent" | "popular" | undefined;
  limit?:           number | undefined;
  // Iter3 P1.2: when callerId is supplied AND include_unlisted is true,
  // the response includes the caller's OWN unlisted listings (and only the
  // caller's — never another creator's). Silently ignored if callerId absent.
  callerId?:        string | undefined;
  includeUnlisted?: boolean | undefined;
}

export interface SearchResultItem {
  listing_id:     string;
  brain_id:       string;
  title:          string;
  description:    string;
  price_usd:      number;
  node_count:     number;
  edge_count:     number;
  input_format:   string;
  agent_name:     string;
  purchase_count: number;
  created_at:     number;
  visibility:     "public" | "unlisted";
}

export async function searchListings(env: Env, args: SearchArgs): Promise<SearchResultItem[]> {
  const limit = Math.max(1, Math.min(50, args.limit ?? 24));
  const orderBy = args.sort === "popular" ? "l.purchase_count DESC, l.created_at DESC" : "l.created_at DESC";
  const conditions: string[] = ["l.status = 'published'"];
  const params: unknown[] = [];

  // Iter3 P1.2: unlisted hidden by default. Include caller's own unlisted
  // when (a) caller identified AND (b) include_unlisted requested.
  if (args.callerId && args.includeUnlisted) {
    conditions.push("(l.visibility = 'public' OR (l.visibility = 'unlisted' AND l.creator_caller_id = ?))");
    params.push(args.callerId);
  } else {
    conditions.push("l.visibility = 'public'");
  }

  if (args.q) {
    conditions.push("(LOWER(l.title) LIKE ? OR LOWER(l.description) LIKE ?)");
    const like = `%${args.q.toLowerCase()}%`;
    params.push(like, like);
  }
  if (args.format) { conditions.push("b.input_format = ?"); params.push(args.format); }
  if (args.minNodes !== undefined) { conditions.push("b.node_count >= ?"); params.push(args.minNodes); }
  if (args.maxNodes !== undefined) { conditions.push("b.node_count <= ?"); params.push(args.maxNodes); }
  // provider filter is JSON-deep — skipped for SQL, applied after fetch.

  const sql = `
    SELECT l.listing_id, l.brain_id, l.title, l.description, l.price_usd_micros,
           b.node_count, b.edge_count, b.input_format, b.agent_name,
           l.purchase_count, l.created_at, l.visibility
      FROM marketplace_listings l JOIN brains b ON b.brain_id = l.brain_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY ${orderBy} LIMIT ?
  `;
  const rows = await env.DB.prepare(sql).bind(...params, limit).all<any>();

  let items: SearchResultItem[] = (rows.results ?? []).map((r) => ({
    listing_id: r.listing_id,
    brain_id:   r.brain_id,
    title:      r.title,
    description: r.description,
    price_usd:  r.price_usd_micros / 1_000_000,
    node_count: r.node_count,
    edge_count: r.edge_count,
    input_format: r.input_format,
    agent_name:   r.agent_name,
    purchase_count: r.purchase_count,
    created_at: r.created_at,
    visibility:   (r.visibility ?? "public") as "public" | "unlisted",
  }));

  // Provider filter (post-fetch since llm_bindings is inside the artifact).
  if (args.provider) {
    const filtered: SearchResultItem[] = [];
    for (const it of items) {
      const brain = await loadBrain(env, it.brain_id);
      if (!brain) continue;
      if (brain.genome.llm_bindings.some((b) => b.provider === args.provider)) filtered.push(it);
    }
    items = filtered;
  }
  return items;
}

// ─── Fork ─────────────────────────────────────────────────────────────────

export async function forkBrain(env: Env, callerId: string, sourceBrainId: string): Promise<BrainArtifact> {
  const parent = await loadBrain(env, sourceBrainId);
  if (!parent) throw new Error("source_brain_not_found");

  // M3 cycle detection — check no ancestor of source already has this caller as creator with sourceBrainId in its parent chain.
  // For v0 the cycle is detected by inspecting marketplace_listings.parent_brain_id chain.
  const visited = new Set<string>([sourceBrainId]);
  let cursor: string | null = sourceBrainId;
  while (cursor) {
    const row: { parent_brain_id: string | null } | null = await env.DB.prepare(
      `SELECT parent_brain_id FROM marketplace_listings WHERE brain_id = ? AND parent_brain_id IS NOT NULL LIMIT 1`
    ).bind(cursor).first<{ parent_brain_id: string | null }>();
    if (!row || !row.parent_brain_id) break;
    if (visited.has(row.parent_brain_id)) throw new Error("fork_cycle_detected");
    visited.add(row.parent_brain_id);
    cursor = row.parent_brain_id;
  }

  // Derive a new brain_id deterministically from (source + caller). Same caller
  // forking the same source twice returns the same brain_id — idempotent.
  const seed = new TextEncoder().encode(`fork:${sourceBrainId}:${callerId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", seed.buffer as ArrayBuffer));
  const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let newId = "";
  for (let i = 0; i < 26; i++) newId += alpha[digest[i % digest.length]! & 0x1f] ?? "0";

  const child: BrainArtifact = {
    ...parent,
    brain_id: newId,
    provenance: {
      ...parent.provenance,
      warnings: [...parent.provenance.warnings, `forked from ${sourceBrainId} by ${callerId}`],
    },
  };
  // Re-hash since brain_id changed (content_hash includes brain_id via canonical body).
  const { canonicalize, sha256Hex } = await import("./canonicalize");
  const { content_hash: _omit, ...body } = child as unknown as Record<string, unknown>;
  child.content_hash = await sha256Hex(canonicalize(body));

  const report = await verifyBrain(child);
  await saveBrain(env, child, callerId, report.passed);

  // Stamp the parent linkage in a lightweight "fork shadow" row in marketplace_listings
  // — status='unpublished' so it doesn't appear in the marketplace until the caller publishes.
  const listing_id = ulid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO marketplace_listings (listing_id, brain_id, creator_caller_id, parent_brain_id, title, description, price_usd_micros, status, view_count, purchase_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'unpublished', 0, 0, ?, ?)
     ON CONFLICT DO NOTHING`
  ).bind(listing_id, newId, callerId, sourceBrainId, "(fork)", "(fork)", now, now).run();

  return child;
}

// ─── Purchase split math ──────────────────────────────────────────────────

export interface PurchaseSplit {
  gross_micros:        number;
  stripe_fee_micros:   number;
  net_micros:          number;
  creator_share:       number;
  viridis_share:       number;
  conservation_share:  number;  // remainder, captures rounding (M5)
}

/** Compute the 70/20/10 split from gross USD micros. Conservation captures rounding so the sum exact-matches net. */
export function computeSplit(grossMicros: number, stripeFeeMicros: number): PurchaseSplit {
  if (grossMicros < 0) throw new Error("gross must be non-negative");
  const net = Math.max(0, grossMicros - stripeFeeMicros);
  const creator = Math.floor(net * 70 / 100);
  const viridis = Math.floor(net * 20 / 100);
  const conservation = net - creator - viridis;
  return {
    gross_micros: grossMicros,
    stripe_fee_micros: stripeFeeMicros,
    net_micros: net,
    creator_share: creator,
    viridis_share: viridis,
    conservation_share: conservation,
  };
}

/** Stripe fee model — 2.9% + $0.30, expressed in micros. Conservative estimate; webhook
 *  reconciles against actual `application_fee_amount` if Connect is used later. */
export function estimateStripeFeeMicros(grossMicros: number): number {
  if (grossMicros === 0) return 0;
  return Math.round(grossMicros * 0.029) + 300_000;
}

// ─── Purchase recording (called from webhook) ─────────────────────────────

export interface BookPurchaseArgs {
  listingId:        string;
  buyerCallerId:    string;
  stripeSessionId:  string;
  grossUsdMicros:   number;
  stripeFeeMicros:  number;
}

export async function bookPurchase(env: Env, args: BookPurchaseArgs): Promise<void> {
  const listing = await getListing(env, args.listingId);
  if (!listing) throw new Error("listing_not_found");
  if (listing.status !== "published") throw new Error("listing_not_published");

  const split = computeSplit(args.grossUsdMicros, args.stripeFeeMicros);

  // Idempotency: skip if this Stripe session was already booked.
  const existing = await env.DB.prepare(`SELECT 1 FROM marketplace_purchases WHERE stripe_session_id = ?`).bind(args.stripeSessionId).first();
  if (existing) return;

  const purchase_id = ulid();
  const now = Date.now();
  const yyyymm = parseInt(new Date(now).toISOString().slice(0, 7).replace("-", ""), 10);

  // Insert purchase row.
  await env.DB.prepare(
    `INSERT INTO marketplace_purchases (purchase_id, listing_id, brain_id, buyer_caller_id, creator_caller_id,
       stripe_session_id, gross_usd_micros, stripe_fee_usd_micros, net_usd_micros,
       creator_share_micros, viridis_share_micros, conservation_share_micros, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?)`
  ).bind(
    purchase_id, listing.listing_id, listing.brain_id, args.buyerCallerId, listing.creator_caller_id,
    args.stripeSessionId, args.grossUsdMicros, args.stripeFeeMicros, split.net_micros,
    split.creator_share, split.viridis_share, split.conservation_share, now,
  ).run();

  // Increment creator balance (upsert).
  await env.DB.prepare(
    `INSERT INTO marketplace_creator_balances (caller_id, owed_usd_micros, lifetime_paid_usd_micros, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(caller_id) DO UPDATE SET owed_usd_micros = owed_usd_micros + excluded.owed_usd_micros, updated_at = excluded.updated_at`
  ).bind(listing.creator_caller_id, split.creator_share, now).run();

  // Conservation ledger entry.
  await env.DB.prepare(
    `INSERT INTO marketplace_conservation_ledger (entry_id, purchase_id, share_usd_micros, period_yyyymm, payout_status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
  ).bind(ulid(), purchase_id, split.conservation_share, yyyymm, now).run();

  // Unlock for buyer: insert a brain_builds row so isBrainUnlocked treats this purchase
  // identically to single_brain_unlock (M6).
  await env.DB.prepare(
    `INSERT INTO brain_builds (build_id, brain_id, caller_id, product, amount_usd_micros, stripe_session_id, status, created_at)
       VALUES (?, ?, ?, 'single_brain_unlock', ?, ?, 'paid', ?)`
  ).bind(ulid(), listing.brain_id, args.buyerCallerId, args.grossUsdMicros, args.stripeSessionId, now).run();

  // Bump listing counters.
  await env.DB.prepare(
    `UPDATE marketplace_listings SET purchase_count = purchase_count + 1, updated_at = ? WHERE listing_id = ?`
  ).bind(now, listing.listing_id).run();
}

// ─── Stripe Checkout for a marketplace purchase ───────────────────────────

export interface CreateMarketCheckoutArgs {
  callerId:   string;
  listingId:  string;
  successUrl?: string | undefined;
  cancelUrl?:  string | undefined;
}

export async function createMarketCheckout(env: Env, args: CreateMarketCheckoutArgs) {
  const { getStripeClient, ensureStripeCustomer } = await import("../billing/stripe");
  const stripe = getStripeClient(env);
  if (!stripe) throw new Error("Stripe not configured");

  const listing = await getListing(env, args.listingId);
  if (!listing) throw new Error("listing_not_found");
  if (listing.status !== "published") throw new Error("listing_not_published");

  const customerId = await ensureStripeCustomer(env, args.callerId);
  if (!customerId) throw new Error("Stripe customer could not be resolved");

  // Free listings short-circuit: synthesize a purchase row immediately and return no URL.
  if (listing.price_usd_micros === 0) {
    await bookPurchase(env, {
      listingId: listing.listing_id, buyerCallerId: args.callerId,
      stripeSessionId: `free_${listing.listing_id}_${args.callerId}_${Date.now()}`,
      grossUsdMicros: 0, stripeFeeMicros: 0,
    });
    return { checkout_url: null, free: true, listing_id: listing.listing_id, brain_id: listing.brain_id };
  }

  const amountCents = Math.round(listing.price_usd_micros / 10_000);
  const successUrl = args.successUrl ?? `https://verdigraph.dev/app?status=success&listing=${listing.listing_id}`;
  const cancelUrl  = args.cancelUrl  ?? `https://verdigraph.dev/app?status=cancelled`;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `Verdigraph brain: ${listing.title.slice(0, 80)}`,
          description: listing.description.slice(0, 240),
        },
      },
      quantity: 1,
    }],
    metadata: {
      caller_id:           args.callerId,
      listing_id:          listing.listing_id,
      brain_id:            listing.brain_id,
      verdigraph_purpose:  "marketplace_brain_purchase",
    },
    success_url: successUrl,
    cancel_url:  cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { checkout_url: session.url, free: false, listing_id: listing.listing_id, brain_id: listing.brain_id };
}
