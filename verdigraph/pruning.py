from __future__ import annotations

from .evaluation import EvaluationResult
from .genome import AgentGenome
from .graph import CognitiveGraph, utc_now
from .ledger import DevelopmentalLedger


class PruningEngine:
    """Weakens or removes ineffective pathways while preserving safety invariants."""

    def __init__(self, genome: AgentGenome, graph: CognitiveGraph, ledger: DevelopmentalLedger) -> None:
        self.genome = genome
        self.graph = graph
        self.ledger = ledger

    def weaken_from_evaluation(self, result: EvaluationResult) -> None:
        rules = self.genome.growth_rules
        if not result.is_failure:
            return
        for from_node, to_node in result.used_edges:
            edge = self.graph.get_edge(from_node, to_node)
            if not edge:
                continue
            old_weight = edge.weight
            edge.failure_count += 1
            edge.last_used = utc_now()
            risk_multiplier = 1.0 + (1.0 - result.safety_score)
            edge.weight -= rules.weaken_edge_on_failure * (1.0 - result.success_score) * risk_multiplier
            edge.trust_score -= 0.05 * risk_multiplier
            edge.clamp(rules.min_weight, rules.max_weight)
            self.ledger.record(
                "edge_weakened",
                "Pathway contributed to failed or low-safety outcome.",
                edge=edge.id,
                old_weight=old_weight,
                new_weight=edge.weight,
                task_id=result.task_id,
            )

    def prune_low_value_edges(self) -> None:
        rules = self.genome.growth_rules
        for key, edge in list(self.graph.edges.items()):
            observations = edge.success_count + edge.failure_count
            if observations < rules.min_events_before_pruning:
                continue
            if edge.weight < rules.prune_below_weight and edge.success_rate < 0.3:
                self.graph.remove_edge(*key)
                self.ledger.record(
                    "edge_pruned",
                    "Edge fell below weight and success thresholds.",
                    edge=edge.id,
                    weight=edge.weight,
                    success_rate=edge.success_rate,
                )

    def prune_inactive_nodes(self) -> None:
        protected = set(self.genome.safety_axioms.protected_nodes)
        for node_id, node in list(self.graph.nodes.items()):
            if node_id in protected and self.genome.safety_axioms.disallow_pruning_protected_nodes:
                continue
            if node.usage_count >= self.genome.growth_rules.min_events_before_pruning:
                continue
            if node.status != "active":
                continue
            # Conservative: archive instead of delete unless no edges remain.
            if not self.graph.incoming(node_id) and not self.graph.outgoing(node_id):
                node.status = "archived"
                self.ledger.record("node_archived", "Inactive isolated node archived.", node=node_id)
