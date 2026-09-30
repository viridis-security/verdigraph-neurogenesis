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

## Sign your commits (DCO)

Pull requests from forks need a `Signed-off-by` line on every commit, matching the commit author's email:

    Signed-off-by: Your Name <you@example.com>

`git commit -s` adds it, and `git rebase --signoff origin/main` fixes an existing branch. Signing off
certifies the Developer Certificate of Origin 1.1 (https://developercertificate.org): you wrote the
change, or you have the right to submit it under this repository's license. The DCO check blocks
unsigned commits.

## License of contributions

Contributions are licensed under the same license as the files they change (see `LICENSE`), with no
additional terms. Don't submit work you can't license that way.

## Never commit

Credentials, API keys, private keys, `.env` files, customer or partner data, or wallet files. The secret
scan blocks known key formats. If you find a leaked secret, report it privately as described in
`SECURITY.md`.

## Names and marks

The license does not cover Viridis names, logos or certification marks. See `TRADEMARKS.md`.
