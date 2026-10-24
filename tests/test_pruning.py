from verdigraph import AgentGenome, DevelopmentalAgent
from verdigraph.evaluation import EvaluationResult


def test_failure_weakens_edge():
    genome = AgentGenome(
        agent_name="Test Agent",
        purpose="Test pruning.",
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
    )
    agent = DevelopmentalAgent(genome)
    edge = agent.graph.get_edge("planner", "tool_router")
    old_weight = edge.weight
    result = EvaluationResult(
        task_id="f1",
        task_type="bad_task",
        success_score=0.1,
        safety_score=0.9,
        used_edges=[("planner", "tool_router")],
        used_nodes=["planner", "tool_router"],
    )
    agent.process_evaluation(result)
    assert agent.graph.get_edge("planner", "tool_router").weight < old_weight
    assert any(event.event_type == "edge_weakened" for event in agent.ledger.events)


# --- Invariant 5/6: pruning must not cut routes into or out of protected nodes ---

from verdigraph.genome import SafetyAxioms  # noqa: E402


def _agent(**axioms):
    genome = AgentGenome(
        agent_name="Prune Test Agent",
        purpose="Exercise edge and node pruning.",
        # Default chain: planner -> tool_router -> safety_checker -> evaluation_engine -> ledger
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
        safety_axioms=SafetyAxioms(**axioms),
    )
    return DevelopmentalAgent(genome)


def _make_prunable(agent, from_node, to_node):
    rules = agent.genome.growth_rules
    edge = agent.graph.get_edge(from_node, to_node)
    edge.weight = rules.prune_below_weight / 2
    edge.success_count = 0
    edge.failure_count = rules.min_events_before_pruning


def test_prune_low_value_edges_removes_a_weak_unprotected_edge():
    agent = _agent()
    _make_prunable(agent, "planner", "tool_router")
    agent.pruning.prune_low_value_edges()
    assert agent.graph.get_edge("planner", "tool_router") is None
    pruned = [e.payload["edge"] for e in agent.ledger.events if e.event_type == "edge_pruned"]
    assert pruned == ["planner->tool_router"]


def test_prune_low_value_edges_never_cuts_an_edge_touching_a_protected_node():
    agent = _agent()
    _make_prunable(agent, "tool_router", "safety_checker")  # into a protected node
    _make_prunable(agent, "safety_checker", "evaluation_engine")  # between protected nodes
    agent.pruning.prune_low_value_edges()
    agent.pruning.prune_low_value_edges()  # a second pass must not re-log the refusal
    assert agent.graph.get_edge("tool_router", "safety_checker") is not None
    assert agent.graph.get_edge("safety_checker", "evaluation_engine") is not None
    blocked = {e.payload["edge"]: e.payload["protected_nodes"] for e in agent.ledger.events if e.event_type == "edge_prune_blocked"}
    assert blocked == {
        "tool_router->safety_checker": ["safety_checker"],
        "safety_checker->evaluation_engine": ["safety_checker", "evaluation_engine"],
    }
    assert sum(e.event_type == "edge_prune_blocked" for e in agent.ledger.events) == 2


def test_repeated_failures_cannot_isolate_the_safety_checker():
    agent = _agent()
    for i in range(30):
        agent.process_evaluation(
            EvaluationResult(
                task_id=f"f{i}",
                task_type="risky",
                success_score=0.0,
                safety_score=0.5,
                used_edges=[("planner", "tool_router"), ("tool_router", "safety_checker")],
                used_nodes=[],
            )
        )
    assert agent.graph.get_edge("planner", "tool_router") is None  # unprotected: pruned
    assert agent.graph.incoming("safety_checker")  # protected: still reachable
    assert any(e.event_type == "edge_prune_blocked" for e in agent.ledger.events)


def test_protected_edges_are_prunable_only_when_the_axiom_is_disabled():
    agent = _agent(disallow_pruning_protected_nodes=False)
    _make_prunable(agent, "tool_router", "safety_checker")
    agent.pruning.prune_low_value_edges()
    assert agent.graph.get_edge("tool_router", "safety_checker") is None


def test_prune_inactive_nodes_archives_only_unprotected_isolated_nodes():
    agent = _agent()
    for key in list(agent.graph.edges):
        agent.graph.remove_edge(*key)
    agent.pruning.prune_inactive_nodes()
    archived = {node_id for node_id, node in agent.graph.nodes.items() if node.status == "archived"}
    assert archived == {"planner", "tool_router"}
    archived_events = {e.payload["node"] for e in agent.ledger.events if e.event_type == "node_archived"}
    assert archived_events == {"planner", "tool_router"}
