# Summary of changes for run aa3abc46-7fbd-41ef-b382-95860a5e08f8
All four sorry obligations in `T-VG-01-ledger-append-only.lean` have been discharged:

1. **`apply` / `monotone_ts`** (inside the `append` branch of `def apply`): Proved that appending an event with timestamp ≥ `lastTimestamp L` preserves the weak-monotonicity invariant. The proof case-splits on whether each index falls within the original list or points to the appended element, using `L.monotone_ts` for the original-events case and transitivity through `lastTimestamp` for the boundary case.

2. **`apply_preserves_prefix`**: The core append-only property — `L.events` is always a prefix of `(apply L op).events`. Proved by case-splitting on `op` and using `List.prefix_append`.

3. **`apply_never_shortens`**: Length monotonicity under `apply`. A direct corollary of `apply_preserves_prefix` via `List.IsPrefix.length_le`.

4. **`append_succ_or_noop`**: An append either extends the ledger by exactly one event or leaves it unchanged. Proved by unfolding `apply` and splitting on the timestamp guard.

The project builds cleanly with no warnings, no sorries, and only standard axioms (propext, Classical.choice, Quot.sound). No theorem signatures were weakened.