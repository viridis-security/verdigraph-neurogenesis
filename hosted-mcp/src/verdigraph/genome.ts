// src/verdigraph/genome.ts — TS port of verdigraph/genome.py.

import { z } from "zod/v3";

export const GrowthRulesSchema = z.object({
  create_node_when_task_repeats: z.number().int().min(1).default(5),
  strengthen_edge_on_success:    z.number().min(0).max(1).default(0.08),
  weaken_edge_on_failure:        z.number().min(0).max(1).default(0.05),
  prune_below_weight:            z.number().min(0).max(1).default(0.12),
  max_nodes:                     z.number().int().min(1).default(128),
  max_edges:                     z.number().int().min(0).default(512),
  min_events_before_pruning:     z.number().int().min(0).default(3),
  max_weight:                    z.number().min(0).max(1).default(1.0),
  min_weight:                    z.number().min(0).max(1).default(0.0),
}).superRefine((data, ctx) => {
  if (data.min_weight > data.max_weight) {
    ctx.addIssue({ code: "custom", message: "min_weight must be <= max_weight" });
  }
});
export type GrowthRules = z.infer<typeof GrowthRulesSchema>;

export const SafetyAxiomsSchema = z.object({
  protected_nodes: z.array(z.string()).default(() => ["safety_checker", "evaluation_engine", "ledger"]),
  require_growth_logging:           z.boolean().default(true),
  require_pruning_logging:          z.boolean().default(true),
  disallow_hidden_nodes:            z.boolean().default(true),
  disallow_pruning_protected_nodes: z.boolean().default(true),
  require_purpose_for_new_nodes:    z.boolean().default(true),
  custom: z.record(z.unknown()).default({}),
});
export type SafetyAxioms = z.infer<typeof SafetyAxiomsSchema>;

// Inputs accept partial sub-objects (defaults applied on hydration).
export const AgentGenomeInputSchema = z.object({
  agent_name:       z.string().min(1),
  purpose:          z.string().min(1),
  initial_nodes:    z.array(z.string().min(1)).min(1),
  fitness_metrics:  z.array(z.string().min(1)).min(1),
  growth_rules:     GrowthRulesSchema.optional(),
  safety_axioms:    SafetyAxiomsSchema.optional(),
  metadata:         z.record(z.unknown()).default({}),
}).superRefine((data, ctx) => {
  const seen = new Set<string>();
  for (const id of data.initial_nodes) {
    if (seen.has(id)) {
      ctx.addIssue({ code: "custom", message: `initial_nodes must be unique (duplicate: ${id})` });
      return;
    }
    seen.add(id);
  }
});
export type AgentGenomeInput = z.infer<typeof AgentGenomeInputSchema>;

// Keep the legacy export name so existing imports keep working.
export const AgentGenomeSchema = AgentGenomeInputSchema;
export type AgentGenome = AgentGenomeInput;

/** Fully-hydrated genome: every optional sub-object replaced with its defaulted form. */
export interface HydratedGenome {
  agent_name:      string;
  purpose:         string;
  initial_nodes:   string[];
  fitness_metrics: string[];
  growth_rules:    GrowthRules;
  safety_axioms:   SafetyAxioms;
  metadata:        Record<string, unknown>;
}

export function hydrateGenome(input: AgentGenomeInput): HydratedGenome {
  const growth_rules  = GrowthRulesSchema.parse(input.growth_rules  ?? {});
  const safety_axioms = SafetyAxiomsSchema.parse(input.safety_axioms ?? {});
  return {
    agent_name:      input.agent_name,
    purpose:         input.purpose,
    initial_nodes:   [...input.initial_nodes],
    fitness_metrics: [...input.fitness_metrics],
    growth_rules,
    safety_axioms,
    metadata:        { ...(input.metadata ?? {}) },
  };
}
