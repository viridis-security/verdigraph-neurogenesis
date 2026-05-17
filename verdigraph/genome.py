from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass(frozen=True)
class GrowthRules:
    """Rules that bound graph development."""

    create_node_when_task_repeats: int = 5
    strengthen_edge_on_success: float = 0.08
    weaken_edge_on_failure: float = 0.05
    prune_below_weight: float = 0.12
    max_nodes: int = 128
    max_edges: int = 512
    min_events_before_pruning: int = 3
    max_weight: float = 1.0
    min_weight: float = 0.0

    def validate(self) -> None:
        if self.create_node_when_task_repeats < 1:
            raise ValueError("create_node_when_task_repeats must be >= 1")
        if not 0 <= self.strengthen_edge_on_success <= 1:
            raise ValueError("strengthen_edge_on_success must be in [0, 1]")
        if not 0 <= self.weaken_edge_on_failure <= 1:
            raise ValueError("weaken_edge_on_failure must be in [0, 1]")
        if not 0 <= self.prune_below_weight <= 1:
            raise ValueError("prune_below_weight must be in [0, 1]")
        if self.max_nodes < 1:
            raise ValueError("max_nodes must be >= 1")
        if self.max_edges < 0:
            raise ValueError("max_edges must be >= 0")
        if not 0 <= self.min_weight <= self.max_weight <= 1:
            raise ValueError("weight bounds must satisfy 0 <= min <= max <= 1")


@dataclass(frozen=True)
class SafetyAxioms:
    """Non-plastic constraints that growth and pruning cannot violate."""

    protected_nodes: List[str] = field(default_factory=lambda: ["safety_checker", "evaluation_engine", "ledger"])
    require_growth_logging: bool = True
    require_pruning_logging: bool = True
    disallow_hidden_nodes: bool = True
    disallow_pruning_protected_nodes: bool = True
    require_purpose_for_new_nodes: bool = True
    custom: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentGenome:
    """Initial architecture and developmental bounds for an agent."""

    agent_name: str
    purpose: str
    initial_nodes: List[str]
    fitness_metrics: List[str]
    growth_rules: GrowthRules = field(default_factory=GrowthRules)
    safety_axioms: SafetyAxioms = field(default_factory=SafetyAxioms)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.agent_name.strip():
            raise ValueError("agent_name is required")
        if not self.purpose.strip():
            raise ValueError("purpose is required")
        if len(set(self.initial_nodes)) != len(self.initial_nodes):
            raise ValueError("initial_nodes must be unique")
        if not self.initial_nodes:
            raise ValueError("at least one initial node is required")
        if not self.fitness_metrics:
            raise ValueError("at least one fitness metric is required")
        self.growth_rules.validate()

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "AgentGenome":
        growth = GrowthRules(**data.get("growth_rules", {}))
        safety = SafetyAxioms(**data.get("safety_axioms", {}))
        genome = AgentGenome(
            agent_name=data["agent_name"],
            purpose=data["purpose"],
            initial_nodes=list(data["initial_nodes"]),
            fitness_metrics=list(data["fitness_metrics"]),
            growth_rules=growth,
            safety_axioms=safety,
            metadata=dict(data.get("metadata", {})),
        )
        genome.validate()
        return genome
