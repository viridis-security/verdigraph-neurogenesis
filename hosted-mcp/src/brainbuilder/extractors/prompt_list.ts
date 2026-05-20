// extractors/prompt_list.ts — flat list of system/user prompts.
// Input: JSON or newline-separated text. Each prompt becomes a cognitive node;
// sequential prompts get directional edges (later prompts depend on earlier).

import { BrainArtifact } from "../schema";
import {
  assembleBrain,
  defaultGrowthRules,
  defaultSafetyAxioms,
  defaultLlmBinding,
  makeNode,
  makeEdge,
  slugify,
  ExtractorOutput,
} from "./common";

export const EXTRACTOR_TAG = "prompt_list.v1";

interface PromptItem { role?: string; content: string; }

function tryJsonList(text: string): PromptItem[] | null {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const out: PromptItem[] = [];
    for (const item of parsed) {
      if (typeof item === "string") out.push({ role: "user", content: item });
      else if (item && typeof item.content === "string") out.push({ role: typeof item.role === "string" ? item.role : "user", content: item.content });
    }
    return out.length ? out : null;
  } catch { return null; }
}

function parseNewlineSeparated(text: string): PromptItem[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0).map((s) => ({ role: "user", content: s }));
}

export async function extractFromPromptList(inputBytes: Uint8Array): Promise<BrainArtifact> {
  const text = new TextDecoder().decode(inputBytes);
  const items = tryJsonList(text) ?? parseNewlineSeparated(text);
  if (items.length === 0) {
    throw new Error("prompt_list: no prompts found (expected JSON array or newline-separated text)");
  }

  const warnings: string[] = [];
  if (items.length > 64) {
    warnings.push(`truncated to first 64 prompts (got ${items.length}); upgrade to a richer extractor for larger graphs`);
    items.length = 64;
  }

  // Build nodes — slugify content into stable ids, dedupe.
  const seen = new Map<string, { idx: number; item: PromptItem }>();
  const ordered: { id: string; idx: number; item: PromptItem }[] = [];
  let counter = 0;
  for (const item of items) {
    const baseId = `${item.role ?? "user"}_${slugify(item.content, 32)}`;
    let id = baseId;
    let suffix = 1;
    while (seen.has(id)) { id = `${baseId}_${++suffix}`; }
    seen.set(id, { idx: counter, item });
    ordered.push({ id, idx: counter, item });
    counter++;
  }

  const safety = defaultSafetyAxioms();
  const protectedNodes = safety.protected_nodes;

  const nodes = [
    ...ordered.map((o) => makeNode({
      id: o.id,
      description: o.item.content.slice(0, 200) || "(empty prompt)",
      type: o.item.role === "system" ? "directive" : "prompt",
      metadata: { role: o.item.role ?? "user", sequence: o.idx },
    })),
    ...protectedNodes.map((p) => makeNode({
      id: p, description: `Protected infrastructure node: ${p}`, type: "infrastructure",
    })),
  ];

  // Edges: chain prompts in order; connect terminal prompt to evaluation_engine.
  const edges = [];
  for (let i = 1; i < ordered.length; i++) {
    edges.push(makeEdge({ from_node: ordered[i - 1]!.id, to_node: ordered[i]!.id, weight: 0.6 }));
  }
  if (ordered.length > 0) {
    edges.push(makeEdge({ from_node: ordered[ordered.length - 1]!.id, to_node: "evaluation_engine", weight: 0.5 }));
    edges.push(makeEdge({ from_node: "evaluation_engine", to_node: "ledger", weight: 0.7 }));
    edges.push(makeEdge({ from_node: ordered[0]!.id, to_node: "safety_checker", weight: 0.5 }));
  }

  const output: ExtractorOutput = {
    genome: {
      agent_name: "imported_prompt_list",
      purpose: `Sequential prompt-driven agent reconstructed from ${ordered.length} prompts.`,
      initial_nodes: ordered.map((o) => o.id),
      fitness_metrics: ["task_success_rate"],
      llm_bindings: [defaultLlmBinding("any")],
      growth_rules: defaultGrowthRules(),
      safety_axioms: safety,
    },
    nodes, edges, warnings,
  };

  return assembleBrain({ inputBytes, format: "prompt_list", extractorTag: EXTRACTOR_TAG, output });
}
