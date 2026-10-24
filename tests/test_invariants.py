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


# --- Invariant 2: every structural mutation is logged (checked post-condition) ---

from verdigraph.genome import SafetyAxioms  # noqa: E402
from verdigraph.graph import CognitiveNode  # noqa: E402


def _evaluation(**overrides) -> EvaluationResult:
    fields = dict(task_id="t", task_type="general", success_score=0.8, safety_score=1.0, used_edges=[], used_nodes=[])
    fields.update(overrides)
    return EvaluationResult(**fields)


def test_unlogged_edge_mutation_during_growth_raises():
    agent = DevelopmentalAgent(_genome())

    def reinforce_without_logging(result):
        agent.graph.get_edge("planner", "tool_router").weight = 0.99

    agent.growth.reinforce_from_evaluation = reinforce_without_logging
    with pytest.raises(RuntimeError, match="unlogged growth mutation: planner->tool_router"):
        agent.process_evaluation(_evaluation())


def test_unlogged_node_creation_raises():
    agent = DevelopmentalAgent(_genome())
    agent.growth.maybe_grow_for_task_type = lambda task_type: agent.graph.add_node(
        CognitiveNode(id="ghost", description="added without a ledger entry")
    )
    with pytest.raises(RuntimeError, match="unlogged growth mutation: ghost"):
        agent.process_evaluation(_evaluation())


def test_unlogged_edge_removal_during_pruning_raises():
    agent = DevelopmentalAgent(_genome())
    agent.pruning.prune_low_value_edges = lambda: agent.graph.remove_edge("planner", "tool_router")
    with pytest.raises(RuntimeError, match="unlogged pruning mutation: planner->tool_router"):
        agent.process_evaluation(_evaluation())


def test_logging_check_follows_the_safety_axiom():
    agent = DevelopmentalAgent(_genome(safety_axioms=SafetyAxioms(require_growth_logging=False)))

    def reinforce_without_logging(result):
        agent.graph.get_edge("planner", "tool_router").weight = 0.99

    agent.growth.reinforce_from_evaluation = reinforce_without_logging
    agent.process_evaluation(_evaluation())  # the axiom is off, so no raise
    assert agent.graph.get_edge("planner", "tool_router").weight == 0.99


def test_normal_logged_evolution_passes_the_check():
    agent = DevelopmentalAgent(_genome())
    for i in range(6):  # enough repeats to grow a specialist node with new edges
        agent.process_evaluation(_evaluation(task_id=f"t{i}", task_type="recurring", used_edges=[("planner", "tool_router")], used_nodes=["planner"]))
    kinds = {e.event_type for e in agent.ledger.events}
    assert {"edge_strengthened", "node_created"} <= kinds
    assert "recurring_specialist" in agent.graph.nodes
