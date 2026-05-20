// src/brainbuilder/extractors/common.ts — helpers shared by every extractor.
// All extractors are deterministic: same input bytes -> same BrainArtifact.

import {
  BrainArtifact,
  BrainGenome,
  BrainNode,
  BrainEdge,
  BrainInputFormat,
  BRAIN_SCHEMA_VERSION,
  LlmBinding,
} from "../schema";
import { canonicalize, sha256Hex, deriveBrainId } from "../canonicalize";

export interface ExtractorOutput {
  genome:   BrainGenome;
  nodes:    BrainNode[];
  edges:    BrainEdge[];
  warnings: string[];
}

const FIXED_EPOCH = "1970-01-01T00:00:00.000Z";

export function defaultGrowthRules(): BrainGenome["growth_rules"] {
  return {
    create_node_when_task_repeats: 5,
    strengthen_edge_on_success:    0.08,
    weaken_edge_on_failure:        0.05,
    prune_below_weight:            0.12,
    max_nodes:                     128,
    max_edges:                     512,
    min_events_before_pruning:     3,
    max_weight:                    1.0,
    min_weight:                    0.0,
  };
}

export function defaultSafetyAxioms(): BrainGenome["safety_axioms"] {
  return {
    protected_nodes: ["safety_checker", "evaluation_engine", "ledger"],
    require_growth_logging:           true,
    require_pruning_logging:          true,
    disallow_hidden_nodes:            true,
    disallow_pruning_protected_nodes: true,
    require_purpose_for_new_nodes:    true,
    custom:                           {},
  };
}

export function defaultLlmBinding(provider: LlmBinding["provider"] = "any", model_hint?: string): LlmBinding {
  return { provider, model_hint, required_tools: [], context_tokens: 0 };
}

export function makeNode(init: Partial<BrainNode> & { id: string; description: string }): BrainNode {
  return {
    id:            init.id,
    type:          init.type          ?? "module",
    description:   init.description,
    status:        init.status        ?? "active",
    trust_score:   init.trust_score   ?? 0.5,
    usage_count:   init.usage_count   ?? 0,
    success_count: init.success_count ?? 0,
    failure_count: init.failure_count ?? 0,
    created_at:    init.created_at    ?? FIXED_EPOCH,
    metadata:      init.metadata      ?? {},
  };
}

export function makeEdge(init: Partial<BrainEdge> & { from_node: string; to_node: string }): BrainEdge {
  return {
    from_node:     init.from_node,
    to_node:       init.to_node,
    weight:        init.weight        ?? 0.5,
    plasticity:    init.plasticity    ?? 0.5,
    trust_score:   init.trust_score   ?? 0.5,
    success_count: init.success_count ?? 0,
    failure_count: init.failure_count ?? 0,
    token_cost:    init.token_cost    ?? 1.0,
    latency_ms:    init.latency_ms    ?? 1.0,
    risk_score:    init.risk_score    ?? 1.0,
    decay_rate:    init.decay_rate    ?? 0.01,
    last_used:     init.last_used     ?? FIXED_EPOCH,
    metadata:      init.metadata      ?? {},
  };
}

export function sortBrainBody(nodes: BrainNode[], edges: BrainEdge[]) {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.from_node !== b.from_node) return a.from_node.localeCompare(b.from_node);
    return a.to_node.localeCompare(b.to_node);
  });
  return { nodes: sortedNodes, edges: sortedEdges };
}

export function slugify(s: string, maxLen = 48): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLen);
  return base.length ? base : "node";
}

export interface AssembleArgs {
  inputBytes:   Uint8Array;
  format:       BrainInputFormat;
  extractorTag: string;
  output:       ExtractorOutput;
  builtAt?:     string;
}

export async function assembleBrain(args: AssembleArgs): Promise<BrainArtifact> {
  const { inputBytes, format, extractorTag, output } = args;
  const inputSha = await sha256Hex(inputBytes);
  const brainId  = await deriveBrainId(inputBytes, format);
  const { nodes, edges } = sortBrainBody(output.nodes, output.edges);
  const body = {
    schema_version: BRAIN_SCHEMA_VERSION,
    brain_id:       brainId,
    genome:         output.genome,
    nodes,
    edges,
    provenance: {
      format,
      input_bytes:  inputBytes.byteLength,
      input_sha256: inputSha,
      extractor:    extractorTag,
      built_at:     args.builtAt ?? FIXED_EPOCH,
      warnings:     output.warnings,
    },
  };
  const content_hash = await sha256Hex(canonicalize(body));
  return { ...body, content_hash } as BrainArtifact;
}
