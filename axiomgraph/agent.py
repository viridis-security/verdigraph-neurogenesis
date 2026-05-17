from __future__ import annotations

import json
from pathlib import Path
from .evaluation import EvaluationResult
from .genome import AgentGenome
from .graph import CognitiveEdge, CognitiveGraph, CognitiveNode
from .growth import GrowthEngine
from .ledger import DevelopmentalLedger
from .pruning import PruningEngine
from .routing import Router


class DevelopmentalAgent:
    """Coordinates genome, graph, evaluation, growth, pruning, and ledger."""

    def __init__(self, genome: AgentGenome) -> None:
        genome.validate()
        self.genome = genome
        self.graph = self._build_initial_graph(genome)
        self.ledger = DevelopmentalLedger()
        self.growth = GrowthEngine(genome, self.graph, self.ledger)
        self.pruning = PruningEngine(genome, self.graph, self.ledger)
        self.router = Router(self.graph)
        self.ledger.record("agent_initialized", "Agent created from digital genome.", agent_name=genome.agent_name)

    @staticmethod
    def _build_initial_graph(genome: AgentGenome) -> CognitiveGraph:
        graph = CognitiveGraph()
        for node_id in genome.initial_nodes:
            graph.add_node(CognitiveNode(id=node_id, description=f"Initial genome node: {node_id}", trust_score=0.6))
        # Create a simple default chain for inspectable routing.
        for src, dst in zip(genome.initial_nodes, genome.initial_nodes[1:]):
            graph.add_edge(CognitiveEdge(from_node=src, to_node=dst, weight=0.5, trust_score=0.6, plasticity=0.5))
        return graph

    def process_evaluation(self, result: EvaluationResult) -> None:
        self.growth.maybe_grow_for_task_type(result.task_type)
        self.growth.reinforce_from_evaluation(result)
        self.pruning.weaken_from_evaluation(result)
        self.pruning.prune_low_value_edges()
        self._enforce_invariants()

    def best_next_steps(self, from_node: str, limit: int = 3):
        return self.router.best_next_steps(from_node, limit=limit)

    def _enforce_invariants(self) -> None:
        if self.genome.safety_axioms.disallow_hidden_nodes:
            for node_id, node in self.graph.nodes.items():
                if not node.description:
                    raise RuntimeError(f"Invariant violation: node missing description: {node_id}")
        if len(self.graph.nodes) > self.genome.growth_rules.max_nodes:
            raise RuntimeError("Invariant violation: max_nodes exceeded")
        if len(self.graph.edges) > self.genome.growth_rules.max_edges:
            raise RuntimeError("Invariant violation: max_edges exceeded")
        for protected in self.genome.safety_axioms.protected_nodes:
            if protected in self.genome.initial_nodes and protected not in self.graph.nodes:
                raise RuntimeError(f"Invariant violation: protected node removed: {protected}")

    def to_dict(self) -> dict:
        return {
            "genome": {
                "agent_name": self.genome.agent_name,
                "purpose": self.genome.purpose,
                "initial_nodes": self.genome.initial_nodes,
                "fitness_metrics": self.genome.fitness_metrics,
                "metadata": self.genome.metadata,
            },
            "graph": self.graph.to_dict(),
            "ledger": self.ledger.to_list(),
        }

    def save_state(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
