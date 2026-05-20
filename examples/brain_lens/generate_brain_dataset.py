#!/usr/bin/env python3
"""
generate_brain_dataset.py — produce a real evolving Verdigraph brain dataset.

This is a PURE OBSERVER (invariant I2): it drives an unmodified
DevelopmentalAgent through a synthetic task stream and snapshots the graph
after every evaluation. It never mutates agent internals. The output JSON is
what the 3D viewer embeds.

Output schema:
{
  "meta":   {agent_name, brain_id, purpose, generated_at, frame_count, ...},
  "genome": {initial_nodes, fitness_metrics, growth_rules, safety_axioms},
  "frames": [ {index, task_id, task_type, success_score,
               graph:{nodes,edges}, new_events:[...]} ],
  "ledger": [ all LedgerEvents in order ]
}
Frame 0 is the genome state (brain at birth, before any task).
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]  # examples/brain_lens/ -> repo root
sys.path.insert(0, str(PROJECT))

from verdigraph import DevelopmentalAgent           # noqa: E402
from verdigraph.evaluation import EvaluationResult  # noqa: E402
from verdigraph.io import load_genome               # noqa: E402

GENOME_PATH = PROJECT / "examples" / "hypothetical_research_agent.genome.json"
OUT_PATH = Path(__file__).resolve().parent / "brain_dataset.json"

MAIN_CHAIN = [
    ("intent_classifier", "planner"),
    ("planner", "search_module"),
    ("search_module", "synthesis_module"),
    ("synthesis_module", "citation_checker"),
    ("citation_checker", "safety_checker"),
    ("safety_checker", "evaluation_engine"),
    ("evaluation_engine", "ledger"),
]
CHAIN_NODES = [
    "intent_classifier", "planner", "search_module", "synthesis_module",
    "citation_checker", "safety_checker", "evaluation_engine", "ledger",
]


def derive_brain_id(genome_path: Path, agent_name: str) -> str:
    """Use the repo's canonical brain_id if available; else a stable fallback."""
    try:
        from verdigraph.brain import derive_brain_id as _real
        return _real(genome_path.read_bytes(), "verdigraph_genome")
    except Exception:
        digest = hashlib.sha256(agent_name.encode("utf-8")).hexdigest()
        return "BR-" + digest[:12].upper()


def build_schedule() -> list[tuple[str, str, float]]:
    """A varied task stream: four healthy task types that grow specialists,
    plus one ('manual_formatting') that grows a specialist then fails hard,
    so the viewer shows both neurogenesis and a withering pathway."""
    healthy = {
        "literature_review":     [0.88, 0.91, 0.93, 0.90, 0.94, 0.92, 0.95, 0.89, 0.93],
        "citation_audit":        [0.80, 0.84, 0.87, 0.83, 0.88, 0.85, 0.90, 0.86],
        "data_extraction":       [0.85, 0.88, 0.84, 0.90, 0.89, 0.92, 0.87, 0.91],
        "hypothesis_generation": [0.74, 0.78, 0.81, 0.76, 0.83, 0.79, 0.85],
    }
    failing = ("manual_formatting",
               [0.62, 0.66, 0.59, 0.14, 0.11, 0.17, 0.09, 0.13, 0.10, 0.12, 0.08])

    # Interleave healthy types round-robin; thread the failing type through.
    streams = {t: list(s) for t, s in healthy.items()}
    order = list(streams.keys())
    schedule: list[tuple[str, str, float]] = []
    n = 0
    fail_type, fail_scores = failing
    fail_iter = iter(fail_scores)
    while any(streams.values()):
        for t in order:
            if streams[t]:
                n += 1
                schedule.append((f"t{n:03d}", t, streams[t].pop(0)))
        # drip the failing type in roughly every other round
        if len(schedule) % 3 == 0:
            try:
                score = next(fail_iter)
                n += 1
                schedule.append((f"t{n:03d}", fail_type, score))
            except StopIteration:
                pass
    for score in fail_iter:  # any remaining failing tasks
        n += 1
        schedule.append((f"t{n:03d}", fail_type, score))
    return schedule


def route_for(agent: DevelopmentalAgent, task_type: str):
    """Edges/nodes this task exercises: the shared backbone plus this task
    type's specialist edges, if the agent has grown them."""
    edges = [e for e in MAIN_CHAIN if e in agent.graph.edges]
    nodes = list(CHAIN_NODES)
    specialist = f"{task_type}_specialist"
    if specialist in agent.graph.nodes:
        nodes.append(specialist)
        for pair in (("planner", specialist), ("evaluation_engine", specialist)):
            if pair in agent.graph.edges:
                edges.append(pair)
    return edges, nodes


def snapshot(agent: DevelopmentalAgent) -> dict:
    return copy.deepcopy(agent.graph.to_dict())


def main() -> None:
    genome = load_genome(GENOME_PATH)
    agent = DevelopmentalAgent(genome)
    brain_id = derive_brain_id(GENOME_PATH, genome.agent_name)

    frames: list[dict] = []
    # Frame 0 — the brain at birth (genome only).
    frames.append({
        "index": 0,
        "task_id": None,
        "task_type": "genome",
        "success_score": None,
        "graph": snapshot(agent),
        "new_events": agent.ledger.to_list(),  # agent_initialized
    })
    prev_event_count = len(agent.ledger.events)

    for i, (task_id, task_type, score) in enumerate(build_schedule(), start=1):
        used_edges, used_nodes = route_for(agent, task_type)
        result = EvaluationResult(
            task_id=task_id,
            task_type=task_type,
            success_score=score,
            accuracy=score,
            user_satisfaction=min(1.0, score + 0.03),
            cost_efficiency=0.70 + 0.20 * score,
            safety_score=1.0,
            used_edges=used_edges,
            used_nodes=used_nodes,
            notes=f"Synthetic {task_type} task (observer dataset).",
        )
        agent.process_evaluation(result)

        all_events = agent.ledger.to_list()
        frames.append({
            "index": i,
            "task_id": task_id,
            "task_type": task_type,
            "success_score": score,
            "graph": snapshot(agent),
            "new_events": all_events[prev_event_count:],
        })
        prev_event_count = len(all_events)

    full_ledger = agent.ledger.to_list()
    final_graph = agent.graph.to_dict()

    dataset = {
        "meta": {
            "agent_name": genome.agent_name,
            "brain_id": brain_id,
            "purpose": genome.purpose,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "frame_count": len(frames),
            "final_node_count": len(final_graph["nodes"]),
            "final_edge_count": len(final_graph["edges"]),
            "ledger_event_count": len(full_ledger),
        },
        "genome": {
            "initial_nodes": list(genome.initial_nodes),
            "fitness_metrics": list(genome.fitness_metrics),
            "growth_rules": {
                "create_node_when_task_repeats": genome.growth_rules.create_node_when_task_repeats,
                "strengthen_edge_on_success": genome.growth_rules.strengthen_edge_on_success,
                "weaken_edge_on_failure": genome.growth_rules.weaken_edge_on_failure,
                "prune_below_weight": genome.growth_rules.prune_below_weight,
                "max_nodes": genome.growth_rules.max_nodes,
                "max_edges": genome.growth_rules.max_edges,
            },
            "protected_nodes": list(genome.safety_axioms.protected_nodes),
        },
        "frames": frames,
        "ledger": full_ledger,
    }

    OUT_PATH.write_text(json.dumps(dataset, indent=None, separators=(",", ":")))

    # ---- summary --------------------------------------------------------
    from collections import Counter
    types = Counter(e["event_type"] for e in full_ledger)
    print(f"brain_id           : {brain_id}")
    print(f"frames             : {len(frames)}")
    print(f"final nodes / edges: {len(final_graph['nodes'])} / {len(final_graph['edges'])}")
    print(f"ledger events      : {len(full_ledger)}")
    for k, v in sorted(types.items()):
        print(f"  {k:22s}: {v}")
    specialists = [n for n in final_graph["nodes"] if n.endswith("_specialist")]
    print(f"specialists grown  : {specialists}")
    weights = sorted(e["weight"] for e in final_graph["edges"].values())
    if weights:
        print(f"edge weight range  : {weights[0]:.3f} .. {weights[-1]:.3f}")
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"dataset written    : {OUT_PATH}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
