# Lean Formalization Scope — Verdigraph Operational Layer

**Status:** Draft for review.  Companion to existing T-IB-* and PSIT theorem projects.
**Author:** Viridis Operator (drafted with Justin, 2026-05-26).
**Toolchain:** Lean 4 (v4.24.0) + mathlib4, prover assist via Harmonic Aristotle (`aristotlelib`).

---

## 0. Position in the corpus

The three theorems below are NOT new mathematics.  They are the **operational instantiation** of the existing Intelligence Bound corpus theorems for the Verdigraph software layer.  Each one names its parent in the IB corpus and inherits the proof obligations downward.

Existing Lean projects on the account (Aristotle, all sorry-free):

| ID | Project | Theorems | Role |
|---|---|---|---|
| T-IB-01 | Attribution Conservation | 3 | Captured bits ≤ budget − authorized.  **Parent of T-VG-02 below.** |
| T-IB-02..09 | Intelligence Bound corpus (rest) | ~24 | Adversarial dissipation, asymmetric defense, etc. |
| PSIT_Symplectic | Phase-Space Intelligence Theory | 8 | Symplectic / Darboux geometric foundation |
| BridgeEcoChain | EcoChain bridge | TBD | Sister project |

The new tier — `T-VG-*` — is **Verdigraph Operational Theorems**.  Naming convention follows T-IB-*.

---

## 1. Theorem statements (spec invariants — these must be reviewed BEFORE proofs)

### T-VG-01.  Ledger.append-only

**Informal:** Any operation on a `DevelopmentalLedger` either leaves it unchanged or appends exactly one event at the end.  No event in the ledger's history is ever modified, removed, or reordered.

**Lean shape (sketch — to be refined in proj/):**

```lean
structure DevelopmentalLedger where
  events : List LedgerEvent
  monotone_ts : events.Sorted (·.timestamp ≤ ·.timestamp)

inductive LedgerOp where
  | noop
  | append (e : LedgerEvent)

def apply (L : DevelopmentalLedger) (op : LedgerOp) : DevelopmentalLedger := ...

theorem append_only (L : DevelopmentalLedger) (op : LedgerOp) :
    let L' := apply L op
    L.events.isPrefixOf L'.events
```

**Open spec questions (must answer before proof):**

- **Q1.1:** Does `apply` reject append-of-event-with-earlier-timestamp, or rewrite it to `noop`?  (Affects whether `monotone_ts` is provable or partial.)
- **Q1.2:** Are concurrent appends modeled here, or is the ledger assumed single-writer?  (If concurrent: need to refine to either `Option DevelopmentalLedger` or commit-log semantics with conflict resolution.)
- **Q1.3:** What is `LedgerEvent`'s extensible payload?  Does the proof obligation extend over payload contents (e.g., "payload is immutable") or only over the event list structure?

**Parent in corpus:** None directly — this is a Verdigraph-native primitive.  But it's the *substrate* for T-VG-02 and T-VG-03 (no conservation/pruning proof matters if the ledger underneath is mutable).

### T-VG-02.  Conservation.share_exactness

**Informal:** For every completed-payment revenue event with non-negative net amount `r`, the conservation routing computes a share `s` such that `s + retained = r` and `s = floor((1/4) · r)` in the chosen unit (cents).

**Lean shape:**

```lean
structure RevenueEvent where
  gross_cents : ℕ
  stripe_fee_cents : ℕ
  refund_cents : ℕ
  h_fee : stripe_fee_cents ≤ gross_cents
  h_refund : refund_cents ≤ gross_cents - stripe_fee_cents

def netRevenue (e : RevenueEvent) : ℕ :=
  e.gross_cents - e.stripe_fee_cents - e.refund_cents

def conservationShare (e : RevenueEvent) : ℕ :=
  netRevenue e / 4   -- integer division = floor

def retained (e : RevenueEvent) : ℕ :=
  netRevenue e - conservationShare e

theorem share_partition (e : RevenueEvent) :
    conservationShare e + retained e = netRevenue e := by
  unfold conservationShare retained; omega

theorem share_exact_quarter (e : RevenueEvent) :
    4 * conservationShare e ≤ netRevenue e
    ∧ netRevenue e < 4 * conservationShare e + 4 := by
  unfold conservationShare; omega
```

**Open spec questions (CRITICAL — wrong answer = clean proof of wrong claim):**

- **Q2.1: Net revenue definition.**  Is `net = gross − stripe_fee − refunds`?  Or `net = gross − refunds` only (with Stripe fees absorbed by Viridis)?  Or `net = gross − refunds − chargebacks − disputes`?  *Check `examples/viridis_operator.genome.json` metadata.stripe_catalog and any conservation policy doc.*
- **Q2.2: Rounding.**  Integer-cents floor as above, OR distribute the rounding residual periodically?  Floor is simplest and what the spec above proves.  Alternative: accumulate residuals into next period — provable but messier.
- **Q2.3: Currency.**  All Stripe products in the catalog priced in USD?  If multi-currency, do we convert at event time or at routing time, and does that affect the 25% invariant under FX drift?
- **Q2.4: "25% of NET" is the public claim — confirmed?  Or is it 25% of gross?**  ([[verdigraph_operator_deps]] / SKILL.md uses "net" — confirm against landing-page and registry copy.)

**Parent in corpus:** T-IB-01 (attribution conservation pattern).  In T-IB-01, captured information is bounded by budget − authorized.  Here, conservation share is *exactly* a fixed fraction of net.  The shape is "partition with invariant share"; T-IB-01 is "partition with upper-bound on adversarial share."

### T-VG-03.  Pruning.protected_invariance

**Informal:** For any `CognitiveGraph G`, any sequence of pruning operations governed by `GrowthRules`, the set of `protected_nodes` (from `safety_axioms.protected_nodes` in the genome) is preserved.

**Lean shape:**

```lean
structure CognitiveGraph where
  nodes : Finset NodeId
  edges : Finset (NodeId × NodeId × ℝ)  -- with weights

def GrowthRules.prune (G : CognitiveGraph) (rules : GrowthRules)
    (protected : Finset NodeId) : CognitiveGraph := ...

theorem protected_invariance
    (G : CognitiveGraph) (rules : GrowthRules) (protected : Finset NodeId)
    (h_sub : protected ⊆ G.nodes) :
    protected ⊆ (rules.prune G protected).nodes
```

Extends to the transitive closure `prune* G = repeat prune until fixed-point`:

```lean
theorem protected_invariance_star
    (G : CognitiveGraph) (rules : GrowthRules) (protected : Finset NodeId)
    (h_sub : protected ⊆ G.nodes) :
    protected ⊆ (rules.pruneStar G protected).nodes
```

**Open spec questions:**

- **Q3.1: Pruning termination.**  Does `pruneStar` always terminate?  (`max_nodes = 96`, `min_events_before_pruning = 4`, `prune_below_weight = 0.12` in genome — likely yes, but proof needs a decreasing measure.)
- **Q3.2: Edges to protected nodes.**  When a non-protected source-node is pruned and it had an edge to a protected node, is the edge removed (orphaning the protected node) or does the protected node also disappear?  Current `verdigraph/pruning.py` behavior is the source of truth — *verify*.
- **Q3.3: Re-creation racing pruning.**  Growth + pruning can run concurrently (`growth_rules.create_node_when_task_repeats = 5` vs `prune_below_weight = 0.12`).  Do we prove per-step invariance, or do we need an interleaving / scheduling model?

**Parent in corpus:** None directly — closest is T-IB-09 (adversarial dissipation, protecting against capture).  Different shape: T-IB-09 bounds an adversary's economic spend; T-VG-03 bounds graph-level mutation reachability.

---

## 2. Proof execution plan

### Phase A — spec freeze (1–2 days, no Lean code written)

1. Answer Q1.1, Q1.2, Q1.3 (ledger).
2. Answer Q2.1, Q2.2, Q2.3, Q2.4 (conservation).  Q2.1 and Q2.4 are the project's largest spec risk.
3. Answer Q3.1, Q3.2, Q3.3 (pruning).
4. Update this doc with frozen specs; commit on its own branch.

### Phase B — Lean scaffolding (1 day)

1. New directory `lean/verdigraph/` with three sub-projects following the same `lake` layout as `T-IB-01_aristotle/`.
2. Write the `structure` / `def` / `theorem` skeletons exactly as drafted above with `sorry` for proofs.
3. Run `lake build` to confirm scaffolding type-checks.

### Phase C — Aristotle assist (Justin's call, async)

For each of the three projects:

```python
proj = await A.Project.create_from_directory(
    prompt="Prove the theorems in this Lean project.  See README.md and ARISTOTLE_NOTES.md.",
    project_dir="lean/verdigraph/T-VG-01-ledger-append-only",
)
```

Aristotle runs up to 24h; we poll `proj.get_tasks()` and download artifacts.  This is exactly the pattern that produced T-IB-01 sorry-free in your prior run.

### Phase D — audit + paper (1–2 weeks)

1. `#print axioms` on each theorem — confirm only `propext`, `Classical.choice`, `Quot.sound` (the standard set, as T-IB-01 confirmed).
2. Wire the proofs into CI: `lake build` + `lake test` on PR.
3. Write companion paper draft.  Working title: **"Operational Formalization of Intelligence Bound Theorems in an Agent Software Stack."**  Venue candidates: ITP, FM, CAV, or as artifact-track companion to the existing Phys Rev E paper.
4. Mint DOI on Zenodo using the existing `zenodo_deposit/` staging directory.

---

## 3. What ISN'T in scope

- **74% energy / 3.79× efficiency benchmark.**  Empirical measurement — wrong tool.  Keep in `verdigraph/benchmark.py`.
- **Routing optimality.**  Likely undecidable in general; would require a heavily restricted relaxation.  Defer.
- **The Landauer-bound derivation itself.**  Already an axiom in T-IB-01 (`landauer_bound`) — it's physics, formalize the *consequences* not the bound itself.
- **PSIT geometric structure.**  Already proven; no work needed.

---

## 4. Open question for Justin (please answer before Phase B)

The spec questions above (Q1.1–Q3.3) are the gate.  Q2.1 and Q2.4 in particular — the "net revenue" definition and the "25% of net vs gross" question — are publicly-stated claims, so getting them wrong proves the wrong theorem and embarrasses the project.

**Once specs are frozen, Phase B + C is 2–3 days of work for the operator agent (me) plus Aristotle wall-clock.**

