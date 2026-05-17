from axiomgraph import AgentGenome, DevelopmentalAgent
from axiomgraph.evaluation import EvaluationResult


def test_success_strengthens_edge():
    genome = AgentGenome(
        agent_name="Test Agent",
        purpose="Test graph evolution.",
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
    )
    agent = DevelopmentalAgent(genome)
    edge = agent.graph.get_edge("planner", "tool_router")
    old_weight = edge.weight
    result = EvaluationResult(
        task_id="t1",
        task_type="general",
        success_score=0.9,
        safety_score=1.0,
        used_edges=[("planner", "tool_router")],
        used_nodes=["planner", "tool_router"],
    )
    agent.process_evaluation(result)
    assert agent.graph.get_edge("planner", "tool_router").weight > old_weight
    assert any(event.event_type == "edge_strengthened" for event in agent.ledger.events)


def test_repeated_task_grows_specialist():
    genome = AgentGenome(
        agent_name="Test Agent",
        purpose="Test graph growth.",
        initial_nodes=["planner", "tool_router", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
    )
    agent = DevelopmentalAgent(genome)
    for i in range(genome.growth_rules.create_node_when_task_repeats):
        result = EvaluationResult(
            task_id=f"t{i}",
            task_type="recurring_task",
            success_score=0.8,
            safety_score=1.0,
            used_edges=[("planner", "tool_router")],
            used_nodes=["planner", "tool_router"],
        )
        agent.process_evaluation(result)
    assert "recurring_task_specialist" in agent.graph.nodes
    assert any(event.event_type == "node_created" for event in agent.ledger.events)
