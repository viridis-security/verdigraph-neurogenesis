# Changelog

All notable changes to Verdigraph NeuroGenesis are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-17

Initial public release. Phase 1 MVP per [docs/ROADMAP.md](docs/ROADMAP.md)
plus the Phase 2 MCP runtime layer.

### Added

- **Core package `verdigraph/`** — genome, cognitive graph, growth engine,
  pruning engine, router, evaluation, developmental ledger, and the
  compute-efficiency layer.
- **MCP server `verdigraph_mcp/`** — stdio Model Context Protocol server
  with a thread-safe multi-agent registry, file-backed persistence, and
  thirteen tools prefixed `verdigraph_*`. Installable via `pip install -e
  ".[mcp]"`; entry point `verdigraph-mcp`.
- **Companion papers in `papers/`** — Physical NeuroGenesis (SynapseForge),
  Digital NeuroGenesis (Verdigraph), and Compute Efficiency.
- **Examples** — hypothetical research-agent and service-agent genomes,
  end-to-end demos (`run_demo.py`, `compute_efficiency_demo.py`), and an
  interactive Compute Cost Calculator (`compute_cost_calculator.html`).
- **Documentation in `docs/`** — architecture, API sketch, invariants,
  compute-efficiency design, roadmap, MCP server reference, and the launch
  essay *Compute is Carbon*.
- **Test suite** — 30 tests across genome, graph, agent evolution, pruning,
  router, dict round-trip, agent state round-trip, invariant violations,
  the compute optimizer, and the MCP server.
- **CI** — GitHub Actions matrix on Python 3.10, 3.11, 3.12 running pytest
  plus both demos.

### Safety invariants enforced in code

- Hidden-node rejection — new nodes require a description.
- Protected-node preservation — genome-declared protected nodes cannot be
  silently removed.
- Bounded growth — graph mutations respect `max_nodes` / `max_edges`.
- Ledger-on-every-mutation — growth and pruning events always log.
- `ComputeOptimizer.choose_profile` rejects any profile below the task's
  `min_quality`, regardless of cost.
- `save_state` is fully round-trippable, including `growth_rules` and
  `safety_axioms`. `DevelopmentalAgent.from_state_dict()` and `load_state()`
  reconstruct evolved agents from persisted state.

[Unreleased]: https://github.com/OWNER/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0
