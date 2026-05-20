// extractors/openai_assistant.ts — OpenAI Assistants API config.
// Accepts an object roughly matching the Assistants API shape:
//   { name?, instructions?, model?, tools?: [{ type, function?: { name, description } }], file_ids? }

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

export const EXTRACTOR_TAG = "openai_assistant.v1";

interface OpenAiAssistantInput {
  name?:         string;
  instructions?: string;
  model?:        string;
  tools?:        Array<{ type?: string; function?: { name?: string; description?: string } }>;
  file_ids?:     string[];
}

export async function extractFromOpenAiAssistant(inputBytes: Uint8Array): Promise<BrainArtifact> {
  const text = new TextDecoder().decode(inputBytes);
  let raw: OpenAiAssistantInput;
  try { raw = JSON.parse(text); }
  catch (e) { throw new Error(`openai_assistant: invalid JSON (${(e as Error).message})`); }

  const warnings: string[] = [];
  const agentName    = raw.name?.trim() || "imported_openai_assistant";
  const instructions = raw.instructions?.trim() || "";

  if (!instructions && !(raw.tools?.length) && !(raw.file_ids?.length)) {
    throw new Error("openai_assistant: expected at least one of instructions/tools/file_ids");
  }

  const safety = defaultSafetyAxioms();
  const initialNodes: string[] = [];
  const nodes = [];

  if (instructions) {
    nodes.push(makeNode({ id: "system_instructions", description: instructions.slice(0, 400), type: "directive" }));
    initialNodes.push("system_instructions");
  }

  // tools[].type can be 'code_interpreter', 'retrieval', 'function'.
  for (const t of raw.tools ?? []) {
    if (!t || !t.type) continue;
    if (t.type === "function" && t.function?.name) {
      const id = `tool_fn_${slugify(t.function.name, 32)}`;
      nodes.push(makeNode({
        id,
        description: (t.function.description ?? `Function tool: ${t.function.name}`).slice(0, 300),
        type: "tool",
        metadata: { openai_tool: "function", function_name: t.function.name },
      }));
      initialNodes.push(id);
    } else {
      const id = `tool_${slugify(t.type, 24)}`;
      if (!initialNodes.includes(id)) {
        nodes.push(makeNode({
          id,
          description: `Built-in OpenAI tool: ${t.type}`,
          type: "tool",
          metadata: { openai_tool: t.type },
        }));
        initialNodes.push(id);
      }
    }
  }

  // Attached files -> knowledge nodes.
  for (const fid of raw.file_ids ?? []) {
    const id = `file_${slugify(String(fid), 24)}`;
    nodes.push(makeNode({
      id,
      description: `Attached file (OpenAI file id: ${fid})`,
      type: "knowledge",
      metadata: { openai_file_id: fid },
    }));
    initialNodes.push(id);
  }

  for (const p of safety.protected_nodes) {
    nodes.push(makeNode({ id: p, description: `Protected infrastructure node: ${p}`, type: "infrastructure" }));
  }

  if (initialNodes.length === 0) {
    throw new Error("openai_assistant: produced no initial nodes");
  }

  const edges = [];
  if (initialNodes.includes("system_instructions")) {
    for (const id of initialNodes) {
      if (id === "system_instructions") continue;
      edges.push(makeEdge({ from_node: "system_instructions", to_node: id, weight: 0.6 }));
    }
    edges.push(makeEdge({ from_node: "system_instructions", to_node: "safety_checker", weight: 0.7 }));
  }
  for (const id of initialNodes) {
    if (id.startsWith("file_"))    edges.push(makeEdge({ from_node: id, to_node: "evaluation_engine", weight: 0.4 }));
    if (id.startsWith("tool_"))    edges.push(makeEdge({ from_node: id, to_node: "ledger", weight: 0.5 }));
  }

  const llm = [defaultLlmBinding("openai", raw.model || "gpt-4o")];

  const output: ExtractorOutput = {
    genome: {
      agent_name: agentName,
      purpose: instructions ? instructions.slice(0, 280) : `OpenAI Assistant '${agentName}' reconstructed from export.`,
      initial_nodes: initialNodes,
      fitness_metrics: ["task_success_rate", "tool_call_success_rate"],
      llm_bindings: llm,
      growth_rules: defaultGrowthRules(),
      safety_axioms: safety,
    },
    nodes, edges, warnings,
  };

  return assembleBrain({ inputBytes, format: "openai_assistant", extractorTag: EXTRACTOR_TAG, output });
}
