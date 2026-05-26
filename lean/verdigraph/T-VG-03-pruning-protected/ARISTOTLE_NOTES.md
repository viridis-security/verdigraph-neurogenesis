# T-VG-03 — Spec Defaults

These defaults were adopted by the Viridis Operator on 2026-05-26 to unblock
Aristotle. They are reasonable interpretations of `verdigraph/pruning.py` and
the `safety_axioms.protected_nodes` set in `verdigraph_state/viridis-operator.json`.

## Q3.1 — Pruning termination

**Default:** Termination via a well-founded measure on `nodes.card`. Each
pruning step strictly decreases the node count (or returns the graph
unchanged when no eligible candidate exists). The `pruneStar` fixed-point is
reached within `nodes.card` iterations.

## Q3.2 — Edges to protected nodes

**Default:** Pruning a non-protected node removes all incident edges
(including those to protected nodes). Protected nodes are never selected
for removal in the first place, so their incidence with other protected
nodes is preserved; their incidence with non-protected nodes that get
pruned is severed.

This matches the natural reading of `verdigraph/pruning.py`. Verify against
the Python source before merging.

## Q3.3 — Concurrent growth + pruning

**Default:** Per-step invariance only. The theorem proves that any single
pruning step (or the transitive closure of pruning steps) preserves the
protected set. Interleaving with growth steps is not modeled here — we
assume an alternation discipline.

A future T-VG-04 ("protected invariance under interleaved growth/prune")
can extend this.
