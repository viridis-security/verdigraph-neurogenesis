// src/verdigraph/compute.ts — TS port of verdigraph/compute.py (ComputeOptimizer).
//
// Field-for-field parity with the Python pydantic schemas in verdigraph_mcp/server.py.
// The hosted MCP boundary takes profiles+task per call (no DEFAULT_PROFILES fall-through).

import { z } from "zod/v3";

// ── Pydantic-parity Zod schemas ─────────────────────────────────────────
export const ComputeProfileSchema = z.object({
  id:                       z.string().min(1),
  kind:                     z.string().default("model"),
  quality_score:            z.number().min(0).max(1).default(0.5),
  cost_per_1k_input_tokens: z.number().min(0).default(0),
  cost_per_1k_output_tokens: z.number().min(0).default(0),
  latency_ms:               z.number().min(0).default(1000),
  gpu_memory_gb:            z.number().min(0).default(0),
  max_context_tokens:       z.number().int().min(1).default(4096),
  local:                    z.boolean().default(false),
  metadata:                 z.record(z.unknown()).default({}),
});
export type ComputeProfile = z.infer<typeof ComputeProfileSchema>;

export const TaskProfileSchema = z.object({
  id:                     z.string().min(1),
  task_type:              z.string().min(1),
  difficulty:             z.number().min(0).max(1).default(0.5),
  risk:                   z.number().min(0).max(1).default(0.5),
  expected_input_tokens:  z.number().int().min(0).default(1000),
  expected_output_tokens: z.number().int().min(0).default(500),
  min_quality:            z.number().min(0).max(1).default(0.5),
  requires_local:         z.boolean().default(false),
  metadata:               z.record(z.unknown()).default({}),
});
export type TaskProfile = z.infer<typeof TaskProfileSchema>;

export interface ComputeDecision {
  profile_id:               string;
  score:                    number;
  estimated_cost:           number;
  estimated_latency_ms:     number;
  estimated_gpu_memory_gb:  number;
  reason:                   string;
}

export function estimateCost(p: ComputeProfile, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * p.cost_per_1k_input_tokens + (outputTokens / 1000) * p.cost_per_1k_output_tokens;
}

/** Convert a USD float into integer micro-USD with deterministic rounding. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/**
 * Pick the highest-scoring profile that meets the task's hard constraints
 * (min_quality, requires_local, max_context_tokens). Mirrors
 * verdigraph.compute.ComputeOptimizer.choose_profile.
 */
export function chooseProfile(profiles: ComputeProfile[], task: TaskProfile): ComputeDecision {
  if (profiles.length === 0) throw new Error("At least one ComputeProfile is required.");

  const candidates: ComputeDecision[] = [];
  for (const profile of profiles) {
    if (task.requires_local && !profile.local) continue;
    if (profile.max_context_tokens < task.expected_input_tokens + task.expected_output_tokens) continue;
    if (profile.quality_score < task.min_quality) continue;

    const qualityMargin    = profile.quality_score - task.min_quality;
    const riskPenalty      = Math.max(0, task.risk - profile.quality_score) * 2.0;
    const difficultyPenalty = Math.max(0, task.difficulty - profile.quality_score);
    const estCost          = estimateCost(profile, task.expected_input_tokens, task.expected_output_tokens);
    const normalizedCost   = estCost + (profile.latency_ms / 1000) * 0.001 + profile.gpu_memory_gb * 0.0005;

    let score = (profile.quality_score + Math.max(0, qualityMargin)) / Math.max(1e-9, normalizedCost + 0.01);
    score -= riskPenalty + difficultyPenalty;

    const reason = `selected candidate kind=${profile.kind}, quality=${profile.quality_score.toFixed(2)}, ` +
      `cost=${estCost.toFixed(6)}, latency_ms=${profile.latency_ms.toFixed(0)}, ` +
      `gpu_memory_gb=${profile.gpu_memory_gb.toFixed(2)}`;
    candidates.push({
      profile_id:              profile.id,
      score,
      estimated_cost:          estCost,
      estimated_latency_ms:    profile.latency_ms,
      estimated_gpu_memory_gb: profile.gpu_memory_gb,
      reason,
    });
  }

  if (candidates.length === 0) {
    throw new Error(
      `No compute profile satisfies the task constraints for task '${task.id}' ` +
      `(task_type=${task.task_type}, requires_local=${task.requires_local}, ` +
      `min_quality=${task.min_quality}, ` +
      `context_required=${task.expected_input_tokens + task.expected_output_tokens}).`,
    );
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!;
}

// ── Cache + escalation policies ────────────────────────────────────────
export function shouldUseCache(cacheConfidence: number, taskRisk: number, threshold = 0.88): boolean {
  if (taskRisk >= 0.75) return false;
  return cacheConfidence >= threshold;
}

export function shouldEscalate(currentConfidence: number, taskRisk: number, minConfidence = 0.78): boolean {
  const required = minConfidence + Math.max(0, taskRisk - 0.5) * 0.25;
  return currentConfidence < required;
}

// ── Default profile catalog (kept for back-compat with verdigraph_list_profiles).
export const DEFAULT_PROFILES: ComputeProfile[] = [
  {
    id: "cache.exact_match",
    kind: "cache",
    quality_score: 1.0,
    cost_per_1k_input_tokens: 0,
    cost_per_1k_output_tokens: 0,
    latency_ms: 5,
    gpu_memory_gb: 0,
    max_context_tokens: 1,
    local: true,
    metadata: { description: "Exact-match cached response" },
  },
  {
    id: "claude-haiku-4-5",
    kind: "api_model",
    quality_score: 0.78,
    cost_per_1k_input_tokens: 0.0008,
    cost_per_1k_output_tokens: 0.004,
    latency_ms: 400,
    gpu_memory_gb: 0,
    max_context_tokens: 200_000,
    local: false,
    metadata: { capabilities: ["text", "tool_use", "classification", "summary"] },
  },
  {
    id: "claude-sonnet-4-6",
    kind: "api_model",
    quality_score: 0.92,
    cost_per_1k_input_tokens: 0.003,
    cost_per_1k_output_tokens: 0.015,
    latency_ms: 900,
    gpu_memory_gb: 0,
    max_context_tokens: 200_000,
    local: false,
    metadata: { capabilities: ["text", "tool_use", "reasoning", "code"] },
  },
  {
    id: "claude-opus-4-6",
    kind: "api_model",
    quality_score: 0.98,
    cost_per_1k_input_tokens: 0.015,
    cost_per_1k_output_tokens: 0.075,
    latency_ms: 1800,
    gpu_memory_gb: 0,
    max_context_tokens: 200_000,
    local: false,
    metadata: { capabilities: ["text", "tool_use", "reasoning", "code", "research"] },
  },
];
