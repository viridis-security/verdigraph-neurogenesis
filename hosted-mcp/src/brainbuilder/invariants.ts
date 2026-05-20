// src/brainbuilder/invariants.ts — verify a built BrainArtifact against the
// 9 brain invariants (see schema.ts header) + the 11 Verdigraph design
// invariants. Runs server-side after every build and is also exposed via the
// brain JSON download so downstream consumers can re-verify offline.

import { BrainArtifact, BrainArtifactSchema, SUPPORTED_LLM_PROVIDERS } from "./schema";
import { canonicalize, sha256Hex } from "./canonicalize";

export interface InvariantCheck {
  id: string;
  description: string;
  passed: boolean;
  // P2.1: distinguishes auto-defaulted passes from explicitly-declared ones.
  // E.g. I8 passes when llm_bindings is auto-defaulted to "any", but the genome
  // didn't declare it — UI surfaces this as an amber asterisk on the green tick.
  passed_with_default?: boolean | undefined;
  // P2.3: advisory invariants don't fail the overall report; they're surfaced
  // for the human to act on (e.g. fitness metrics that aren't wired to any node).
  advisory?: boolean | undefined;
  detail?: string | undefined;
}

export interface InvariantReport {
  brain_id: string;
  checks:   InvariantCheck[];
  passed:   boolean;
}

export async function verifyBrain(brain: BrainArtifact): Promise<InvariantReport> {
  const checks: InvariantCheck[] = [];

  // Schema parse (full).
  const parsed = BrainArtifactSchema.safeParse(brain);
  checks.push({
    id: "schema",
    description: "Artifact matches brain.v1 schema",
    passed: parsed.success,
    detail: parsed.success ? undefined : parsed.error.message,
  });

  // I1: every node has a description.
  const missingDesc = brain.nodes.filter((n) => !n.description || n.description.trim() === "");
  checks.push({
    id: "I1_node_purpose",
    description: "Every node has a non-empty description (purpose)",
    passed: missingDesc.length === 0,
    detail: missingDesc.length ? `nodes missing purpose: ${missingDesc.map((n) => n.id).join(", ")}` : undefined,
  });

  // I2: edge endpoints exist.
  const nodeIds = new Set(brain.nodes.map((n) => n.id));
  const danglingEdges = brain.edges.filter((e) => !nodeIds.has(e.from_node) || !nodeIds.has(e.to_node));
  checks.push({
    id: "I2_edge_endpoints",
    description: "Every edge references existing node ids",
    passed: danglingEdges.length === 0,
    detail: danglingEdges.length ? `dangling edges: ${danglingEdges.map((e) => e.from_node + "->" + e.to_node).join(", ")}` : undefined,
  });

  // I3: respects max_nodes / max_edges.
  const overNodes = brain.nodes.length > brain.genome.growth_rules.max_nodes;
  const overEdges = brain.edges.length > brain.genome.growth_rules.max_edges;
  checks.push({
    id: "I3_size_limits",
    description: "Node and edge counts respect genome growth_rules limits",
    passed: !overNodes && !overEdges,
    detail: overNodes || overEdges
      ? `nodes=${brain.nodes.length}/${brain.genome.growth_rules.max_nodes} edges=${brain.edges.length}/${brain.genome.growth_rules.max_edges}`
      : undefined,
  });

  // I4: protected nodes are present in the graph.
  const protectedMissing = brain.genome.safety_axioms.protected_nodes.filter((p) => !nodeIds.has(p));
  checks.push({
    id: "I4_protected_present",
    description: "Protected nodes from safety_axioms exist in the node set",
    passed: protectedMissing.length === 0,
    detail: protectedMissing.length ? `missing protected nodes: ${protectedMissing.join(", ")}` : undefined,
  });

  // I5: content_hash matches canonical body.
  const { content_hash: _omit, ...rest } = brain as unknown as Record<string, unknown>;
  const expectedHash = await sha256Hex(canonicalize(rest));
  checks.push({
    id: "I5_content_hash",
    description: "content_hash matches sha256(canonical(body))",
    passed: brain.content_hash === expectedHash,
    detail: brain.content_hash !== expectedHash ? `expected ${expectedHash} got ${brain.content_hash}` : undefined,
  });

  // I6: input format is recognised.
  checks.push({
    id: "I6_known_format",
    description: "Provenance format is a supported extractor",
    passed: ["verdigraph_genome", "claude_project_export", "openai_assistant", "prompt_list"].includes(brain.provenance.format),
    detail: undefined,
  });

  // I7: each initial_node in the genome appears as a node in the graph.
  const initialMissing = brain.genome.initial_nodes.filter((n) => !nodeIds.has(n));
  checks.push({
    id: "I7_initial_nodes_present",
    description: "Genome's initial_nodes all exist in the node set",
    passed: initialMissing.length === 0,
    detail: initialMissing.length ? `missing initial nodes: ${initialMissing.join(", ")}` : undefined,
  });

  // I8: llm_bindings declares at least one provider; each is recognised.
  const bindings = brain.genome.llm_bindings ?? [];
  const unknownProvs = bindings.filter((b) => !SUPPORTED_LLM_PROVIDERS.includes(b.provider));
  const autoDefaulted = (brain.provenance.warnings ?? []).some((w) => w.toLowerCase().includes("llm_binding"));
  checks.push({
    id: "I8_llm_bindings",
    description: "At least one llm_binding, all providers recognised (BYO LLM)",
    passed: bindings.length > 0 && unknownProvs.length === 0,
    passed_with_default: autoDefaulted && bindings.length > 0 && unknownProvs.length === 0,
    detail: bindings.length === 0
      ? "no llm_bindings declared"
      : unknownProvs.length
        ? `unknown providers: ${unknownProvs.map((b) => b.provider).join(", ")}`
        : autoDefaulted
          ? "llm_bindings auto-defaulted to provider='any' — declare explicit bindings to remove the default"
          : undefined,
  });

  // I9 (ADVISORY): fitness metrics should map to at least one node tag or growth rule.
  // Advisory means: doesn't fail the overall report, but surfaces a hint.
  const fitness = brain.genome.fitness_metrics ?? [];
  const nodeBlob = brain.nodes.map((n) => `${n.id} ${n.type} ${n.description} ${JSON.stringify(n.metadata)}`).join(" ").toLowerCase();
  const unwired = fitness.filter((m) => !nodeBlob.includes(m.toLowerCase()));
  checks.push({
    id: "I9_fitness_metric_wired",
    description: "Each declared fitness_metric maps to at least one node (advisory)",
    passed: unwired.length === 0,
    advisory: true,
    detail: unwired.length ? `unwired fitness metrics: ${unwired.join(", ")} — they will not be measured until at least one node mentions them` : undefined,
  });

  // I9 (reproducibility) is verified externally by building twice from the
  // same input bytes and comparing content_hash — see tests/brainbuilder.

  return {
    brain_id: brain.brain_id,
    checks,
    passed: checks.filter((c) => !c.advisory).every((c) => c.passed),
  };
}
