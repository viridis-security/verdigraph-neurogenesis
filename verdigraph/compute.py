from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from .graph import CognitiveEdge, CognitiveGraph, utc_now
from .routing import Router


@dataclass(frozen=True)
class ComputeProfile:
    """Estimated cost and capability profile for a model, tool, or execution backend.

    A profile can represent a local GPU model, a cloud transformer API, an embedding model,
    a rules engine, a cached workflow, or any other callable cognitive resource.
    """

    id: str
    kind: str = "model"
    quality_score: float = 0.5
    cost_per_1k_input_tokens: float = 0.0
    cost_per_1k_output_tokens: float = 0.0
    latency_ms: float = 1000.0
    gpu_memory_gb: float = 0.0
    max_context_tokens: int = 4096
    local: bool = False
    metadata: Dict[str, object] = field(default_factory=dict)

    def estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        return (
            (input_tokens / 1000.0) * self.cost_per_1k_input_tokens
            + (output_tokens / 1000.0) * self.cost_per_1k_output_tokens
        )


@dataclass(frozen=True)
class TaskProfile:
    """Estimated task requirements used for compute-aware routing."""

    id: str
    task_type: str
    difficulty: float = 0.5
    risk: float = 0.5
    expected_input_tokens: int = 1000
    expected_output_tokens: int = 500
    min_quality: float = 0.5
    requires_local: bool = False
    metadata: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ComputeDecision:
    """A compute routing decision with auditable reasoning."""

    profile_id: str
    score: float
    estimated_cost: float
    estimated_latency_ms: float
    estimated_gpu_memory_gb: float
    reason: str


@dataclass
class EfficiencyReport:
    """Aggregated efficiency metrics for a run or experiment."""

    task_success: float
    total_estimated_cost: float
    total_latency_ms: float
    total_gpu_memory_gb: float
    model_calls: int
    cache_hits: int = 0
    tool_calls: int = 0

    @property
    def cognitive_efficiency(self) -> float:
        denominator = max(1e-9, self.total_estimated_cost + (self.total_latency_ms / 1000.0) * 0.001)
        return self.task_success / denominator


class ComputeOptimizer:
    """Compute-aware routing layer for Verdigraph.

    This class does not optimize transformer kernels directly. Instead, it optimizes
    agent-level compute by choosing the cheapest reliable execution path: cache,
    rule, local model, small cloud model, large cloud model, or high-assurance evaluator.
    """

    def __init__(self, profiles: Iterable[ComputeProfile]) -> None:
        self.profiles: Dict[str, ComputeProfile] = {profile.id: profile for profile in profiles}
        self.decisions: List[Dict[str, object]] = []

    def choose_profile(self, task: TaskProfile) -> ComputeDecision:
        if not self.profiles:
            raise ValueError("At least one ComputeProfile is required.")

        candidates: List[ComputeDecision] = []
        for profile in self.profiles.values():
            if task.requires_local and not profile.local:
                continue
            if profile.max_context_tokens < task.expected_input_tokens + task.expected_output_tokens:
                continue
            # Hard contract: a profile that does not meet the task's minimum quality
            # bar is ineligible, regardless of cost. This preserves the invariant that
            # compute savings never silently regress task quality below the requested floor.
            if profile.quality_score < task.min_quality:
                continue

            quality_margin = profile.quality_score - task.min_quality
            risk_penalty = max(0.0, task.risk - profile.quality_score) * 2.0
            difficulty_penalty = max(0.0, task.difficulty - profile.quality_score)
            estimated_cost = profile.estimate_cost(task.expected_input_tokens, task.expected_output_tokens)
            normalized_cost = estimated_cost + (profile.latency_ms / 1000.0) * 0.001 + profile.gpu_memory_gb * 0.0005

            # Higher is better: reliable quality per unit cost, with risk/difficulty penalties.
            score = (profile.quality_score + max(0.0, quality_margin)) / max(1e-9, normalized_cost + 0.01)
            score -= risk_penalty + difficulty_penalty

            reason = (
                f"selected candidate kind={profile.kind}, quality={profile.quality_score:.2f}, "
                f"cost={estimated_cost:.6f}, latency_ms={profile.latency_ms:.0f}, "
                f"gpu_memory_gb={profile.gpu_memory_gb:.2f}"
            )
            candidates.append(
                ComputeDecision(
                    profile_id=profile.id,
                    score=score,
                    estimated_cost=estimated_cost,
                    estimated_latency_ms=profile.latency_ms,
                    estimated_gpu_memory_gb=profile.gpu_memory_gb,
                    reason=reason,
                )
            )

        if not candidates:
            raise ValueError(
                f"No compute profile satisfies the task constraints for task '{task.id}' "
                f"(task_type={task.task_type}, requires_local={task.requires_local}, "
                f"min_quality={task.min_quality}, "
                f"context_required={task.expected_input_tokens + task.expected_output_tokens})."
            )

        decision = max(candidates, key=lambda item: item.score)
        self.decisions.append({
            "timestamp": utc_now(),
            "task_id": task.id,
            "task_type": task.task_type,
            "profile_id": decision.profile_id,
            "score": decision.score,
            "estimated_cost": decision.estimated_cost,
            "estimated_latency_ms": decision.estimated_latency_ms,
        })
        return decision

    @staticmethod
    def route_compute_efficiency(edge: CognitiveEdge, task_relevance: float = 1.0) -> float:
        """Score a cognitive edge by expected task success per compute cost."""
        success = edge.weight * edge.trust_score * max(0.01, edge.success_rate or 0.5) * task_relevance
        compute_cost = max(1e-9, edge.token_cost + (edge.latency_ms / 1000.0) + edge.risk_score)
        return success / compute_cost

    def best_compute_edges(self, graph: CognitiveGraph, from_node: str, limit: int = 3) -> List[CognitiveEdge]:
        edges = graph.outgoing(from_node)
        return sorted(edges, key=self.route_compute_efficiency, reverse=True)[:limit]

    @staticmethod
    def should_use_cache(cache_confidence: float, task_risk: float, threshold: float = 0.88) -> bool:
        """Return True when cached reasoning is likely safe and efficient."""
        if task_risk >= 0.75:
            return False
        return cache_confidence >= threshold

    @staticmethod
    def should_escalate(current_confidence: float, task_risk: float, min_confidence: float = 0.78) -> bool:
        """Return True when the route should escalate to a stronger model/evaluator."""
        required = min_confidence + max(0.0, task_risk - 0.5) * 0.25
        return current_confidence < required
