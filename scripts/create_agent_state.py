#!/usr/bin/env python
from __future__ import annotations

import argparse
from pathlib import Path

from axiomgraph import DevelopmentalAgent
from axiomgraph.io import load_genome


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an initial AxiomGraph agent state from a genome JSON file.")
    parser.add_argument("genome", help="Path to genome JSON")
    parser.add_argument("output", help="Path for output state JSON")
    args = parser.parse_args()

    genome = load_genome(args.genome)
    agent = DevelopmentalAgent(genome)
    agent.save_state(Path(args.output))
    print(f"Created initial agent state: {args.output}")


if __name__ == "__main__":
    main()
