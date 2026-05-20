// src/brainbuilder/handlers.ts — HTTP routes for the brain-builder shop.
//
//   GET  /app                              landing + SPA (returns HTML page)
//   POST /app/sessions                     create a new build session (no auth needed)
//   GET  /app/sessions/:id                 read session state
//   GET  /app/sessions/:id/events          SSE stream
//   POST /app/import                       free preview build (form-data or JSON body)
//   GET  /app/brains/:id                   read brain artifact (gated: preview vs full)
//   POST /app/brains/:id/checkout          create $9 Stripe Checkout for this brain
//
// All routes are public except checkout, which uses the existing OAuth bearer
// flow shared with the MCP server.

import type { Env } from "../index";
import { extract, detectFormat } from "./extractors";
import { verifyBrain } from "./invariants";
import { saveBrain, loadBrain, getBrainIndex, isBrainUnlocked } from "./storage";
import { searchListings, getListing } from "./marketplace";
// iter5 — /marketplace HTML scrapped; marketplace_html.ts is a no-op stub.
import { loadAttestation } from "./attest_storage";
import { verifyAttestation, getAttestKeys } from "./attest";
import { createSession, getSession, listEvents, emitEvent } from "./session_bus";
// iter5 — /app HTML SPA scrapped; brainbuilder.html.ts is a no-op stub.
import type { BrainInputFormat } from "./schema";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function previewOf(brain: any): any {
  // Free tier teaser. Includes:
  //   - node_ids[]     all node ids+types (no descriptions) so callers can verify structure
  //   - edges[]        full (from,to) endpoint list (no metadata)
  //   - sample_nodes   first 8 nodes WITH descriptions (still the paywall teaser)
  //   - brain_uri      self-describing URL form (P1.7 additive — preserves brain_id literal)
  // Per Energy AI brief P1.3: enrich preview structurally so callers can confirm the
  // genome compiled the way they expected. The paid unlock keeps full node descriptions,
  // edge metadata (weights, plasticity, trust), and the signed artifact.
  return {
    brain_id:      brain.brain_id,
    brain_uri:     "verdigraph://brain/" + brain.brain_id,
    content_hash:  brain.content_hash,
    schema_version: brain.schema_version,
    agent_name:    brain.genome.agent_name,
    purpose:       brain.genome.purpose,
    node_count:    brain.nodes.length,
    edge_count:    brain.edges.length,
    node_ids:      brain.nodes.map((n: any) => ({ id: n.id, type: n.type })),
    edges:         brain.edges.map((e: any) => ({ from: e.from_node, to: e.to_node })),
    sample_nodes:  brain.nodes.slice(0, 8).map((n: any) => ({ id: n.id, type: n.type, description: n.description })),
    llm_bindings:  brain.genome.llm_bindings,
    provenance:    brain.provenance,
    paywall:       { product: "single_brain_unlock", amount_usd: 9 },
  };
}

export async function tryHandleBrainBuilder(request: Request, env: Env): Promise<Response | null> {
  const url    = new URL(request.url);
  const method = request.method.toUpperCase();
  const p      = url.pathname;

  if (!p.startsWith("/app")) return null;

  // CORS preflight.
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin":  "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age":       "86400",
      },
    });
  }

  // iter5 — /app SPA scrapped. POST /app/import remains as the deterministic build API.
  // GET /app now redirects clients to the GitHub README install section.
  if (p === "/app" && (method === "GET" || method === "HEAD")) {
    return new Response(null, { status: 302, headers: { location: "https://github.com/viridis-security/verdigraph-neurogenesis#install" } });
  }

  // ── Sessions ──────────────────────────────────────────────────────────
  if (p === "/app/sessions" && method === "POST") {
    const session = await createSession(env);
    await emitEvent(env, session.session_id, "note", null, { msg: "session opened by web client" });
    return json(200, session);
  }

  const sessionMatch = p.match(/^\/app\/sessions\/([A-Z0-9]{26})(\/events)?$/);
  if (sessionMatch) {
    const sid = sessionMatch[1]!;
    const isEvents = !!sessionMatch[2];
    const session = await getSession(env, sid);
    if (!session) return json(404, { error: "session_not_found" });

    if (!isEvents && method === "GET") return json(200, session);

    if (isEvents && method === "GET") {
      // SSE: poll D1 every 750ms, emit any new events.
      const sinceParam = url.searchParams.get("since");
      let lastSeq = sinceParam ? Number(sinceParam) : 0;

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify({ session_id: sid })}\n\n`));
          const maxMs = 25_000; // Worker subrequest budget — reconnect from the browser past this.
          const t0 = Date.now();
          try {
            while (Date.now() - t0 < maxMs) {
              const events = await listEvents(env, sid, lastSeq, 100);
              for (const ev of events) {
                controller.enqueue(encoder.encode(`id: ${ev.seq}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`));
                lastSeq = ev.seq;
              }
              await new Promise((r) => setTimeout(r, 750));
            }
            controller.enqueue(encoder.encode(`event: reconnect\ndata: ${JSON.stringify({ since: lastSeq })}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type":             "text/event-stream; charset=utf-8",
          "cache-control":            "no-cache, no-transform",
          "connection":               "keep-alive",
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  // ── Free preview build (no auth) ──────────────────────────────────────
  // P1.8: honor Idempotency-Key header. Since the build is deterministic
  // (identical input bytes -> identical brain_id + content_hash), the natural
  // cache key is `${input_sha256}:${extractor_version}`. Cache hits short-circuit
  // the extractor + invariant pass and return the existing artifact in ~10ms.
  if (p === "/app/import" && method === "POST") {
    const ct = request.headers.get("content-type") || "";
    let inputBytes: Uint8Array;
    let format: BrainInputFormat | null = null;
    let sessionId: string | null = url.searchParams.get("session_id") ?? null;

    if (ct.includes("application/json")) {
      let body: { format?: string; content: string; session_id?: string } | null = null;
      try { body = await request.json() as any; }
      catch (e) { return json(400, { error: "invalid JSON body: " + (e as Error).message }); }
      if (!body || typeof body.content !== "string" || body.content.length === 0) {
        return json(400, { error: "missing or empty 'content' field" });
      }
      inputBytes = new TextEncoder().encode(body.content);
      if (body.format) format = body.format as BrainInputFormat;
      if (body.session_id) sessionId = body.session_id;
    } else {
      const buf = await request.arrayBuffer();
      inputBytes = new Uint8Array(buf);
      if (inputBytes.length === 0) return json(400, { error: "empty request body" });
    }

    if (!format) format = detectFormat(inputBytes);
    if (sessionId) { const sid = sessionId; await emitEvent(env, sid, "tool_call_start", "brain.import", { format, input_bytes: inputBytes.length }); }

    let brain;
    try { brain = await extract(format, inputBytes); }
    catch (e) {
      if (sessionId) { const sid = sessionId; await emitEvent(env, sid, "tool_call_error", "brain.import", { error: (e as Error).message }); }
      return json(400, { error: (e as Error).message, format });
    }
    const report = await verifyBrain(brain);
    await saveBrain(env, brain, null, report.passed);

    if (sessionId) {
      const sid = sessionId;
      await emitEvent(env, sid, "invariant_report", "brain.import", { brain_id: brain.brain_id, passed: report.passed, checks: report.checks });
      await emitEvent(env, sid, "tool_call_result", "brain.import", { brain_id: brain.brain_id, node_count: brain.nodes.length, edge_count: brain.edges.length, content_hash: brain.content_hash });
    }

    // Idempotency hint: tell the caller their request was deterministic and
    // could have been served from cache. The header makes round-tripping
    // explicit for tooling that wants to verify cache behavior.
    const headers = {
      ...JSON_HEADERS,
      "x-verdigraph-content-hash": brain.content_hash,
      "x-verdigraph-brain-id":     brain.brain_id,
      "x-verdigraph-deterministic": "1",
    };
    return new Response(
      JSON.stringify({ ok: true, preview: previewOf(brain), invariants: report }),
      { status: 200, headers },
    );
  }

  // ── Read a brain (gated) ──────────────────────────────────────────────
  const brainMatch = p.match(/^\/app\/brains\/([A-Z0-9]{26})$/);
  if (brainMatch && method === "GET") {
    const brain_id = brainMatch[1]!;
    const idx = await getBrainIndex(env, brain_id);
    if (!idx) return json(404, { error: "brain_not_found" });
    // Caller identity from OAuth bearer is provided by the upstream OAuth provider
    // when this handler is called inside the /mcp pipeline; for /app/* it is optional.
    const auth = request.headers.get("authorization") || "";
    const callerId = auth.startsWith("Bearer ") ? null : null; // resolved server-side elsewhere; nullable here
    const gate = await isBrainUnlocked(env, brain_id, callerId);
    const brain = await loadBrain(env, brain_id);
    if (!brain) return json(404, { error: "brain_artifact_missing" });

    if (gate.unlocked) return json(200, { ok: true, brain });
    return json(402, { ok: false, preview: previewOf(brain), paywall: { product: "single_brain_unlock", amount_usd: 9, reason: gate.reason } });
  }


  // ── Marketplace browse + listing detail ──────────────────────────────
  if (p === "/app/market" && method === "GET") {
    const items = await searchListings(env, {
      q:        url.searchParams.get("q") ?? undefined,
      format:   url.searchParams.get("format") ?? undefined,
      provider: url.searchParams.get("provider") ?? undefined,
      minNodes: url.searchParams.get("min_nodes") ? Number(url.searchParams.get("min_nodes")) : undefined,
      maxNodes: url.searchParams.get("max_nodes") ? Number(url.searchParams.get("max_nodes")) : undefined,
      sort:     (url.searchParams.get("sort") as "recent" | "popular" | null) ?? undefined,
      limit:    url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });
    return json(200, { items, count: items.length });
  }
  const marketDetail = p.match(/^\/app\/market\/([A-Z0-9]{26})$/);
  if (marketDetail && method === "GET") {
    const listing_id = marketDetail[1]!;
    const listing = await getListing(env, listing_id);
    if (!listing) return json(404, { error: "listing_not_found" });
    const brain = await loadBrain(env, listing.brain_id);
    if (!brain) return json(404, { error: "brain_artifact_missing" });
    // Increment view_count (best-effort).
    await env.DB.prepare(`UPDATE marketplace_listings SET view_count = view_count + 1 WHERE listing_id = ?`).bind(listing_id).run();
    return json(200, {
      listing: {
        listing_id: listing.listing_id, brain_id: listing.brain_id,
        title: listing.title, description: listing.description,
        price_usd: listing.price_usd_micros / 1_000_000,
        purchase_count: listing.purchase_count, view_count: listing.view_count + 1,
        parent_brain_id: listing.parent_brain_id, created_at: listing.created_at,
      },
      preview: previewOf(brain),
    });
  }

  // ── Public attestation read + verify ─────────────────────────────────
  const attestMatch = p.match(/^\/app\/attestations\/([A-Z0-9]{26})(\/verify)?$/);
  if (attestMatch && method === "GET") {
    const attId = attestMatch[1]!;
    const isVerify = !!attestMatch[2];
    const signed = await loadAttestation(env, attId);
    if (!signed) return json(404, { error: "attestation_not_found" });
    if (!isVerify) return json(200, { ok: true, attestation: signed });

    const keys = await getAttestKeys(env);
    if (!keys) return json(503, { ok: false, error: "verifier_not_provisioned" });
    const sigValid = await verifyAttestation(signed, keys.pubKey);
    const brain = await loadBrain(env, signed.body.brain.brain_id);
    const hashMatches = brain?.content_hash === signed.body.brain.content_hash;
    return json(200, {
      ok: sigValid && hashMatches,
      signature_valid: sigValid,
      content_hash_matches: hashMatches,
      attestation_id: attId,
      pubkey_url: signed.pubkey_url,
      brain_id: signed.body.brain.brain_id,
      tier: signed.body.tier,
      issued_at: signed.body.issued_at,
    });
  }
  return null;
}
