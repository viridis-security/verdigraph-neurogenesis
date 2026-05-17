"""Full save/load round-trip for an evolved agent.

`save_state` -> `load_state` must reconstruct the genome (including
growth_rules + safety_axioms), the graph (nodes + edges + statistics),
and the developmental ledger. Without this, MCP `load_agent_state`
would silently rebuild agents with default rules.
"""

from pathlib import Path

from axiomgraph import AgentGenome, DevelopmentalAgent
from axiomgraph.evaluation import EvaluationResult
from axiomgraph.genome import GrowthRules, SafetyAxioms


def _evolved_agent() -> DevelopmentalAgent:
    genome = AgentGenome(
        agent_name="Roundtrip Agent",
        purpose="Verify state round-trip integrity.",
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success", "safety_score"],
        growth_rules=GrowthRules(
            create_node_when_task_repeats=2,
            strengthen_edge_on_success=0.11,
            weaken_edge_on_failure=0.07,
            prune_below_weight=0.18,
            max_nodes=42,
            max_edges=128,
        ),
        safety_axioms=SafetyAxioms(
            protected_nodes=["safety_checker", "evaluation_engine", "ledger"],
            custom={"require_sources": True},
        ),
        metadata={"version": "0.1.0", "domain": "test"},
    )
    agent = DevelopmentalAgent(genome)
    for i in range(3):
        agent.process_evaluation(
            EvaluationResult(
                task_id=f"t{i}",
                task_type="recurring",
                success_score=0.85,
                safety_score=1.0,
                used_edges=[("planner", "tool_router")],
                used_nodes=["planner", "tool_router"],
            )
        )
    return agent


def test_save_state_load_state_preserves_genome_graph_and_ledger(tmp_path: Path) -> None:
    original = _evolved_agent()
    state_path = tmp_path / "agent.json"
    original.save_state(state_path)

    restored = DevelopmentalAgent.load_state(state_path)

    # Genome — including the parts that were dropped before this fix.
    assert restored.genome.agent_name == original.genome.agent_name
    assert restored.genome.purpose == original.genome.purpose
    assert restored.genome.initial_nodes == original.genome.initial_nodes
    assert restored.genome.fitness_metrics == original.genome.fitness_metrics
    assert restored.genome.growth_rules == original.genome.growth_rules
    assert restored.genome.safety_axioms == original.genome.safety_axioms
    assert restored.genome.metadata == original.genome.metadata

    # Graph — topology and learned statistics.
    assert set(restored.graph.nodes) == set(original.graph.nodes)
    assert set(restored.graph.edges) == set(original.graph.edges)
    orig_edge = original.graph.get_edge("planner", "tool_router")
    rest_edge = restored.graph.get_edge("planner", "tool_router")
    assert orig_edge is not None and rest_edge is not None
    assert rest_edge.weight == orig_edge.weight
    assert rest_edge.success_count == orig_edge.success_count
    assert rest_edge.trust_score == orig_edge.trust_score

    # Ledger.
    assert len(restored.ledger.events) == len(original.ledger.events)
    assert [e.event_type for e in restored.ledger.events] == [e.event_type for e in original.ledger.events]


def test_restored_agent_continues_evolving(tmp_path: Path) -> None:
    """Engines must rebind to the restored graph; further evaluations apply correctly."""
    original = _evolved_agent()
    state_path = tmp_path / "agent.json"
    original.save_state(state_path)

    restored = DevelopmentalAgent.load_state(state_path)
    edge_before = restored.graph.get_edge("planner", "tool_router")
    weight_before = edge_before.weight

    restored.process_evaluation(
        EvaluationResult(
            task_id="post_load",
            task_type="recurring",
            success_score=0.95,
            safety_score=1.0,
            used_edges=[("planner", "tool_router")],
            used_nodes=["planner", "tool_router"],
        )
    )

    assert restored.graph.get_edge("planner", "tool_router").weight > weight_before
