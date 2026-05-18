// src/verdigraph/pruning.ts — TS port of verdigraph/pruning.py.

import type { HydratedGenome } from "./genome";
import type { CognitiveGraph } from "./graph";
import { clampEdge, edgeId, edgeSuccessRate, utcNow } from "./graph";
import type { EvaluationResult } from "./evaluation";
import { isFailure } from "./evaluation";
import type { DevelopmentalLedger } from "./dev_ledger";

export class PruningEngine {
  constructor(
    public genome: HydratedGenome,
    public graph: CognitiveGraph,
    public ledger: DevelopmentalLedger,
  ) {}

  weakenFromEvaluation(result: EvaluationResult): void {
    if (!isFailure(result)) return;
    const rules = this.genome.growth_rules;

    for (const [fromNode, toNode] of result.used_edges) {
      const edge = this.graph.getEdge(fromNode, toNode);
      if (!edge) continue;
      const oldWeight = edge.weight;
      edge.failure_count += 1;
      edge.last_used = utcNow();
      const riskMultiplier = 1.0 + (1.0 - result.safety_score);
      edge.weight -= rules.weaken_edge_on_failure * (1.0 - result.success_score) * riskMultiplier;
      edge.trust_score -= 0.05 * riskMultiplier;
      clampEdge(edge, rules.min_weight, rules.max_weight);
      this.ledger.record(
        "edge_weakened",
        "Pathway contributed to failed or low-safety outcome.",
        { edge: edgeId(edge), old_weight: oldWeight, new_weight: edge.weight, task_id: result.task_id },
      );
    }
  }

  pruneLowValueEdges(): void {
    const rules = this.genome.growth_rules;
    for (const key of [...this.graph.edges.keys()]) {
      const edge = this.graph.edges.get(key);
      if (!edge) continue;
      const observations = edge.success_count + edge.failure_count;
      if (observations < rules.min_events_before_pruning) continue;
      if (edge.weight < rules.prune_below_weight && edgeSuccessRate(edge) < 0.3) {
        this.graph.removeEdge(edge.from_node, edge.to_node);
        this.ledger.record(
          "edge_pruned",
          "Edge fell below weight and success thresholds.",
          { edge: edgeId(edge), weight: edge.weight, success_rate: edgeSuccessRate(edge) },
        );
      }
    }
  }

  pruneInactiveNodes(): void {
    const protectedSet = new Set(this.genome.safety_axioms.protected_nodes);
    for (const [nodeId, node] of [...this.graph.nodes]) {
      if (protectedSet.has(nodeId) && this.genome.safety_axioms.disallow_pruning_protected_nodes) continue;
      if (node.usage_count >= this.genome.growth_rules.min_events_before_pruning) continue;
      if (node.status !== "active") continue;
      if (this.graph.incoming(nodeId).length === 0 && this.graph.outgoing(nodeId).length === 0) {
        node.status = "archived";
        this.ledger.record("node_archived", "Inactive isolated node archived.", { node: nodeId });
      }
    }
  }
}
