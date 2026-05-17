"""Invariant-violation tests.

These pin the contract in `_enforce_invariants`: silent corruption of the
graph (hidden nodes, removed protected nodes, exceeded bounds) must raise,
not pass quietly.
"""

import pytest

from verdigraph import AgentGenome, DevelopmentalAgent
from verdigraph.evaluation import EvaluationResult
from verdigraph.genome import GrowthRules


def _genome(**overrides) -> AgentGenome:
    defaults = dict(
        agent_name="Invariant Test Agent",
        purpose="Verify safety invariants.",
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
    )
    defaults.update(overrides)
    return AgentGenome(**defaults)


def test_removing_protected_node_raises():
    agent = DevelopmentalAgent(_genome())
    # safety_checker is in the genome's default protected_nodes.
    agent.graph.remove_node("safety_checker")
    result = EvaluationResult(
        task_id="t",
        task_type="general",
        success_score=0.8,
        safety_score=1.0,
        used_edges=[],
        used_nodes=[],
    )
    with pytest.raises(RuntimeError, match="protected node removed"):
        agent.process_evaluation(result)


def test_missing_description_raises():
    agent = DevelopmentalAgent(_genome())
    # Inject a hidden (descriptionless) node — disallowed by safety axioms.
    agent.graph.nodes["planner"].description = ""
    result = EvaluationResult(
        task_id="t",
        task_type="general",
        success_score=0.8,
        safety_score=1.0,
        used_edges=[],
        used_nodes=[],
    )
    with pytest.raises(RuntimeError, match="node missing description"):
        agent.process_evaluation(result)


def test_max_nodes_growth_blocked_and_logged():
    """Growth must respect max_nodes; over-growth must be logged, not raise."""
    rules = GrowthRules(max_nodes=5, create_node_when_task_repeats=1)
    agent = DevelopmentalAgent(_genome(growth_rules=rules))
    # Already 5 initial nodes — any new specialist must be refused.
    for i in range(2):
        agent.process_evaluation(
            EvaluationResult(
                task_id=f"t{i}",
                task_type="recurring",
                success_score=0.9,
                safety_score=1.0,
                used_edges=[],
                used_nodes=[],
            )
        )
    assert len(agent.graph.nodes) == 5
    assert any(e.event_type == "growth_blocked" for e in agent.ledger.events)
