// src/mcp/brain_tools.ts — brain.* MCP tools for the user's LLM agent.
//
// Bring-Your-Own-LLM: the agent supplies its own model; we provide the build
// environment. Every tool call also feeds the live session bus when the
// caller provides a build_session_id, so the human watches the build happen.

import { z, type ZodRawShape } from "zod/v3";
import type { Env } from "../index";

import { extract, detectFormat } from "../brainbuilder/extractors";
import { evolveBrain, TaskEvent } from "../brainbuilder/evolve";
import { meteredCall } from "./metering";
// iter4.2 — marketplace.ts kept for admin/audit only; no MCP surface imports it
import { attestBrain, AttestationTier, verifyAttestation, importPublicKeyFromRaw, getAttestKeys } from "../brainbuilder/attest";
import { saveAttestation, findExisting, loadAttestation } from "../brainbuilder/attest_storage";
import { verifyBrain } from "../brainbuilder/invariants";
import { saveBrain, loadBrain, isBrainUnlocked } from "../brainbuilder/storage";
import { pairSession, emitEvent } from "../brainbuilder/session_bus";
import { SUPPORTED_FORMATS, BrainInputFormat } from "../brainbuilder/schema";

type ToolFn = <S extends ZodRawShape>(
  name: string,
  schema: S,
  body: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
) => void;

interface Bindings {
  env: Env;
  callerId: string;
  tool: ToolFn;
  freeTool: ToolFn;
}

const SESSION_ID = z.string().regex(/^[A-Z0-9]{26}$/).optional()
  .describe("Optional live build session id. When set, this tool call is broadcast to the human's browser via SSE so they watch in real time.");

const REQUEST_ID = z.string().min(1)
  .describe("Idempotency key. Reusing it returns the original ledger row without re-billing.");

export function registerBrainTools({ env, callerId, tool, freeTool }: Bindings) {

  // brain.pair_session — bind a build_session to the caller's OAuth identity.
  freeTool(
    "brain_pair_session",
    {
      pairing_code: z.string().regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/i)
        .describe("8-char pairing code (XXXX-XXXX) shown on the user's browser."),
    },
    async (args) => {
      const session = await pairSession(env, args.pairing_code.toUpperCase(), callerId);
      return { session_id: session.session_id, status: session.status, paired_at: session.paired_at };
    },
  );

  // brain.list_formats — declare which agent file formats are supported.
  freeTool(
    "brain_list_formats",
    {},
    async () => ({ formats: SUPPORTED_FORMATS, schema_version: "brain.v1" }),
  );

  // brain.import — deterministic build from input bytes. Free preview path.
  tool(
    "brain_import",
    {
      content: z.string().min(1).describe("Raw agent file content (JSON text or newline-separated prompts)."),
      format:  z.enum(SUPPORTED_FORMATS).optional()
        .describe("Input format. Auto-detected if omitted."),
      build_session_id: SESSION_ID,
      request_id: REQUEST_ID,
    },
    async (args) => {
      const inputBytes = new TextEncoder().encode(args.content);
      const format: BrainInputFormat = args.format ?? detectFormat(inputBytes);
      if (args.build_session_id) {
        await emitEvent(env, args.build_session_id, "tool_call_start", "brain_import",
          { format, input_bytes: inputBytes.length, caller_id: callerId });
      }
      let brain;
      try { brain = await extract(format, inputBytes); }
      catch (e) {
        if (args.build_session_id) await emitEvent(env, args.build_session_id, "tool_call_error", "brain_import", { error: (e as Error).message });
        throw e;
      }
      const report = await verifyBrain(brain);
      await saveBrain(env, brain, callerId, report.passed);
      if (args.build_session_id) {
        await emitEvent(env, args.build_session_id, "invariant_report", "brain_import",
          { brain_id: brain.brain_id, passed: report.passed, checks: report.checks });
        await emitEvent(env, args.build_session_id, "tool_call_result", "brain_import",
          { brain_id: brain.brain_id, node_count: brain.nodes.length, edge_count: brain.edges.length, content_hash: brain.content_hash });
      }
      return {
        brain_id:     brain.brain_id,
        content_hash: brain.content_hash,
        format,
        nodes_count:  brain.nodes.length,
        edges_count:  brain.edges.length,
        invariants_passed: report.passed,
      };
    },
  );

  // brain.get — full artifact (paywall-gated; subscription unlocks all).
  tool(
    "brain_get",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
      build_session_id: SESSION_ID,
      request_id: REQUEST_ID,
    },
    async (args) => {
      const gate = await isBrainUnlocked(env, args.brain_id, callerId);
      const brain = await loadBrain(env, args.brain_id);
      if (!brain) throw new Error("brain_not_found");
      if (args.build_session_id) {
        await emitEvent(env, args.build_session_id, "tool_call_result", "brain_get",
          { brain_id: args.brain_id, unlocked: gate.unlocked, reason: gate.reason });
      }
      if (!gate.unlocked) {
        return {
          ok: false,
          paywall: { product: "single_brain_unlock", amount_usd: 9, reason: gate.reason },
          preview: {
            brain_id: brain.brain_id,
            content_hash: brain.content_hash,
            agent_name: brain.genome.agent_name,
            purpose: brain.genome.purpose,
            node_count: brain.nodes.length,
            edge_count: brain.edges.length,
            sample_nodes: brain.nodes.slice(0, 8).map((n) => ({ id: n.id, type: n.type, description: n.description })),
            llm_bindings: brain.genome.llm_bindings,
          },
        };
      }
      return { ok: true, brain };
    },
  );

  // brain.verify — re-run the invariant report on an existing brain.
  tool(
    "brain_verify",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
      build_session_id: SESSION_ID,
      request_id: REQUEST_ID,
    },
    async (args) => {
      const brain = await loadBrain(env, args.brain_id);
      if (!brain) throw new Error("brain_not_found");
      const report = await verifyBrain(brain);
      if (args.build_session_id) {
        await emitEvent(env, args.build_session_id, "invariant_report", "brain_verify",
          { brain_id: brain.brain_id, passed: report.passed, checks: report.checks });
      }
      return { brain_id: brain.brain_id, passed: report.passed, checks: report.checks };
    },
  );

  // brain.checkout — create $9 Stripe Checkout session for single_brain_unlock.
  // Uses the existing createTopupSession primitive in spirit but writes a
  // brain_builds row so the unlock is tied to a specific brain.
  freeTool(
    "brain_checkout",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
      product:  z.enum(["single_brain_unlock", "unlimited_brains"]).default("single_brain_unlock"),
      success_url: z.string().url().optional(),
      cancel_url:  z.string().url().optional(),
    },
    async (args) => {
      // Lazy import to keep tool registration cheap.
      const { createBrainCheckoutSession } = await import("../brainbuilder/checkout");
      return createBrainCheckoutSession(env, {
        callerId,
        brainId: args.brain_id,
        product: args.product,
        successUrl: args.success_url,
        cancelUrl:  args.cancel_url,
      });
    },
  );

  // brain.evolve — apply task events to mutate the graph deterministically.
  // Iter3 P1.4: accepts dry_run: true. When set, the call:
  //   - Still requires the caller to be unlocked for the brain (same gate).
  //   - Does NOT debit the merchant balance (no meteredCall).
  //   - Does NOT persist the mutated brain (no saveBrain).
  //   - Returns the would-be mutation result + dry_run: true in the envelope.
  // We register dry-run as a freeTool path and metered as the normal path so the
  // billing wrapper only fires when dry_run is false/absent.
  const evolveImpl = async (args: any, opts: { dryRun: boolean }) => {
    const prev = await loadBrain(env, args.brain_id);
    if (!prev) throw new Error("brain_not_found");
    const gate = await isBrainUnlocked(env, args.brain_id, callerId);
    if (!gate.unlocked) {
      return { ok: false, paywall: { product: "single_brain_unlock", amount_usd: 9, reason: gate.reason } };
    }
    if (args.build_session_id) {
      await emitEvent(env, args.build_session_id, "tool_call_start", "brain_evolve",
        { brain_id: args.brain_id, event_count: args.events.length, dry_run: opts.dryRun });
    }
    const { brain, growth_log } = await evolveBrain(prev, args.events as TaskEvent[]);
    const report = await verifyBrain(brain);
    if (!opts.dryRun) {
      await saveBrain(env, brain, callerId, report.passed);
    }
    if (args.build_session_id) {
      const sid = args.build_session_id;
      await emitEvent(env, sid, "invariant_report", "brain_evolve",
        { brain_id: brain.brain_id, passed: report.passed, checks: report.checks });
      await emitEvent(env, sid, "tool_call_result", "brain_evolve",
        { brain_id: brain.brain_id, node_count: brain.nodes.length, edge_count: brain.edges.length, content_hash: brain.content_hash, growth_events: growth_log.length, dry_run: opts.dryRun });
    }
    return {
      ok: true,
      dry_run: opts.dryRun,
      brain_id: brain.brain_id,
      content_hash: brain.content_hash,
      nodes_count: brain.nodes.length,
      edges_count: brain.edges.length,
      invariants_passed: report.passed,
      growth_log,
    };
  };

  // Iter3 P1.4: brain_evolve registers as a freeTool so we control billing ourselves.
  // dry_run: true  → no meteredCall, no debit, no persistence, deterministic preview.
  // dry_run: false → meteredCall fires the routing-fee debit + ledger insert as before.
  freeTool(
    "brain_evolve",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
      events: z.array(z.object({
        from_node: z.string().min(1),
        to_node:   z.string().min(1),
        success:   z.boolean(),
        pattern:   z.string().optional(),
      })).min(1).max(256)
        .describe("Task outcome events. Each strengthens or weakens the (from,to) edge; repeating patterns can grow new nodes under the genome's growth_rules."),
      dry_run: z.boolean().optional()
        .describe("Iter3 P1.4: when true, no debit, no persistence — returns the would-be mutation deterministically. Auth still required."),
      build_session_id: SESSION_ID,
      request_id: REQUEST_ID,
    },
    async (args) => {
      const dryRun = !!args.dry_run;

      const runBody = async () => {
        const result = await evolveImpl(args, { dryRun });
        return {
          result,
          usage: { modelUsed: null, inputTokens: 0, outputTokens: 0, modelCostUsdMicros: 0, success: true },
        };
      };

      if (dryRun) {
        // No meteredCall — bypass billing entirely.
        const { result } = await runBody();
        return result;
      }
      // Normal metered path. request_id is required for idempotency on the metered call.
      const out = await meteredCall(
        env,
        { callerId, toolName: "brain_evolve", requestId: args.request_id },
        runBody,
      );
      return { ...((out.result ?? {}) as object), metering: { replayed: out.replayed, ledger_id: out.row.id } };
    },
  );


  // iter4.2 — marketplace tools removed (proprietary pivot). Brains are private
  // property of the building caller_id. The deterministic-id guarantee + the
  // Ed25519 attestation tier remain the way an owner proves a brain's structure
  // to downstream auditors without exposing the artifact.

  // ── Compliance attestation tier ──────────────────────────────────────
  freeTool(
    "brain_attest_preview",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
    },
    async (args) => {
      const brain = await loadBrain(env, args.brain_id);
      if (!brain) return { error: "brain_not_found" };
      // Preview tier is always available; signature_b64 = "".
      const signed = await attestBrain(env, brain, "preview" as AttestationTier, "0.2.0");
      return { tier: "preview", body: signed.body, pubkey_url: signed.pubkey_url };
    },
  );

  tool(
    "brain_attest_purchase",
    {
      brain_id: z.string().regex(/^[A-Z0-9]{26}$/),
      tier:     z.enum(["standard", "enterprise"]),
      success_url: z.string().url().optional(),
      cancel_url:  z.string().url().optional(),
      request_id:  REQUEST_ID,
    },
    async (args) => {
      const brain = await loadBrain(env, args.brain_id);
      if (!brain) throw new Error("brain_not_found");
      // C3: only attestable if all invariants pass right now.
      const { verifyBrain } = await import("../brainbuilder/invariants");
      const report = await verifyBrain(brain);
      if (!report.passed) {
        const failed = report.checks.filter((c) => !c.passed).map((c) => c.id).join(", ");
        return { ok: false, error: "attestation_refused", failed_invariants: failed };
      }
      // C2 idempotency: if an attestation already exists for (brain, hash, tier), short-circuit.
      const existing = await findExisting(env, brain.brain_id, brain.content_hash, args.tier);
      if (existing) {
        const signed = await loadAttestation(env, existing.attestation_id);
        return { ok: true, replayed: true, attestation_id: existing.attestation_id, body: signed?.body, signature_b64: signed?.signature_b64 };
      }
      // Tier pricing.
      const priceUsd = args.tier === "standard" ? 199 : 499;
      const { getStripeClient, ensureStripeCustomer } = await import("../billing/stripe");
      const stripe = getStripeClient(env);
      if (!stripe) throw new Error("Stripe not configured");
      const customerId = await ensureStripeCustomer(env, callerId);
      if (!customerId) throw new Error("Stripe customer could not be resolved");
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: priceUsd * 100,
            product_data: {
              name: `Verdigraph compliance attestation (${args.tier})`,
              description: "Signed Ed25519 attestation that this brain meets the 9 Verdigraph invariants. 25% of net funds conservation.",
            },
          },
          quantity: 1,
        }],
        metadata: {
          caller_id:          callerId,
          brain_id:           brain.brain_id,
          content_hash:       brain.content_hash,
          tier:               args.tier,
          verdigraph_purpose: "attestation_purchase",
        },
        success_url: args.success_url ?? `https://verdigraph.dev/app?attestation=success&brain_id=${brain.brain_id}`,
        cancel_url:  args.cancel_url  ?? `https://verdigraph.dev/app?attestation=cancelled`,
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      return { ok: true, replayed: false, checkout_url: session.url, tier: args.tier, amount_usd: priceUsd };
    },
  );

  freeTool(
    "brain_attest_verify",
    {
      attestation_id: z.string().regex(/^[A-Z0-9]{26}$/),
    },
    async (args) => {
      const signed = await loadAttestation(env, args.attestation_id);
      if (!signed) return { ok: false, error: "attestation_not_found" };
      const keys = await getAttestKeys(env);
      if (!keys) return { ok: false, error: "verifier_not_provisioned" };
      const sigValid = await verifyAttestation(signed, keys.pubKey);
      // Also re-run the brain invariants right now — a brain that's been mutated
      // since attestation may no longer be valid (the attestation pins the content_hash).
      const brain = await loadBrain(env, signed.body.brain.brain_id);
      const currentHash = brain?.content_hash;
      const hashStillMatches = currentHash === signed.body.brain.content_hash;
      return {
        ok: sigValid && hashStillMatches,
        signature_valid: sigValid,
        content_hash_matches: hashStillMatches,
        attestation_id: args.attestation_id,
        brain_id: signed.body.brain.brain_id,
        tier: signed.body.tier,
        issued_at: signed.body.issued_at,
      };
    },
  );

}
