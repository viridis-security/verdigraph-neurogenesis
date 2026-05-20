// extractors/index.ts — dispatcher.

import { BrainArtifact, BrainInputFormat } from "../schema";
import { extractFromVerdigraphGenome } from "./verdigraph_genome";
import { extractFromClaudeProject }    from "./claude_project";
import { extractFromOpenAiAssistant }  from "./openai_assistant";
import { extractFromPromptList }       from "./prompt_list";

export async function extract(format: BrainInputFormat, inputBytes: Uint8Array): Promise<BrainArtifact> {
  switch (format) {
    case "verdigraph_genome":     return extractFromVerdigraphGenome(inputBytes);
    case "claude_project_export": return extractFromClaudeProject(inputBytes);
    case "openai_assistant":      return extractFromOpenAiAssistant(inputBytes);
    case "prompt_list":           return extractFromPromptList(inputBytes);
    default: {
      const _exhaust: never = format;
      throw new Error(`unsupported format: ${_exhaust as string}`);
    }
  }
}

/** Best-effort format auto-detection — examines top-level keys. */
export function detectFormat(inputBytes: Uint8Array): BrainInputFormat {
  const text = new TextDecoder().decode(inputBytes).trim();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return "prompt_list";
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.initial_nodes) && typeof parsed.agent_name === "string") return "verdigraph_genome";
      if (Array.isArray(parsed.tools) && parsed.tools.some((t: any) => t?.type === "function" || t?.type === "code_interpreter" || t?.type === "retrieval")) return "openai_assistant";
      if (typeof parsed.instructions === "string" && (Array.isArray(parsed.knowledge) || Array.isArray(parsed.tools))) return "claude_project_export";
      if (typeof parsed.instructions === "string") return "claude_project_export";
    }
  } catch { /* fall through */ }
  return "prompt_list";
}
