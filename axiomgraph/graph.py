from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CognitiveNode:
    id: str
    type: str = "module"
    description: str = ""
    status: str = "active"
    trust_score: float = 0.5
    usage_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    created_at: str = field(default_factory=utc_now)
    metadata: Dict[str, object] = field(default_factory=dict)

    @property
    def success_rate(self) -> float:
        total = self.success_count + self.failure_count
        return self.success_count / total if total else 0.0


@dataclass
class CognitiveEdge:
    from_node: str
    to_node: str
    weight: float = 0.5
    plasticity: float = 0.5
    trust_score: float = 0.5
    success_count: int = 0
    failure_count: int = 0
    token_cost: float = 1.0
    latency_ms: float = 1.0
    risk_score: float = 1.0
    decay_rate: float = 0.01
    last_used: str = field(default_factory=utc_now)
    metadata: Dict[str, object] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.from_node}->{self.to_node}"

    @property
    def success_rate(self) -> float:
        total = self.success_count + self.failure_count
        return self.success_count / total if total else 0.0

    def clamp(self, min_weight: float = 0.0, max_weight: float = 1.0) -> None:
        self.weight = max(min_weight, min(max_weight, self.weight))
        self.trust_score = max(0.0, min(1.0, self.trust_score))
        self.plasticity = max(0.0, min(1.0, self.plasticity))


class CognitiveGraph:
    """Inspectable, mutable cognitive graph."""

    def __init__(self) -> None:
        self.nodes: Dict[str, CognitiveNode] = {}
        self.edges: Dict[Tuple[str, str], CognitiveEdge] = {}

    def add_node(self, node: CognitiveNode) -> None:
        if node.id in self.nodes:
            raise ValueError(f"Node already exists: {node.id}")
        self.nodes[node.id] = node

    def add_edge(self, edge: CognitiveEdge) -> None:
        if edge.from_node not in self.nodes:
            raise ValueError(f"Missing from_node: {edge.from_node}")
        if edge.to_node not in self.nodes:
            raise ValueError(f"Missing to_node: {edge.to_node}")
        key = (edge.from_node, edge.to_node)
        if key in self.edges:
            raise ValueError(f"Edge already exists: {edge.id}")
        edge.clamp()
        self.edges[key] = edge

    def get_edge(self, from_node: str, to_node: str) -> Optional[CognitiveEdge]:
        return self.edges.get((from_node, to_node))

    def remove_edge(self, from_node: str, to_node: str) -> None:
        self.edges.pop((from_node, to_node), None)

    def remove_node(self, node_id: str) -> None:
        if node_id not in self.nodes:
            return
        del self.nodes[node_id]
        for key in list(self.edges):
            if node_id in key:
                del self.edges[key]

    def outgoing(self, node_id: str) -> List[CognitiveEdge]:
        return [edge for (src, _), edge in self.edges.items() if src == node_id]

    def incoming(self, node_id: str) -> List[CognitiveEdge]:
        return [edge for (_, dst), edge in self.edges.items() if dst == node_id]

    def route_candidates(self, start_nodes: Iterable[str]) -> List[CognitiveEdge]:
        candidates: List[CognitiveEdge] = []
        for node in start_nodes:
            candidates.extend(self.outgoing(node))
        return sorted(candidates, key=lambda e: e.weight * e.trust_score, reverse=True)

    def to_dict(self) -> Dict[str, object]:
        return {
            "nodes": {node_id: asdict(node) for node_id, node in self.nodes.items()},
            "edges": {edge.id: asdict(edge) for edge in self.edges.values()},
        }

    @staticmethod
    def from_dict(data: Dict[str, object]) -> "CognitiveGraph":
        graph = CognitiveGraph()
        nodes = data.get("nodes", {})
        for node_data in nodes.values():
            graph.add_node(CognitiveNode(**node_data))
        edges = data.get("edges", {})
        for edge_data in edges.values():
            graph.add_edge(CognitiveEdge(**edge_data))
        return graph
