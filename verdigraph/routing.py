from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .graph import CognitiveEdge, CognitiveGraph


@dataclass(frozen=True)
class RouteStep:
    from_node: str
    to_node: str
    score: float


class Router:
    """Scores possible cognitive routes."""

    def __init__(self, graph: CognitiveGraph) -> None:
        self.graph = graph

    @staticmethod
    def edge_score(edge: CognitiveEdge, task_relevance: float = 1.0) -> float:
        numerator = edge.weight * edge.trust_score * max(0.01, edge.success_rate or 0.5) * task_relevance
        denominator = max(0.01, edge.token_cost * edge.latency_ms * edge.risk_score)
        return numerator / denominator

    def best_next_steps(self, from_node: str, limit: int = 3) -> List[RouteStep]:
        scored = [RouteStep(edge.from_node, edge.to_node, self.edge_score(edge)) for edge in self.graph.outgoing(from_node)]
        return sorted(scored, key=lambda step: step.score, reverse=True)[:limit]
