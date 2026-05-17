# AxiomGraph NeuroGenesis

![tests](https://github.com/OWNER/REPO/actions/workflows/tests.yml/badge.svg)

A software-first framework for AI-agent-architected, self-evolving cognitive substrates.

AxiomGraph models an AI agent as a living graph of cognitive nodes and weighted synaptic edges. The graph can grow new modules, strengthen useful pathways, prune weak pathways, log all developmental changes, preserve safety invariants, and optimize compute by learning the cheapest reliable cognitive route for each task. This repository is a GitHub-ready starter kit for experimenting with the concept in a purely digital environment before any physical neuromorphic hardware is attempted.

## Core idea

Instead of treating an AI agent as a static prompt + tool list, AxiomGraph treats it as a developmental system:

```text
agent genome -> cognitive graph -> task routing -> evaluation -> growth/pruning -> evolved graph
```

The same abstract structure can later map to physical neuromorphic hardware:

| Digital AxiomGraph | Future physical embodiment |
|---|---|
| Cognitive nodes | Printed nodes/electrodes |
| Weighted edges | Grown synapses/conductance paths |
| Growth rules | Electrochemical pulse protocols |
| Pruning rules | Reverse pulses/dissolution/isolation |
| Ledger | Conductance/growth history |
| Evaluation | Task-performance measurement |

## Repository contents

```text
axiomgraph/              Core framework
examples/                Hypothetical agent genomes and demo scripts
docs/                    Concept paper, architecture, invariants, compute-efficiency layer
scripts/                 CLI helper scripts
tests/                   Unit tests
pyproject.toml           Python package metadata
```

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Run the demo

```bash
python examples/run_demo.py
```

This will create a hypothetical ResearchAssistant agent, simulate task outcomes, update edge weights, grow new nodes when repeated task patterns appear, prune weak pathways, and write an evolved state file to `examples/output/`.


## Run the compute-efficiency demo

```bash
python examples/compute_efficiency_demo.py
```

This demonstrates model/backend selection across cache reuse, local models, and cloud transformer profiles.

## Run tests

```bash
pytest
```

## Design invariants

1. Every cognitive structure must be inspectable.
2. Every growth event must be logged.
3. Every new node must have a purpose.
4. Every strengthened pathway must be tied to evaluation.
5. Every pruning action must preserve safety.
6. The agent may evolve routing, not foundational safety boundaries.
7. Growth must improve measured performance or remain reversible.
8. Different agents may develop different architectures.
9. Fixed infrastructure enforces logging, safety, and review.
10. Digital development should remain translatable to future physical substrates.
11. Agent routing should maximize successful task completion per unit compute.

## Run as an MCP server

AxiomGraph ships with a stdio Model Context Protocol server so Claude Desktop, Cowork, Claude Code, and other MCP-compatible clients can drive it directly.

```bash
pip install -e ".[mcp]"
axiomgraph-mcp
```

See [docs/MCP_SERVER.md](docs/MCP_SERVER.md) for the full tool list and a `claude_desktop_config.json` snippet.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New work must preserve the design invariants in [docs/INVARIANTS.md](docs/INVARIANTS.md) and include tests.

## Disclaimer

This is an experimental research framework. It does not create autonomous unrestricted self-modifying AI. All growth and pruning actions are constrained by explicit genome rules, safety axioms, and an auditable ledger.

## Papers

This repository includes two companion papers in the `papers/` folder:

1. `PAPER_1_Physical_NeuroGenesis_SynapseForge.md/.pdf` - the physical version: AI-agent-architected, 3D-printed, solution-grown neuromorphic substrates.
2. `PAPER_2_AxiomGraph_Digital_NeuroGenesis.md/.pdf` - the software version: self-evolving digital cognitive graphs for AI agents.
3. `PAPER_3_AxiomGraph_Compute_Efficiency.md/.pdf` - the compute-efficiency layer: cheapest reliable cognitive routing for local GPU, cloud transformer, and hybrid agents.

