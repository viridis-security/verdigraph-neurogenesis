// src/brainbuilder/schema.ts — Canonical "Brain" artifact schema.
//
// A Brain is the user-facing output of the brain-building shop. Two surfaces
// consume the same artifact:
//   - Web UI: human uploads an agent file, gets a Brain back.
//   - MCP tools: external agent calls brain.import / brain.get / brain.verify.
//
// Bring-Your-Own-LLM: the Brain declares which LLM providers it is compatible
// with. We do NOT proxy the user's inference; their agent calls their LLM
// directly using the brain's routing graph as guidance.
//
// Invariants verified in invariants.ts:
//  I1  Every node has a non-empty description (purpose).
//  I2  Every edge endpoint references an existing node.
//  I3  Node count <= genome.growth_rules.max_nodes; edges <= max_edges.
//  I4  Protected nodes from safety_axioms exist in the node set.
//  I5  content_hash == sha256(canonical(body without content_hash)).
//  I6  provenance.format is a supported extractor.
//  I7  genome.initial_nodes ⊆ node ids.
//  I8  llm_bindings declares at least one provider; each provider is recognised.
//  I9  Build is reproducible: identical input bytes -> identical content_hash.

import { z } from "zod/v3";

export const BRAIN_SCHEMA_VERSION = "brain.v1";

export const SUPPORTED_FORMATS = [
  "verdigraph_genome",
  "claude_project_export",
  "openai_assistant",
  "prompt_list",
] as const;
export type BrainInputFormat = (typeof SUPPORTED_FORMATS)[number];

export const SUPPORTED_LLM_PROVIDERS = [
  "anthropic",   // claude-* via Anthropic API or AWS Bedrock
  "openai",      // gpt-* via OpenAI API or Azure
  "google",      // gemini-* via Google AI / Vertex
  "mistral",     // mistral / codestral
  "local",       // user-hosted model (vLLM, llama.cpp, Ollama)
  "any",         // brain is provider-agnostic (pure structural routing)
] as const;
export type LlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

export const LlmBindingSchema = z.object({
  provider:        z.enum(SUPPORTED_LLM_PROVIDERS),
  model_hint:      z.string().optional(),             // e.g. "claude-sonnet-4-6", "gpt-4o", "local:llama3.1-70b"
  required_tools:  z.array(z.string()).default([]),   // tool names the brain assumes are available
  context_tokens:  z.number().int().min(0).default(0),// minimum context window the brain assumes
});
export type LlmBinding = z.infer<typeof LlmBindingSchema>;

export const BrainNodeSchema = z.object({
  id:             z.string().min(1),
  type:           z.string().min(1),
  description:    z.string().min(1),
  status:         z.string().default("active"),
  trust_score:    z.number().min(0).max(1).default(0.5),
  usage_count:    z.number().int().min(0).default(0),
  success_count:  z.number().int().min(0).default(0),
  failure_count:  z.number().int().min(0).default(0),
  created_at:     z.string(),
  metadata:       z.record(z.unknown()).default({}),
});
export type BrainNode = z.infer<typeof BrainNodeSchema>;

export const BrainEdgeSchema = z.object({
  from_node:     z.string().min(1),
  to_node:       z.string().min(1),
  weight:        z.number().min(0).max(1).default(0.5),
  plasticity:    z.number().min(0).max(1).default(0.5),
  trust_score:   z.number().min(0).max(1).default(0.5),
  success_count: z.number().int().min(0).default(0),
  failure_count: z.number().int().min(0).default(0),
  token_cost:    z.number().min(0).default(1.0),
  latency_ms:    z.number().min(0).default(1.0),
  risk_score:    z.number().min(0).max(1).default(1.0),
  decay_rate:    z.number().min(0).max(1).default(0.01),
  last_used:     z.string(),
  metadata:      z.record(z.unknown()).default({}),
});
export type BrainEdge = z.infer<typeof BrainEdgeSchema>;

export const BrainGenomeSchema = z.object({
  agent_name:      z.string().min(1),
  purpose:         z.string().min(1),
  initial_nodes:   z.array(z.string().min(1)).min(1),
  fitness_metrics: z.array(z.string().min(1)).min(1),
  llm_bindings:    z.array(LlmBindingSchema).min(1),  // I8: at least one binding
  growth_rules: z.object({
    create_node_when_task_repeats: z.number().int().min(1),
    strengthen_edge_on_success:    z.number().min(0).max(1),
    weaken_edge_on_failure:        z.number().min(0).max(1),
    prune_below_weight:            z.number().min(0).max(1),
    max_nodes:                     z.number().int().min(1),
    max_edges:                     z.number().int().min(0),
    min_events_before_pruning:     z.number().int().min(0),
    max_weight:                    z.number().min(0).max(1),
    min_weight:                    z.number().min(0).max(1),
  }),
  safety_axioms: z.object({
    protected_nodes:                  z.array(z.string()),
    require_growth_logging:           z.boolean(),
    require_pruning_logging:          z.boolean(),
    disallow_hidden_nodes:            z.boolean(),
    disallow_pruning_protected_nodes: z.boolean(),
    require_purpose_for_new_nodes:    z.boolean(),
    custom:                           z.record(z.unknown()).default({}),
  }),
});
export type BrainGenome = z.infer<typeof BrainGenomeSchema>;

export const BrainExtractorMetaSchema = z.object({
  format:        z.enum(SUPPORTED_FORMATS),
  input_bytes:   z.number().int().min(0),
  input_sha256:  z.string().length(64),
  extractor:     z.string().min(1),
  built_at:      z.string(),
  warnings:      z.array(z.string()).default([]),
});
export type BrainExtractorMeta = z.infer<typeof BrainExtractorMetaSchema>;

export const BrainArtifactSchema = z.object({
  schema_version: z.literal(BRAIN_SCHEMA_VERSION),
  brain_id:       z.string().min(1),
  genome:         BrainGenomeSchema,
  nodes:          z.array(BrainNodeSchema).min(1),
  edges:          z.array(BrainEdgeSchema).default([]),
  provenance:     BrainExtractorMetaSchema,
  content_hash:   z.string().length(64),
});
export type BrainArtifact = z.infer<typeof BrainArtifactSchema>;
