# Contributing to Verdigraph NeuroGenesis

Thanks for your interest. This repo is an experimental research framework, but
contributions that preserve its invariants and extend its reach are welcome.

## Getting set up

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
```

Both demos should run end-to-end from a clean clone:

```bash
python examples/run_demo.py
python examples/compute_efficiency_demo.py
```

## Design invariants

Before opening a PR, please read `docs/INVARIANTS.md`. The framework's value
comes from the contract that growth, pruning, routing, and compute decisions
are bounded, inspectable, and logged. PRs that weaken or remove an invariant
need an explicit rationale in the PR description.

Concretely:

- New nodes must have a description (`SafetyAxioms.disallow_hidden_nodes`).
- Protected nodes declared in the genome must not be silently removed.
- Every growth or pruning action must write a `DevelopmentalLedger` event.
- Graph mutations must remain within `GrowthRules.max_nodes` / `max_edges`.
- `ComputeOptimizer.choose_profile` must reject any profile below the task's
  `min_quality`, regardless of cost.

## Testing

- All new behavior needs unit tests in `tests/`.
- Run `pytest -q` and confirm 100% green before pushing.
- Add invariant-violation tests when adding new invariants (see
  `tests/test_invariants.py` for the pattern).

## Code style

- Python 3.10+, type hints required on public functions.
- Zero runtime dependencies in the core package. Dev-only deps (pytest, etc.)
  go under `[project.optional-dependencies].dev` in `pyproject.toml`.
- Prefer dataclasses for state, engines for behavior, and the ledger for any
  externally-visible side effect.

## Reporting issues

When filing an issue, please include:

- Python version
- A minimal reproduction (genome JSON or test snippet)
- Expected vs. actual behavior
- Any relevant ledger output (if a growth/pruning step is involved)
