from __future__ import annotations

from collections import Counter
from typing import Iterable

from .evaluation import EvaluationResult
from .genome import AgentGenome
from .graph import CognitiveEdge, CognitiveGraph, CognitiveNode, utc_now
from .ledger import DevelopmentalLedger


class GrowthEngine:
    """Applies bounded graph growth and edge reinforcement."""

    def __init__(self, genome: AgentGenome, graph: CognitiveGraph, ledger: DevelopmentalLedger) -> None:
        self.genome = genome
        self.graph = graph
        self.ledger = ledger
        self.task_counts: Counter[str] = Counter()

    def reinforce_from_evaluation(self, result: EvaluationResult) -> None:
        rules = self.genome.growth_rules
        if not result.is_success:
            return
        for from_node, to_node in result.used_edges:
            edge = self.graph.get_edge(from_node, to_node)
            if not edge:
                continue
            old_weight = edge.weight
            edge.success_count += 1
            edge.last_used = utc_now()
            edge.weight += rules.strengthen_edge_on_success * result.success_score * edge.plasticity
            edge.trust_score += 0.03 * result.safety_score
            edge.clamp(rules.min_weight, rules.max_weight)
            self.ledger.record(
                "edge_strengthened",
                "Pathway contributed to successful task outcome.",
                edge=edge.id,
                old_weight=old_weight,
                new_weight=edge.weight,
                task_id=result.task_id,
            )
        for node_id in result.used_nodes:
            if node_id in self.graph.nodes:
                node = self.graph.nodes[node_id]
                node.usage_count += 1
                node.success_count += 1
                node.trust_score = min(1.0, node.trust_score + 0.02)

    def maybe_grow_for_task_type(self, task_type: str) -> None:
        self.task_counts[task_type] += 1
        rules = self.genome.growth_rules
        if self.task_counts[task_type] < rules.create_node_when_task_repeats:
            return
        proposed_id = f"{task_type}_specialist"
        if proposed_id in self.graph.nodes:
            return
        if len(self.graph.nodes) >= rules.max_nodes:
            self.ledger.record("growth_blocked", "Maximum node count reached.", proposed_node=proposed_id)
            return
        self.create_node(
            node_id=proposed_id,
            node_type="specialist",
            description=f"Specialized module grown after repeated task type: {task_type}",
            connect_from=self._hub_nodes(),
        )

    def create_node(self, node_id: str, node_type: str, description: str, connect_from: Iterable[str]) -> None:
        if self.genome.safety_axioms.require_purpose_for_new_nodes and not description.strip():
            raise ValueError("New nodes require a purpose/description")
        if len(self.graph.nodes) >= self.genome.growth_rules.max_nodes:
            return
        self.graph.add_node(CognitiveNode(id=node_id, type=node_type, description=description, trust_score=0.55))
        created_edges = []
        for src in connect_from:
            if src in self.graph.nodes and len(self.graph.edges) < self.genome.growth_rules.max_edges:
                edge = CognitiveEdge(from_node=src, to_node=node_id, weight=0.35, trust_score=0.55, plasticity=0.7)
                self.graph.add_edge(edge)
                created_edges.append(edge.id)
        self.ledger.record(
            "node_created",
            "Growth engine created a bounded, inspectable cognitive node.",
            node=node_id,
            node_type=node_type,
            description=description,
            created_edges=created_edges,
        )

    def _hub_nodes(self) -> list[str]:
        preferred = ["planner", "tool_router", "memory", "evaluation_engine"]
        hubs = [node for node in preferred if node in self.graph.nodes]
        return hubs or list(self.graph.nodes)[:2]
