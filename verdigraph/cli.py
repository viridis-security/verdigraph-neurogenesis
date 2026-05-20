"""
verdigraph/cli.py — command-line wrapper around the brain pipeline.

Examples:
    python -m verdigraph build --format auto --file my_agent.json
    python -m verdigraph build --format verdigraph_genome --stdin < my_agent.json
    python -m verdigraph verify path/to/brain.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from verdigraph.brain import extract, detect_format, verify_brain, to_dict, report_to_dict, Brain


def _read_input(args: argparse.Namespace) -> bytes:
    if args.file:
        return Path(args.file).read_bytes()
    if args.stdin or not sys.stdin.isatty():
        return sys.stdin.buffer.read()
    raise SystemExit("error: provide --file PATH or pipe input via stdin")


def cmd_build(args: argparse.Namespace) -> int:
    data = _read_input(args)
    fmt = args.format if args.format != "auto" else detect_format(data)
    brain = extract(fmt, data)
    report = verify_brain(brain)
    out = {
        "brain": to_dict(brain),
        "invariants": report_to_dict(report),
    }
    if args.summary:
        out = {
            "brain_id":     brain.brain_id,
            "brain_uri":    brain.brain_uri,
            "content_hash": brain.content_hash,
            "node_count":   len(brain.nodes),
            "edge_count":   len(brain.edges),
            "format":       fmt,
            "invariants_passed": report.passed,
            "warnings":     brain.provenance.warnings,
        }
    json.dump(out, sys.stdout, indent=(2 if args.pretty else None))
    sys.stdout.write("\n")
    return 0 if report.passed else 2


def cmd_verify(args: argparse.Namespace) -> int:
    body = json.loads(Path(args.file).read_text())
    # Rebuild the Brain from the JSON (best-effort) and re-run invariants.
    from dataclasses import is_dataclass
    from verdigraph.brain import (
        BrainGenome, BrainNode, BrainEdge, BrainGrowthRules, BrainSafetyAxioms,
        LlmBinding, ExtractorMeta,
    )
    g = body["genome"]
    genome = BrainGenome(
        agent_name=g["agent_name"], purpose=g["purpose"],
        initial_nodes=list(g["initial_nodes"]), fitness_metrics=list(g["fitness_metrics"]),
        llm_bindings=[LlmBinding(**b) for b in g.get("llm_bindings", [])],
        growth_rules=BrainGrowthRules(**g.get("growth_rules", {})),
        safety_axioms=BrainSafetyAxioms(**g.get("safety_axioms", {})),
    )
    brain = Brain(
        schema_version=body["schema_version"], brain_id=body["brain_id"], genome=genome,
        nodes=[BrainNode(**n) for n in body["nodes"]],
        edges=[BrainEdge(**e) for e in body["edges"]],
        provenance=ExtractorMeta(**body["provenance"]),
        content_hash=body["content_hash"],
    )
    report = verify_brain(brain)
    json.dump(report_to_dict(report), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if report.passed else 2


def main() -> int:
    parser = argparse.ArgumentParser(prog="verdigraph", description="Deterministic Verdigraph brain CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="Build a brain from an agent file")
    b.add_argument("--file", help="Path to agent file (JSON or newline-separated prompts)")
    b.add_argument("--stdin", action="store_true", help="Read input from stdin")
    b.add_argument("--format", default="auto",
                   choices=["auto", "verdigraph_genome", "claude_project_export", "openai_assistant", "prompt_list"])
    b.add_argument("--summary", action="store_true", help="Print one-line summary instead of full artifact")
    b.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    b.set_defaults(func=cmd_build)

    v = sub.add_parser("verify", help="Re-verify a brain artifact JSON file")
    v.add_argument("file", help="Path to brain.json (the output of `build`)")
    v.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
