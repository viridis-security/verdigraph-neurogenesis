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
