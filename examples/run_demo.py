from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from verdigraph import DevelopmentalAgent
from verdigraph.evaluation import EvaluationResult
from verdigraph.io import load_genome

def main() -> None:
    genome = load_genome(ROOT / "hypothetical_research_agent.genome.json")
    agent = DevelopmentalAgent(genome)

    synthetic_tasks = [
        ("t001", "literature_review", 0.72),
        ("t002", "literature_review", 0.81),
        ("t003", "literature_review", 0.86),
        ("t004", "citation_audit", 0.38),
        ("t005", "citation_audit", 0.55),
        ("t006", "literature_review", 0.91),
    ]

    used_edges = [
        ("intent_classifier", "planner"),
        ("planner", "search_module"),
        ("search_module", "synthesis_module"),
        ("synthesis_module", "citation_checker"),
        ("citation_checker", "safety_checker"),
    ]
    used_nodes = [
        "intent_classifier",
        "planner",
        "search_module",
        "synthesis_module",
        "citation_checker",
        "safety_checker",
    ]

    for task_id, task_type, score in synthetic_tasks:
        result = EvaluationResult(
            task_id=task_id,
            task_type=task_type,
            success_score=score,
            accuracy=score,
            user_satisfaction=score,
            cost_efficiency=0.78,
            safety_score=1.0,
            used_edges=used_edges,
            used_nodes=used_nodes,
            notes="Synthetic demo task.",
        )
        agent.process_evaluation(result)

    output_path = ROOT / "output" / "evolved_research_agent_state.json"
    agent.save_state(output_path)
    print(f"Saved evolved agent state to: {output_path}")
    print("Top next steps from planner:")
    for step in agent.best_next_steps("planner"):
        print(f"  {step.from_node} -> {step.to_node}: score={step.score:.4f}")


if __name__ == "__main__":
    main()
