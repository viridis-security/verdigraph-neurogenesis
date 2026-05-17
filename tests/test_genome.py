import pytest

from verdigraph.genome import AgentGenome, GrowthRules


def test_valid_genome_passes_validation():
    genome = AgentGenome(
        agent_name="Test Agent",
        purpose="Test developmental graph logic.",
        initial_nodes=["planner", "safety_checker", "evaluation_engine", "ledger"],
        fitness_metrics=["task_success"],
    )
    genome.validate()


def test_duplicate_nodes_rejected():
    genome = AgentGenome(
        agent_name="Test Agent",
        purpose="Test.",
        initial_nodes=["planner", "planner"],
        fitness_metrics=["task_success"],
    )
    with pytest.raises(ValueError):
        genome.validate()


def test_invalid_growth_rules_rejected():
    rules = GrowthRules(strengthen_edge_on_success=1.5)
    with pytest.raises(ValueError):
        rules.validate()
