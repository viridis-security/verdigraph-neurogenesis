/-
Viridis Operator Layer — T-VG-03: Pruning Protected-Set Invariance
==================================================================

Corpus parent:    none directly (closest sibling: T-IB-09 adversarial dissipation)
Catalog entry:    docs/lean_formalization_scope.md §T-VG-03
Tier:             A (agent safety axiom — required for any "Verdigraph won't
                  prune its own core" trust claim)

Statement:
  For any CognitiveGraph G, any set P ⊆ G.nodes of protected nodes, and
  any well-formed pruning operation prune, P ⊆ (prune G P).nodes. The
  transitive closure pruneStar preserves the same invariant.

Operational use:
  This is the formal statement of the operator agent's "safety_axioms.
  protected_nodes" guarantee in `verdigraph_state/viridis-operator.json`.
  Nodes like `github_router`, `verdigraph_router`, `payment_processor` are
  declared protected and must remain in the cognitive graph across all
  pruning passes.

Lean version:    leanprover/lean4:v4.28.0
Mathlib version: see lake-manifest.json

Aristotle status: STUB (spec defaults documented in ARISTOTLE_NOTES.md)
Co-authored-by: Aristotle (Harmonic) <aristotle-harmonic@harmonic.fun>
-/

import Mathlib

namespace Verdigraph.PruningProtected

/-- Opaque node identifiers. Strings in practice; modeled abstractly here so
    Aristotle isn't sidetracked by string lemmas. -/
abbrev NodeId := Nat

/-- A weighted directed edge. -/
structure Edge where
  src : NodeId
  dst : NodeId
  weight : ℚ
  deriving DecidableEq, Repr

/-- The cognitive graph: a finite set of nodes and a finite set of weighted
    edges. -/
structure CognitiveGraph where
  nodes : Finset NodeId
  edges : Finset Edge
  /-- Endpoints of every edge are in the node set. -/
  edges_valid : ∀ e ∈ edges, e.src ∈ nodes ∧ e.dst ∈ nodes

/-- The growth rules from the agent genome — only the pruning-relevant fields. -/
structure GrowthRules where
  /-- Edges with weight below this are eligible for pruning. -/
  prune_below_weight : ℚ
  -- A node becomes prunable when all of its incident edges are.
  -- (Other genome fields like create_node_when_task_repeats are not used here.)

/-- One pruning step: remove a single non-protected node whose all-incident-
    edges fall below `prune_below_weight`. If no such node exists, return G. -/
def pruneStep (G : CognitiveGraph) (rules : GrowthRules)
    («protected» : Finset NodeId) : CognitiveGraph := by
  -- The implementation: find a node n ∈ G.nodes \ protected such that all
  -- edges incident to n have weight < rules.prune_below_weight. If found,
  -- remove n and all its incident edges. Otherwise, return G.
  exact G  -- placeholder — Aristotle should not need to fill this in; the
           -- theorems below are about ANY pruning step that respects the
           -- spec, not this specific implementation.

/-- The transitive closure: repeated pruning to a fixed point. Bounded by
    `nodes.card` iterations per Q3.1. -/
def pruneStar (G : CognitiveGraph) (rules : GrowthRules)
    («protected» : Finset NodeId) : CognitiveGraph :=
  Nat.rec G (fun _ acc => pruneStep acc rules «protected») G.nodes.card

/-! ## Main theorems

We prove invariance under the SPEC of pruning (never removes a protected node
and never adds edges), not under the specific `pruneStep` implementation
above. This way the theorems remain true if the Python implementation
changes, as long as the spec holds. -/

/-- A pruning step is "spec-conforming" if (a) it never removes a protected
    node, (b) it never adds edges, (c) it preserves the `edges_valid`
    invariant (which is automatic from the structure). -/
def SpecConforming (step : CognitiveGraph → CognitiveGraph) («protected» : Finset NodeId) : Prop :=
  ∀ G : CognitiveGraph,
    («protected» ⊆ G.nodes → «protected» ⊆ (step G).nodes) ∧
    (step G).nodes ⊆ G.nodes ∧
    (step G).edges ⊆ G.edges

/-
**T-VG-03.a (protected_invariance):** For any spec-conforming single
    pruning step, the protected set is preserved.
-/
theorem protected_invariance
    (G : CognitiveGraph) («protected» : Finset NodeId)
    (h_sub : «protected» ⊆ G.nodes)
    (step : CognitiveGraph → CognitiveGraph)
    (h_spec : SpecConforming step «protected») :
    «protected» ⊆ (step G).nodes := by
  exact h_spec G |>.1 h_sub

/-
**T-VG-03.b (protected_invariance_iter):** Iterating a spec-conforming
    pruning step preserves the protected set at every iteration count.
-/
theorem protected_invariance_iter
    (G : CognitiveGraph) («protected» : Finset NodeId)
    (h_sub : «protected» ⊆ G.nodes)
    (step : CognitiveGraph → CognitiveGraph)
    (h_spec : SpecConforming step «protected») :
    ∀ n : Nat, «protected» ⊆ (Nat.rec (motive := fun _ => CognitiveGraph) G (fun _ acc => step acc) n).nodes := by
  -- We proceed by induction on n.
  intro n
  induction' n with n ih;
  · assumption;
  · exact h_spec _ |>.1 ih

/-
**T-VG-03.c (nodes_monotone):** Pruning never adds nodes — the node set
    shrinks (or stays the same) at each step.
-/
theorem nodes_monotone
    (G : CognitiveGraph)
    (step : CognitiveGraph → CognitiveGraph)
    («protected» : Finset NodeId)
    (h_spec : SpecConforming step «protected») :
    (step G).nodes ⊆ G.nodes := by
  exact h_spec G |>.2.1

/-
**T-VG-03.d (edges_monotone):** Pruning never adds edges.
-/
theorem edges_monotone
    (G : CognitiveGraph)
    (step : CognitiveGraph → CognitiveGraph)
    («protected» : Finset NodeId)
    (h_spec : SpecConforming step «protected») :
    (step G).edges ⊆ G.edges := by
  exact h_spec G |>.2.2

end Verdigraph.PruningProtected