// src/mcp/agent.ts — VerdigraphAgent McpAgent.
//
// One Durable Object instance per caller_id (provided by OAuth props). Owns
// in-memory developmental agents, hands them to a CallerRegistry for R2 persistence,
// and exposes 14 verdigraph_* tools. Every tool runs through meteredCall so the
// usage_ledger has one row per (caller_id, request_id) — replays bypass the body.

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod/v3";

import {
  chooseProfile, ComputeProfileSchema, TaskProfileSchema,
  shouldUseCache, shouldEscalate,
  DEFAULT_PROFILES, usdToMicros,
} from "../verdigraph/compute";
import { AgentGenomeInputSchema } from "../verdigraph/genome";
import { makeEvaluationResult } from "../verdigraph/evaluation";
import { DevelopmentalAgent } from "../verdigraph/agent";
import { CallerRegistry } from "../verdigraph/registry";
import { meteredCall } from "./metering";
import { getBalanceUsdMicros, microsToUsdString } from "../billing/credits";
import { createTopupSession } from "../billing/checkout";
import { registerBrainTools } from "./brain_tools";
import type { Env } from "../index";

interface AuthCtx extends Record<string, unknown> {
  /** OAuth-resolved caller. Populated by the OAuthProvider in props. */
  callerId: string;
}

const REQUEST_ID = z
  .string()
  .min(1)
  .describe("Idempotency key. Reusing it returns the original ledger row without re-executing or re-billing.");

function textResult(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function meterPayload(row: { totalChargedUsdMicros: number; routingFeeUsdMicros: number; modelCostUsdMicros: number; id: string; success: boolean; errorCode?: string }) {
  return {
    ledger_id: row.id,
    success: row.success,
    error_code: row.errorCode,
    total_charged_usd_micros: row.totalChargedUsdMicros,
    routing_fee_usd_micros:   row.routingFeeUsdMicros,
    model_cost_usd_micros:    row.modelCostUsdMicros,
  };
}

export class VerdigraphAgent extends McpAgent<Env, unknown, AuthCtx> {
  server = new McpServer({ name: "verdigraph-mcp", version: "0.2.0" });

  private inMemory: Map<string, DevelopmentalAgent> = new Map();
  private tombstones: Set<string> = new Set();

  private registry(): CallerRegistry {
    return new CallerRegistry({
      callerId: this.props!.callerId,
      bucket:   this.env.STATE_BUCKET,
      inMemory: this.inMemory,
      tombstones: this.tombstones,
    });
  }

  async init() {
    const env = this.env;
    const callerId = this.props!.callerId;
    const reg = () => this.registry();

    // Helper to wrap a tool body in meteredCall and return MCP text content.
    // The SDK's generic inference for tool() is finicky; we cast the schema to
    // any so the body callback's args are typed by our own inference instead.
    const tool = <S extends ZodRawShape>(
      name: string,
      schema: S,
      body: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
    ) => {
      (this.server.tool as any)(
        name,
        schema as any,
        async (args: any) => {
          const out = await meteredCall(
            env,
            { callerId, toolName: name, requestId: args.request_id },
            async () => {
              const result = await body(args);
              return {
                result,
                usage: {
                  modelUsed:          null,
                  inputTokens:        0,
                  outputTokens:       0,
                  modelCostUsdMicros: 0,
                  success:            true,
                },
              };
            },
          );
          return textResult({
            ok:       out.row.success,
            replayed: out.replayed,
            metering: meterPayload(out.row),
            result:   out.result,
          });
        },
      );
    };

    // Free tools — bypass the metered debit path entirely, but still return the
    // standard envelope so MCP clients can treat them uniformly. Used for balance
    // checks and topup-session creation (we never charge a caller for asking how
    // to give us money).
    const freeTool = <S extends ZodRawShape>(
      name: string,
      schema: S,
      body: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<unknown>,
    ) => {
      (this.server.tool as any)(name, schema as any, async (args: any) => {
        try {
          const result = await body(args);
          return textResult({ ok: true, replayed: false, metering: null, result });
        } catch (err) {
          return textResult({ ok: false, replayed: false, metering: null, result: { error: (err as Error).message } });
        }
      });
    };

    // ── 1. verdigraph_choose_compute_profile ────────────────────────────
    tool(
      "verdigraph_choose_compute_profile",
      {
        profiles:   z.array(ComputeProfileSchema).min(1),
        task:       TaskProfileSchema,
        request_id: REQUEST_ID,
      },
      async (args) => {
        const decision = chooseProfile(args.profiles, args.task);
        return {
          ...decision,
          estimated_cost_usd_micros: usdToMicros(decision.estimated_cost),
        };
      },
    );

    // ── 2. verdigraph_list_profiles ────────────────────────────────────
    tool(
      "verdigraph_list_profiles",
      { request_id: REQUEST_ID },
      async () => ({ profiles: DEFAULT_PROFILES }),
    );

    // ── 3. verdigraph_create_agent ──────────────────────────────────────
    tool(
      "verdigraph_create_agent",
      { genome: AgentGenomeInputSchema, request_id: REQUEST_ID },
      async (args) => {
        const r = reg();
        const { agentId } = await r.create(args.genome);
        return { agent_id: agentId, summary: graphSummary(agentId, r.get(agentId)) };
      },
    );

    // ── 4. verdigraph_list_agents ──────────────────────────────────────
    tool(
      "verdigraph_list_agents",
      { request_id: REQUEST_ID },
      async () => ({ agents: reg().list() }),
    );

    // ── 5. verdigraph_get_graph_summary ────────────────────────────────
    tool(
      "verdigraph_get_graph_summary",
      { agent_id: z.string().min(1), request_id: REQUEST_ID },
      async (args) => graphSummary(args.agent_id, reg().get(args.agent_id)),
    );

    // ── 6. verdigraph_get_agent_state ──────────────────────────────────
    tool(
      "verdigraph_get_agent_state",
      { agent_id: z.string().min(1), request_id: REQUEST_ID },
      async (args) => reg().get(args.agent_id).toDict(),
    );

    // ── 7. verdigraph_submit_evaluation ────────────────────────────────
    tool(
      "verdigraph_submit_evaluation",
      {
        agent_id:           z.string().min(1),
        task_id:            z.string().min(1),
        task_type:          z.string().min(1),
        success_score:      z.number().min(0).max(1),
        accuracy:           z.number().min(0).max(1).default(0),
        user_satisfaction:  z.number().min(0).max(1).default(0),
        cost_efficiency:    z.number().min(0).max(1).default(0),
        safety_score:       z.number().min(0).max(1).default(1),
        notes:              z.string().default(""),
        used_edges:         z.array(z.tuple([z.string(), z.string()])).default([]),
        used_nodes:         z.array(z.string()).default([]),
        request_id:         REQUEST_ID,
      },
      async (args) => {
        const agent = reg().get(args.agent_id);
        const eventsBefore = agent.ledger.events.length;
        const evalResult = makeEvaluationResult({
          task_id:           args.task_id,
          task_type:         args.task_type,
          success_score:     args.success_score,
          accuracy:          args.accuracy,
          user_satisfaction: args.user_satisfaction,
          cost_efficiency:   args.cost_efficiency,
          safety_score:      args.safety_score,
          notes:             args.notes,
          used_edges:        args.used_edges as Array<[string, string]>,
          used_nodes:        args.used_nodes,
        });
        agent.processEvaluation(evalResult);
        const newEvents = agent.ledger.events.slice(eventsBefore);
        return {
          summary: graphSummary(args.agent_id, agent),
          new_ledger_events: newEvents,
        };
      },
    );

    // ── 8. verdigraph_best_next_steps ──────────────────────────────────
    tool(
      "verdigraph_best_next_steps",
      {
        agent_id:   z.string().min(1),
        from_node:  z.string().min(1),
        limit:      z.number().int().min(1).max(100).default(3),
        request_id: REQUEST_ID,
      },
      async (args) => {
        const steps = reg().get(args.agent_id).bestNextSteps(args.from_node, args.limit);
        return { from_node: args.from_node, routes: steps };
      },
    );

    // ── 9. verdigraph_get_ledger (developmental) ───────────────────────
    tool(
      "verdigraph_get_ledger",
      {
        agent_id:   z.string().min(1),
        limit:      z.number().int().min(1).max(10000).default(50),
        request_id: REQUEST_ID,
      },
      async (args) => {
        const agent = reg().get(args.agent_id);
        const events = agent.ledger.events.slice(-args.limit);
        return { agent_id: args.agent_id, events };
      },
    );

    // ── 10. verdigraph_save_agent_state ────────────────────────────────
    tool(
      "verdigraph_save_agent_state",
      { agent_id: z.string().min(1), request_id: REQUEST_ID },
      async (args) => {
        const key = await reg().saveToR2(args.agent_id);
        return { agent_id: args.agent_id, r2_key: key };
      },
    );

    // ── 11. verdigraph_load_agent_state ────────────────────────────────
    tool(
      "verdigraph_load_agent_state",
      { agent_id: z.string().min(1), request_id: REQUEST_ID },
      async (args) => {
        const agent = await reg().loadFromR2(args.agent_id);
        return { agent_id: args.agent_id, summary: graphSummary(args.agent_id, agent) };
      },
    );

    // ── 12. verdigraph_delete_agent (soft) ─────────────────────────────
    tool(
      "verdigraph_delete_agent",
      { agent_id: z.string().min(1), request_id: REQUEST_ID },
      async (args) => {
        reg().softDelete(args.agent_id);
        return { deleted: args.agent_id, soft: true };
      },
    );

    // ── 13. verdigraph_should_use_cache ────────────────────────────────
    tool(
      "verdigraph_should_use_cache",
      {
        cache_confidence: z.number().min(0).max(1),
        task_risk:        z.number().min(0).max(1),
        threshold:        z.number().min(0).max(1).default(0.88),
        request_id:       REQUEST_ID,
      },
      async (args) => ({
        should_use_cache: shouldUseCache(args.cache_confidence, args.task_risk, args.threshold),
      }),
    );

    // ── 14. verdigraph_should_escalate ─────────────────────────────────
    tool(
      "verdigraph_should_escalate",
      {
        current_confidence: z.number().min(0).max(1),
        task_risk:          z.number().min(0).max(1),
        min_confidence:     z.number().min(0).max(1).default(0.78),
        request_id:         REQUEST_ID,
      },
      async (args) => ({
        should_escalate: shouldEscalate(args.current_confidence, args.task_risk, args.min_confidence),
      }),
    );

    // ── 15. verdigraph_get_balance (free — caller asks own balance) ─────
    freeTool(
      "verdigraph_get_balance",
      {},
      async () => {
        const micros = await getBalanceUsdMicros(env, callerId);
        return {
          caller_id:           callerId,
          balance_usd_micros:  micros,
          balance_usd:         microsToUsdString(micros),
        };
      },
    );

    // ── 16. verdigraph_create_topup_session (free — caller adds funds) ──
    freeTool(
      "verdigraph_create_topup_session",
      {
        amount_usd:  z.number().min(5).max(500).describe("Topup amount in USD ($5 min, $500 max)."),
        success_url: z.string().url().optional().describe("Where to redirect after successful payment."),
        cancel_url:  z.string().url().optional().describe("Where to redirect on cancellation."),
      },
      async (args) => {
        const req: import("../billing/checkout").TopupRequest = { callerId, amountUsd: args.amount_usd };
        if (args.success_url) req.successUrl = args.success_url;
        if (args.cancel_url)  req.cancelUrl  = args.cancel_url;
        return createTopupSession(env, req);
      },
    );

    // ── 17. verdigraph_topup_url (free — public anonymous credits URL) ─
    freeTool(
      "verdigraph_topup_url",
      {
        amount_usd: z.number().min(5).max(500).optional().describe("Optional preset amount to preselect on the page."),
      },
      async (args) => {
        const u = new URL("https://verdigraph.dev/credits");
        if (args.amount_usd) u.searchParams.set("amount", String(args.amount_usd));
        return {
          url: u.toString(),
          hint: "Hand this URL to your human; they pay anonymously and get a vdc_ code to redeem via verdigraph_redeem_credit_code. Or supply your caller_id on the page and credits land directly.",
        };
      },
    );

    // ── 18. verdigraph_redeem_credit_code (free — claim vdc_ code) ─────
    freeTool(
      "verdigraph_redeem_credit_code",
      {
        code: z.string().regex(/^vdc_[A-Z0-9]{24}$/).describe("Single-use credit code from /credits anonymous purchase."),
      },
      async (args) => {
        const { redeemCreditCode } = await import("../billing/credit_codes");
        const out = await redeemCreditCode(env, args.code, callerId);
        if (!out.redeemed) {
          return { ok: false, reason: out.reason };
        }
        return {
          ok: true,
          credited_usd_micros: out.amount_usd_micros,
          credited_usd: ((out.amount_usd_micros ?? 0) / 1_000_000).toFixed(2),
        };
      },
    );

    // ── 19. verdigraph_create_subscription (free — $20/mo auto-refill) ─
    freeTool(
      "verdigraph_create_subscription",
      {
        amount_usd:  z.number().min(5).max(100).default(20).describe("Monthly auto-refill amount (default $20)."),
        success_url: z.string().url().optional(),
        cancel_url:  z.string().url().optional(),
      },
      async (args) => {
        const { createCreditsCheckout } = await import("../billing/credits_page");
        return createCreditsCheckout(env, {
          amountUsd: args.amount_usd,
          callerId,
          isSubscription: true,
          successUrl: args.success_url,
          cancelUrl:  args.cancel_url,
        });
      },
    );

    // ── Brain-builder tool group (live MCP build environment) ───────────
    registerBrainTools({ env, callerId, tool, freeTool });
  }
}

function graphSummary(agentId: string, agent: DevelopmentalAgent) {
  return {
    agent_id:    agentId,
    agent_name:  agent.genome.agent_name,
    nodes: [...agent.graph.nodes.values()].map((n) => ({
      id:            n.id,
      type:          n.type,
      status:        n.status,
      trust_score:   round(n.trust_score, 4),
      usage_count:   n.usage_count,
      success_count: n.success_count,
      failure_count: n.failure_count,
    })),
    edges: [...agent.graph.edges.values()].map((e) => ({
      id:            `${e.from_node}->${e.to_node}`,
      from:          e.from_node,
      to:            e.to_node,
      weight:        round(e.weight, 4),
      trust_score:   round(e.trust_score, 4),
      success_count: e.success_count,
      failure_count: e.failure_count,
    })),
    ledger_events: agent.ledger.events.length,
  };
}

function round(n: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
