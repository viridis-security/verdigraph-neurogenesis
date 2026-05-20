# Changelog

All notable changes to Verdigraph NeuroGenesis are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] — unreleased (iteration 4: security & production hardening)

Hardening pass to make the paid hosted MCP (`hosted-mcp/`) safe for the Energy
AI production cutover. **Phase 0 — cutover blockers** (this entry grows as
phases 1 and 2 land).

### Security

- **Real authentication (C1).** The `/authorize` flow is now gated by GitHub
  OIDC. Identity is the immutable numeric GitHub user id
  (`oauth_subject = "github:" + id`, `UNIQUE`); two authorizations by the same
  human resolve to the same `caller_id`, so a caller who loses a token recovers
  their balance by re-authenticating. Previously every authorization minted a
  fresh random subject and a brand-new empty account. New routes:
  `GET /authorize` (redirect to GitHub), `GET /authorize/callback` (code
  exchange + consent). New Worker secrets `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET`.
- **Operational docs purged from the public repo (C2).**
  `STRIPE_GO_LIVE_STATE.md`, `STRIPE_GO_LIVE_CHECKLIST.md` and
  `operator-digests/` moved to the git-ignored `docs/internal/`. Live Stripe
  object ids, the Stripe account id, and absolute local filesystem paths
  scrubbed from all remaining tracked files. A CI `secret-scan` job now fails
  the build on any committed live identifier.

### Fixed

- **Exactly-once metering under concurrency (H1).** `meteredCall` reserves the
  `usage_ledger` row on the `UNIQUE (caller_id, request_id)` index *before*
  debiting, so concurrent or retried calls debit exactly once, fire exactly one
  Stripe meter event, and replay the original row. Closes a TOCTOU race where
  two concurrent calls sharing a `request_id` both debited.
- **Conservation cron counts all revenue streams (H2).** The monthly payout now
  sums net revenue across per-call routing fees, brain unlocks, attestations
  *and* marketplace sales — not routing fees alone. Marketplace conservation
  ledger rows are linked to the payout that accounts for them.
- **Atomic money paths (H3).** `redeemCreditCode`, `bookPurchase`, and the
  subscription-invoice credit path now commit their multi-statement mutations
  as a single `D1.batch()` transaction — all-or-nothing, no partial state.

### Added

- **TypeScript CI (H4).** A `hosted-mcp` job runs `npm run typecheck` and the
  full vitest suite (including the cross-core `parity.test.ts`, which now
  executes against a real Python install) on every push and pull request.
- A real-SQLite D1 test harness (`hosted-mcp/tests/helpers/d1.ts`) backing the
  new metering, atomic-money, conservation-cron and auth test suites.
- D1 migrations `0007_metering_settlement.sql` (usage_ledger `settlement_state`)
  and `0008_conservation_multistream.sql` (link marketplace conservation rows
  to payouts).

## [0.1.0] — 2026-05-17

**Permanent archive (Zenodo):**
- Version DOI: [10.5281/zenodo.20261687](https://doi.org/10.5281/zenodo.20261687)
- Concept DOI (all versions): [10.5281/zenodo.20261686](https://doi.org/10.5281/zenodo.20261686)
- Record URL: https://zenodo.org/records/20261687


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

[Unreleased]: https://github.com/viridis-security/verdigraph-neurogenesis/compare/v0.1.0...HEAD
[0.3.0]: https://github.com/viridis-security/verdigraph-neurogenesis/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/viridis-security/verdigraph-neurogenesis/releases/tag/v0.1.0
