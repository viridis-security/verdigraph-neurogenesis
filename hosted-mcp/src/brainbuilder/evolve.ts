// src/brainbuilder/evolve.ts — apply task-event-driven evolution to a brain.
//
// Deterministic, LLM-free. Input: an existing BrainArtifact + a list of
// TaskEvents (success/failure on a route). Output: a new BrainArtifact whose
// nodes/edges have been updated under the genome's growth_rules and
// safety_axioms.
//
// Invariants that MUST still hold after evolution (verified by verifyBrain):
//   I1  every node has a description
//   I2  edges reference existing nodes
//   I3  size <= growth_rules.max_nodes/max_edges
//   I4  protected nodes present
//   I5  content_hash is recomputed on the new body
//   I7  initial_nodes still present
//   I8  llm_bindings preserved
//
// Operations:
//   - strengthen edge:   weight += strengthen_edge_on_success * plasticity
//   - weaken edge:       weight -= weaken_edge_on_failure   * plasticity
//   - prune edge:        if weight < prune_below_weight AND total_events >= min_events_before_pruning
//   - grow node:         if same (failure_pattern, sequence) repeats >= create_node_when_task_repeats
//
// Pruning a protected node is forbidden (safety_axioms.disallow_pruning_protected_nodes).

import { BrainArtifact, BrainEdge, BrainNode } from "./schema";
import { canonicalize, sha256Hex } from "./canonicalize";
import { sortBrainBody, makeNode, makeEdge } from "./extractors/common";

export interface TaskEvent {
  from_node: string;
  to_node:   string;
  success:   boolean;
  pattern?:  string;   // optional grouping key used for repeat-detection
}

export interface EvolveResult {
  brain:        BrainArtifact;
  growth_log:   Array<{ event: string; detail: string }>;
}

const NOW = () => new Date().toISOString();

export async function evolveBrain(prev: BrainArtifact, events: TaskEvent[]): Promise<EvolveResult> {
  const growth_log: EvolveResult["growth_log"] = [];

  // Defensive copy.
  const nodes: BrainNode[] = prev.nodes.map((n) => ({ ...n, metadata: { ...n.metadata } }));
  const edges: BrainEdge[] = prev.edges.map((e) => ({ ...e, metadata: { ...e.metadata } }));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const gr = prev.genome.growth_rules;
  const sa = prev.genome.safety_axioms;
  const protectedSet = new Set(sa.protected_nodes);

  const edgeIdx = new Map<string, BrainEdge>();
  for (const e of edges) edgeIdx.set(`${e.from_node}->${e.to_node}`, e);

  // 1. Apply per-event weight updates + usage counts.
  for (const ev of events) {
    if (!nodeIds.has(ev.from_node) || !nodeIds.has(ev.to_node)) {
      growth_log.push({ event: "skip", detail: `event references missing node: ${ev.from_node} -> ${ev.to_node}` });
      continue;
    }
    const key = `${ev.from_node}->${ev.to_node}`;
    let edge = edgeIdx.get(key);
    if (!edge) {
      edge = makeEdge({ from_node: ev.from_node, to_node: ev.to_node, weight: 0.4, last_used: NOW() });
      edges.push(edge);
      edgeIdx.set(key, edge);
      growth_log.push({ event: "edge_created", detail: `${ev.from_node} -> ${ev.to_node}` });
    }
    const delta = ev.success ? gr.strengthen_edge_on_success * edge.plasticity
                              : -gr.weaken_edge_on_failure * edge.plasticity;
    edge.weight = Math.max(gr.min_weight, Math.min(gr.max_weight, edge.weight + delta));
    edge.last_used = NOW();
    if (ev.success) edge.success_count += 1; else edge.failure_count += 1;

    // Update node usage counts too.
    const fromNode = nodes.find((n) => n.id === ev.from_node)!;
    fromNode.usage_count += 1;
    if (ev.success) fromNode.success_count += 1; else fromNode.failure_count += 1;
  }

  // 2. Pattern-driven node growth: if a (pattern) repeats N >= create_node_when_task_repeats, mint a module.
  if (gr.create_node_when_task_repeats > 0) {
    const patternCount = new Map<string, number>();
    for (const ev of events) {
      if (!ev.pattern) continue;
      patternCount.set(ev.pattern, (patternCount.get(ev.pattern) ?? 0) + 1);
    }
    for (const [pattern, count] of patternCount) {
      if (count < gr.create_node_when_task_repeats) continue;
      const id = `module_${pattern}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 48);
      if (nodeIds.has(id)) continue;
      if (nodes.length >= gr.max_nodes) {
        growth_log.push({ event: "growth_capped", detail: `would create ${id} but max_nodes reached` });
        break;
      }
      nodes.push(makeNode({ id, description: `Specialized module created from repeating pattern: ${pattern}`, type: "module", metadata: { spawned_from_pattern: pattern, observed_count: count } }));
      nodeIds.add(id);
      growth_log.push({ event: "node_created", detail: `${id} (pattern '${pattern}' x${count})` });
    }
  }

  // 3. Prune edges that fall below prune_below_weight and have enough events.
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i]!;
    const totalEvents = e.success_count + e.failure_count;
    if (totalEvents < gr.min_events_before_pruning) continue;
    if (e.weight >= gr.prune_below_weight) continue;
    // Never prune an edge whose endpoint is a protected node, per safety axiom.
    if (sa.disallow_pruning_protected_nodes && (protectedSet.has(e.from_node) || protectedSet.has(e.to_node))) {
      growth_log.push({ event: "prune_blocked", detail: `${e.from_node}->${e.to_node} protected by safety_axiom` });
      continue;
    }
    edges.splice(i, 1);
    growth_log.push({ event: "edge_pruned", detail: `${e.from_node}->${e.to_node} (weight=${e.weight.toFixed(3)})` });
  }

  // 4. Enforce edge cap.
  if (edges.length > gr.max_edges) {
    // Prune lowest-weight non-protected edges first.
    const sorted = edges
      .map((e, idx) => ({ idx, e }))
      .filter(({ e }) => !(sa.disallow_pruning_protected_nodes && (protectedSet.has(e.from_node) || protectedSet.has(e.to_node))))
      .sort((a, b) => a.e.weight - b.e.weight);
    while (edges.length > gr.max_edges && sorted.length > 0) {
      const { e } = sorted.shift()!;
      const idx = edges.indexOf(e);
      if (idx >= 0) {
        edges.splice(idx, 1);
        growth_log.push({ event: "edge_pruned_cap", detail: `${e.from_node}->${e.to_node} (cap enforcement)` });
      }
    }
  }

  // 5. Reassemble + rehash.
  const sorted = sortBrainBody(nodes, edges);
  const body = {
    schema_version: prev.schema_version,
    brain_id:       prev.brain_id,
    genome:         prev.genome,
    nodes:          sorted.nodes,
    edges:          sorted.edges,
    provenance: {
      ...prev.provenance,
      built_at: NOW(),
      warnings: [...prev.provenance.warnings, `evolved with ${events.length} event(s)`],
    },
  };
  const content_hash = await sha256Hex(canonicalize(body));
  return { brain: { ...body, content_hash } as BrainArtifact, growth_log };
}
