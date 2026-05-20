// extractors/claude_project.ts — Claude project export bundle.
// Accepts a JSON object with at least one of:
//   { instructions: string, knowledge?: [{ name, content }], tools?: [{ name, description }] }
// We do a deterministic structural mapping; no LLM is used.

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

export const EXTRACTOR_TAG = "claude_project_export.v1";

interface ClaudeProjectInput {
  name?:         string;
  instructions?: string;
  knowledge?:    Array<{ name?: string; title?: string; content?: string; summary?: string }>;
  tools?:        Array<{ name?: string; description?: string }>;
  model?:        string;
}

export async function extractFromClaudeProject(inputBytes: Uint8Array): Promise<BrainArtifact> {
  const text = new TextDecoder().decode(inputBytes);
  let raw: ClaudeProjectInput;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error(`claude_project_export: invalid JSON (${(e as Error).message})`); }

  const warnings: string[] = [];
  const agentName = raw.name?.trim() || "imported_claude_project";
  const instructions = raw.instructions?.trim() || "";

  if (!instructions && !(raw.knowledge?.length) && !(raw.tools?.length)) {
    throw new Error("claude_project_export: expected at least one of instructions/knowledge/tools");
  }

  const safety = defaultSafetyAxioms();
  const initialNodes: string[] = [];
  const nodes = [];

  if (instructions) {
    nodes.push(makeNode({
      id: "system_instructions",
      description: instructions.slice(0, 400),
      type: "directive",
    }));
    initialNodes.push("system_instructions");
  }

  // Knowledge entries -> knowledge nodes.
  const knowledge = (raw.knowledge ?? []).filter((k) => k && (k.content || k.summary || k.name || k.title));
  for (const k of knowledge) {
    const label = k.name ?? k.title ?? "knowledge";
    const id = `knowledge_${slugify(label, 32)}`;
    nodes.push(makeNode({
      id,
      description: (k.summary ?? k.content ?? label).slice(0, 300),
      type: "knowledge",
      metadata: { source_label: label },
    }));
    initialNodes.push(id);
  }

  // Tool definitions -> tool nodes.
  const tools = (raw.tools ?? []).filter((t) => t && t.name);
  for (const t of tools) {
    const id = `tool_${slugify(t.name!, 32)}`;
    nodes.push(makeNode({
      id,
      description: (t.description ?? `External tool: ${t.name}`).slice(0, 300),
      type: "tool",
      metadata: { tool_name: t.name },
    }));
    initialNodes.push(id);
  }

  // Add protected infrastructure nodes.
  for (const p of safety.protected_nodes) {
    nodes.push(makeNode({ id: p, description: `Protected infrastructure node: ${p}`, type: "infrastructure" }));
  }

  if (initialNodes.length === 0) {
    throw new Error("claude_project_export: produced no initial nodes");
  }

  // Edges: instructions -> every knowledge + tool node; knowledge -> evaluation; tools -> ledger.
  const edges = [];
  if (initialNodes.includes("system_instructions")) {
    for (const id of initialNodes) {
      if (id === "system_instructions") continue;
      edges.push(makeEdge({ from_node: "system_instructions", to_node: id, weight: 0.6 }));
    }
    edges.push(makeEdge({ from_node: "system_instructions", to_node: "safety_checker", weight: 0.7 }));
  }
  for (const id of initialNodes) {
    if (id.startsWith("knowledge_")) edges.push(makeEdge({ from_node: id, to_node: "evaluation_engine", weight: 0.4 }));
    if (id.startsWith("tool_"))      edges.push(makeEdge({ from_node: id, to_node: "ledger", weight: 0.5 }));
  }

  // LLM binding — Claude is the natural default since this is a Claude project export.
  const llm = [defaultLlmBinding("anthropic", raw.model || "claude-sonnet-4-6")];

  const output: ExtractorOutput = {
    genome: {
      agent_name: agentName,
      purpose: instructions ? instructions.slice(0, 280) : `Claude project '${agentName}' reconstructed from export.`,
      initial_nodes: initialNodes,
      fitness_metrics: ["task_success_rate", "tool_call_success_rate"],
      llm_bindings: llm,
      growth_rules: defaultGrowthRules(),
      safety_axioms: safety,
    },
    nodes, edges, warnings,
  };

  return assembleBrain({ inputBytes, format: "claude_project_export", extractorTag: EXTRACTOR_TAG, output });
}
