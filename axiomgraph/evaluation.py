from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass(frozen=True)
class EvaluationResult:
    """Outcome signal used as selective pressure for growth/pruning."""

    task_id: str
    task_type: str
    success_score: float
    accuracy: float = 0.0
    user_satisfaction: float = 0.0
    cost_efficiency: float = 0.0
    safety_score: float = 1.0
    notes: str = ""
    used_edges: List[tuple[str, str]] = field(default_factory=list)
    used_nodes: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        for name in ("success_score", "accuracy", "user_satisfaction", "cost_efficiency", "safety_score"):
            value = getattr(self, name)
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be in [0, 1]")

    @property
    def is_success(self) -> bool:
        return self.success_score >= 0.65 and self.safety_score >= 0.8

    @property
    def is_failure(self) -> bool:
        return self.success_score < 0.4 or self.safety_score < 0.6


class SimpleEvaluator:
    """Deterministic evaluator for demos/tests.

    A real implementation can replace this with task-specific tests, human feedback,
    LLM-as-judge with guardrails, or benchmark scoring.
    """

    def evaluate(self, task_id: str, task_type: str, score: float, used_edges: List[tuple[str, str]], used_nodes: List[str]) -> EvaluationResult:
        return EvaluationResult(
            task_id=task_id,
            task_type=task_type,
            success_score=score,
            accuracy=score,
            user_satisfaction=score,
            cost_efficiency=max(0.0, 1.0 - len(used_nodes) * 0.05),
            safety_score=1.0,
            used_edges=used_edges,
            used_nodes=used_nodes,
            notes="Synthetic demo evaluation.",
        )
