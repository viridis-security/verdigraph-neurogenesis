"""Verdigraph operating Verdigraph — the Viridis Operator agent.

This demo creates the Viridis Operator agent (the agent that runs the
Verdigraph project for Viridis LLC), wires up realistic compute profiles,
runs a synthetic sequence of project-operations tasks through it
(triage an issue, review a PR, plan a release, update docs), and
saves the evolved state to examples/output/.

The agent operates Verdigraph using Verdigraph itself — a working
dogfood demonstration of the framework.

Usage:
    pip install -e ".[mcp]"
    python examples/viridis_operator_demo.py

Real-world deployment uses the verdigraph-mcp server plus the
github-mcp server, both connected to Claude Desktop / Cowork / Claude
Code. See docs/OPERATOR_AGENT.md.
"""

from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))

from verdigraph import DevelopmentalAgent
from verdigraph.compute import ComputeOptimizer, ComputeProfile, TaskProfile
from verdigraph.evaluation import EvaluationResult
from verdigraph.io import load_genome


# ----- Compute profiles for the agent's routing layer -------------------------
# These represent the menu of execution backends the operator can route to.
# In production these are tuned to actual costs/latencies; the defaults here
# reflect plausible 2026 numbers.

COMPUTE_PROFILES = [
    ComputeProfile(
        id="cache_workflow",
        kind="cache",
        quality_score=0.70,
        latency_ms=40,
        gpu_memory_gb=0.0,
        max_context_tokens=4096,
        local=True,
    ),
    ComputeProfile(
        id="local_4b_router",
        kind="local_model",
        quality_score=0.74,
        latency_ms=300,
        gpu_memory_gb=3.0,
        max_context_tokens=8192,
        local=True,
    ),
    ComputeProfile(
        id="local_14b_reasoner",
        kind="local_model",
        quality_score=0.84,
        latency_ms=1200,
        gpu_memory_gb=12.0,
        max_context_tokens=16384,
        local=True,
    ),
    ComputeProfile(
        id="cloud_haiku",
        kind="api_model",
        quality_score=0.88,
        cost_per_1k_input_tokens=0.0008,
        cost_per_1k_output_tokens=0.004,
        latency_ms=900,
        max_context_tokens=200000,
        local=False,
    ),
    ComputeProfile(
        id="cloud_sonnet",
        kind="api_model",
        quality_score=0.94,
        cost_per_1k_input_tokens=0.003,
        cost_per_1k_output_tokens=0.015,
        latency_ms=1500,
        max_context_tokens=200000,
        local=False,
    ),
    ComputeProfile(
        id="cloud_opus_evaluator",
        kind="evaluator",
        quality_score=0.98,
        cost_per_1k_input_tokens=0.015,
        cost_per_1k_output_tokens=0.075,
        latency_ms=2800,
        max_context_tokens=200000,
        local=False,
    ),
]


# ----- Synthetic project-operations workload ----------------------------------
# Each entry is a realistic task the agent will route through its cognitive
# graph, plus the compute-routing decision it should make for the task type.

SYNTHETIC_WORKLOAD = [
    # (task_id, task_type, task_profile_for_compute, success_score, used_nodes)
    (
        "issue-001",
        "issue_triage",
        TaskProfile(id="t1", task_type="issue_triage", difficulty=0.25, risk=0.10, min_quality=0.70, expected_input_tokens=600, expected_output_tokens=200),
        0.91,
        ["intent_classifier", "issue_triage", "github_router", "ledger"],
    ),
    (
        "issue-002",
        "issue_triage",
        TaskProfile(id="t2", task_type="issue_triage", difficulty=0.20, risk=0.10, min_quality=0.70, expected_input_tokens=500, expected_output_tokens=150),
        0.88,
        ["intent_classifier", "issue_triage", "github_router", "ledger"],
    ),
    (
        "pr-014",
        "code_review",
        TaskProfile(id="t3", task_type="code_review", difficulty=0.65, risk=0.45, min_quality=0.85, expected_input_tokens=8000, expected_output_tokens=1500),
        0.76,
        ["intent_classifier", "code_review", "test_runner", "safety_checker", "evaluation_engine", "github_router", "ledger"],
    ),
    (
        "pr-015",
        "code_review",
        TaskProfile(id="t4", task_type="code_review", difficulty=0.70, risk=0.50, min_quality=0.85, expected_input_tokens=10000, expected_output_tokens=1800),
        0.82,
        ["intent_classifier", "code_review", "test_runner", "safety_checker", "evaluation_engine", "github_router", "ledger"],
    ),
    (
        "docs-007",
        "docs_updater",
        TaskProfile(id="t5", task_type="docs_updater", difficulty=0.35, risk=0.15, min_quality=0.75, expected_input_tokens=2000, expected_output_tokens=800),
        0.93,
        ["intent_classifier", "docs_updater", "github_router", "ledger"],
    ),
    (
        "release-v0.1.1",
        "release_planner",
        TaskProfile(id="t6", task_type="release_planner", difficulty=0.55, risk=0.35, min_quality=0.85, expected_input_tokens=4000, expected_output_tokens=1200),
        0.86,
        ["intent_classifier", "release_planner", "test_runner", "safety_checker", "evaluation_engine", "github_router", "ledger"],
    ),
    (
        "issue-003",
        "issue_triage",
        TaskProfile(id="t7", task_type="issue_triage", difficulty=0.22, risk=0.10, min_quality=0.70, expected_input_tokens=550, expected_output_tokens=180),
        0.94,
        ["intent_classifier", "issue_triage", "github_router", "ledger"],
    ),
]


def _summarize_decisions(decisions):
    """Aggregate compute decisions for a tidy demo printout."""
    by_profile = {}
    total_cost = 0.0
    for d in decisions:
        by_profile.setdefault(d["profile_id"], 0)
        by_profile[d["profile_id"]] += 1
        total_cost += d["estimated_cost"]
    return by_profile, total_cost


def main() -> None:
    print("=" * 70)
    print("  Viridis Operator — Verdigraph operating Verdigraph")
    print("=" * 70)

    genome_path = ROOT / "viridis_operator.genome.json"
    genome = load_genome(genome_path)
    agent = DevelopmentalAgent(genome)
    optimizer = ComputeOptimizer(COMPUTE_PROFILES)

    print(f"\nAgent '{agent.genome.agent_name}' instantiated with "
          f"{len(agent.graph.nodes)} cognitive nodes and "
          f"{len(agent.graph.edges)} initial edges.")
    print(f"Compute layer has {len(COMPUTE_PROFILES)} execution profiles "
          f"spanning cache, local-GPU, cloud APIs, and an evaluator tier.")

    # Track which compute profile each task routed to.
    compute_decisions = []

    for task_id, task_type, task_profile, score, used_nodes in SYNTHETIC_WORKLOAD:
        # 1. Route compute for the task.
        decision = optimizer.choose_profile(task_profile)
        compute_decisions.append({
            "task_id": task_id,
            "task_type": task_type,
            "profile_id": decision.profile_id,
            "estimated_cost": decision.estimated_cost,
            "latency_ms": decision.estimated_latency_ms,
        })

        # 2. Apply the evaluation (this is what would happen after the task
        #    actually executed via the chosen profile, with measured outcome).
        result = EvaluationResult(
            task_id=task_id,
            task_type=task_type,
            success_score=score,
            accuracy=score,
            user_satisfaction=score,
            cost_efficiency=max(0.0, 1.0 - decision.estimated_cost),
            safety_score=1.0,
            notes=f"Routed via {decision.profile_id}.",
            used_edges=[(used_nodes[i], used_nodes[i + 1])
                        for i in range(len(used_nodes) - 1)],
            used_nodes=list(used_nodes),
        )
        agent.process_evaluation(result)

    # ----- Print a tidy summary -----
    print("\nCompute routing decisions:")
    by_profile, total_cost = _summarize_decisions(compute_decisions)
    for profile_id, count in sorted(by_profile.items(), key=lambda x: -x[1]):
        print(f"  {profile_id:25s} → {count} task(s)")
    print(f"\n  Total estimated cost over {len(SYNTHETIC_WORKLOAD)} tasks: ${total_cost:.5f}")
    print(f"  (Baseline 'always use opus_evaluator' would cost ~${len(SYNTHETIC_WORKLOAD) * 0.03:.5f})")

    # ----- Print routing recommendations from each operational entry point ---
    print("\nLearned routing — top step from each entry point:")
    for from_node in ("intent_classifier", "issue_triage", "code_review",
                       "release_planner"):
        steps = agent.best_next_steps(from_node, limit=1)
        if steps:
            print(f"  {from_node:22s} → {steps[0].to_node:22s} "
                  f"(score={steps[0].score:.4f})")

    # ----- Show grown specialist nodes -----
    grown = [nid for nid in agent.graph.nodes
             if nid.endswith("_specialist")]
    if grown:
        print(f"\nGrown specialist nodes ({len(grown)}):")
        for nid in grown:
            print(f"  {nid}")

    # ----- Ledger summary -----
    print(f"\nDevelopmental ledger: {len(agent.ledger.events)} events recorded.")
    event_types = {}
    for e in agent.ledger.events:
        event_types[e.event_type] = event_types.get(e.event_type, 0) + 1
    for et, count in sorted(event_types.items(), key=lambda x: -x[1]):
        print(f"  {et:25s} {count}")

    # ----- Persist evolved state -----
    out_dir = ROOT / "output"
    out_dir.mkdir(exist_ok=True)
    state_path = out_dir / "viridis_operator_evolved_state.json"
    agent.save_state(state_path)
    print(f"\nEvolved agent state saved: {state_path}")

    print("\nNext step: connect verdigraph-mcp + github-mcp in Claude Desktop")
    print("           and load this state via verdigraph_load_agent_state.")
    print("           See docs/OPERATOR_AGENT.md.")


if __name__ == "__main__":
    main()
