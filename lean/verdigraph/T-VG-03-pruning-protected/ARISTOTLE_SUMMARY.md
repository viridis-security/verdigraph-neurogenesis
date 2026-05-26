# Summary of changes for run 0f319ca9-a854-48af-a0ab-374952162903
All four theorems in `T-VG-03-pruning-protected.lean` have been proved:

1. **`protected_invariance`** — Direct projection from `SpecConforming`: `(h_spec G).1 h_sub`
2. **`protected_invariance_iter`** — Induction on `n`: base case uses `h_sub`, inductive step uses `(h_spec _).1 ih`
3. **`nodes_monotone`** — Direct projection: `(h_spec G).2.1`
4. **`edges_monotone`** — Direct projection: `(h_spec G).2.2`

**Syntax fix applied:** The identifier `protected` is a Lean 4 keyword, so all occurrences were escaped with guillemets (`«protected»`). This is a purely syntactic change — the definitions and theorem signatures are semantically identical. A stray double doc-comment in `GrowthRules` was also converted to a regular comment to fix a parse error.

**Verification:** The project builds successfully with no `sorry`, no warnings (other than unused variables in the placeholder `pruneStep`), and all axioms are standard (`propext`, `Quot.sound`).