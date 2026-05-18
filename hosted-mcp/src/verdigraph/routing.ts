// src/verdigraph/routing.ts — TS port of verdigraph/routing.py.

import type { CognitiveEdge, CognitiveGraph } from "./graph";
import { edgeSuccessRate } from "./graph";

export interface RouteStep {
  from_node: string;
  to_node: string;
  score: number;
}

export class Router {
  constructor(public graph: CognitiveGraph) {}

  static edgeScore(edge: CognitiveEdge, taskRelevance = 1.0): number {
    const sr = edgeSuccessRate(edge);
    const numerator = edge.weight * edge.trust_score * Math.max(0.01, sr || 0.5) * taskRelevance;
    const denominator = Math.max(0.01, edge.token_cost * edge.latency_ms * edge.risk_score);
    return numerator / denominator;
  }

  bestNextSteps(fromNode: string, limit = 3): RouteStep[] {
    const scored: RouteStep[] = this.graph.outgoing(fromNode).map((e) => ({
      from_node: e.from_node,
      to_node:   e.to_node,
      score:     Router.edgeScore(e),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}
