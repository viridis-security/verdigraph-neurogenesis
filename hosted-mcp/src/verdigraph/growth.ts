// src/verdigraph/growth.ts — TS port of verdigraph/growth.py.

import type { HydratedGenome } from "./genome";
import type { CognitiveGraph } from "./graph";
import { clampEdge, makeEdge, makeNode, edgeId, utcNow } from "./graph";
import type { EvaluationResult } from "./evaluation";
import { isSuccess } from "./evaluation";
import type { DevelopmentalLedger } from "./dev_ledger";

export class GrowthEngine {
  taskCounts: Map<string, number> = new Map();

  constructor(
    public genome: HydratedGenome,
    public graph: CognitiveGraph,
    public ledger: DevelopmentalLedger,
  ) {}

  reinforceFromEvaluation(result: EvaluationResult): void {
    const rules = this.genome.growth_rules;
    if (!isSuccess(result)) return;

    for (const [fromNode, toNode] of result.used_edges) {
      const edge = this.graph.getEdge(fromNode, toNode);
      if (!edge) continue;
      const oldWeight = edge.weight;
      edge.success_count += 1;
      edge.last_used = utcNow();
      edge.weight += rules.strengthen_edge_on_success * result.success_score * edge.plasticity;
      edge.trust_score += 0.03 * result.safety_score;
      clampEdge(edge, rules.min_weight, rules.max_weight);
      this.ledger.record(
        "edge_strengthened",
        "Pathway contributed to successful task outcome.",
        { edge: edgeId(edge), old_weight: oldWeight, new_weight: edge.weight, task_id: result.task_id },
      );
    }

    for (const nodeId of result.used_nodes) {
      const node = this.graph.nodes.get(nodeId);
      if (!node) continue;
      node.usage_count += 1;
      node.success_count += 1;
      node.trust_score = Math.min(1, node.trust_score + 0.02);
    }
  }

  maybeGrowForTaskType(taskType: string): void {
    const prev = this.taskCounts.get(taskType) ?? 0;
    const next = prev + 1;
    this.taskCounts.set(taskType, next);

    const rules = this.genome.growth_rules;
    if (next < rules.create_node_when_task_repeats) return;
    const proposedId = `${taskType}_specialist`;
    if (this.graph.nodes.has(proposedId)) return;
    if (this.graph.nodes.size >= rules.max_nodes) {
      this.ledger.record("growth_blocked", "Maximum node count reached.", { proposed_node: proposedId });
      return;
    }
    this.createNode({
      node_id:      proposedId,
      node_type:    "specialist",
      description:  `Specialized module grown after repeated task type: ${taskType}`,
      connect_from: this.hubNodes(),
    });
  }

  createNode(args: { node_id: string; node_type: string; description: string; connect_from: Iterable<string> }): void {
    if (this.genome.safety_axioms.require_purpose_for_new_nodes && !args.description.trim()) {
      throw new Error("New nodes require a purpose/description");
    }
    if (this.graph.nodes.size >= this.genome.growth_rules.max_nodes) return;
    this.graph.addNode(makeNode({ id: args.node_id, type: args.node_type, description: args.description, trust_score: 0.55 }));

    const createdEdges: string[] = [];
    for (const src of args.connect_from) {
      if (
        this.graph.nodes.has(src) &&
        this.graph.edges.size < this.genome.growth_rules.max_edges
      ) {
        const edge = makeEdge({ from_node: src, to_node: args.node_id, weight: 0.35, trust_score: 0.55, plasticity: 0.7 });
        this.graph.addEdge(edge);
        createdEdges.push(edgeId(edge));
      }
    }
    this.ledger.record(
      "node_created",
      "Growth engine created a bounded, inspectable cognitive node.",
      { node: args.node_id, node_type: args.node_type, description: args.description, created_edges: createdEdges },
    );
  }

  private hubNodes(): string[] {
    const preferred = ["planner", "tool_router", "memory", "evaluation_engine"];
    const hubs = preferred.filter((n) => this.graph.nodes.has(n));
    if (hubs.length > 0) return hubs;
    return [...this.graph.nodes.keys()].slice(0, 2);
  }
}
