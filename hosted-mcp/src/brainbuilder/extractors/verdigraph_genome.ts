// extractors/verdigraph_genome.ts — identity case.
// Input: a JSON file matching our Verdigraph AgentGenome schema (loose form).
// Output: a Brain with one node per initial_node, fully-connected initial graph.

import { BrainArtifact, LlmBinding } from "../schema";
import {
  assembleBrain,
  defaultGrowthRules,
  defaultSafetyAxioms,
  defaultLlmBinding,
  makeNode,
  makeEdge,
  ExtractorOutput,
} from "./common";

export const EXTRACTOR_TAG = "verdigraph_genome.v1";

interface VerdigraphInput {
  agent_name?:      string;
  purpose?:         string;
  initial_nodes?:   string[];
  fitness_metrics?: string[];
  llm_bindings?: Array<{
    provider: string;
    model_hint?: string;
    required_tools?: string[];
    context_tokens?: number;
  }>;
  growth_rules?:   Partial<ReturnType<typeof defaultGrowthRules>>;
  safety_axioms?:  Partial<ReturnType<typeof defaultSafetyAxioms>>;
}

export async function extractFromVerdigraphGenome(inputBytes: Uint8Array): Promise<BrainArtifact> {
  const text = new TextDecoder().decode(inputBytes);
  let raw: VerdigraphInput;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`verdigraph_genome: invalid JSON (${(e as Error).message})`);
  }

  const warnings: string[] = [];

  const initialNodes = (raw.initial_nodes ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (initialNodes.length === 0) {
    throw new Error("verdigraph_genome: initial_nodes is required and must be non-empty");
  }

  const agentName = raw.agent_name?.trim() || "imported_agent";
  const purpose   = raw.purpose?.trim()    || "Imported Verdigraph agent (purpose not specified).";
  const fitness   = (raw.fitness_metrics ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (fitness.length === 0) {
    warnings.push("fitness_metrics missing; defaulted to ['task_success_rate']");
    fitness.push("task_success_rate");
  }

  const llmBindings: LlmBinding[] = (raw.llm_bindings ?? [])
    .filter((b) => b && typeof b.provider === "string")
    .map((b): LlmBinding => {
      const out: LlmBinding = {
        provider: b.provider as any,
        required_tools: b.required_tools ?? [],
        context_tokens: b.context_tokens ?? 0,
      };
      if (b.model_hint !== undefined) out.model_hint = b.model_hint;
      return out;
    });
  if (llmBindings.length === 0) {
    warnings.push("no llm_bindings declared in input; defaulted to provider='any' (BYO LLM)");
    llmBindings.push(defaultLlmBinding("any"));
  }

  // Genome
  const safety = { ...defaultSafetyAxioms(), ...(raw.safety_axioms ?? {}) };
  const growth = { ...defaultGrowthRules(), ...(raw.growth_rules ?? {}) };

  // Ensure protected nodes are in initial_nodes so I4 passes.
  const protectedSet = new Set(safety.protected_nodes);
  const allNodeIds   = new Set([...initialNodes, ...protectedSet]);

  const nodes = [...allNodeIds].map((id) => makeNode({
    id,
    description: initialNodes.includes(id)
      ? `Initial cognitive node: ${id}`
      : `Protected infrastructure node: ${id}`,
    type: protectedSet.has(id) ? "infrastructure" : "module",
  }));

  // Initial routing edges: connect each non-protected initial node to each
  // protected infrastructure node (so the safety/eval/ledger chain is wired
  // by default). Deterministic order; no random weights.
  const edges = [];
  for (const from of initialNodes) {
    if (protectedSet.has(from)) continue;
    for (const to of safety.protected_nodes) {
      edges.push(makeEdge({ from_node: from, to_node: to, weight: 0.5 }));
    }
  }

  const output: ExtractorOutput = {
    genome: {
      agent_name: agentName,
      purpose,
      initial_nodes: initialNodes,
      fitness_metrics: fitness,
      llm_bindings: llmBindings,
      growth_rules: growth,
      safety_axioms: safety,
    },
    nodes,
    edges,
    warnings,
  };

  return assembleBrain({
    inputBytes,
    format: "verdigraph_genome",
    extractorTag: EXTRACTOR_TAG,
    output,
  });
}
