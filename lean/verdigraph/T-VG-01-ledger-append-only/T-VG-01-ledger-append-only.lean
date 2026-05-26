/-
Viridis Operator Layer — T-VG-01: Ledger Append-Only
====================================================

Corpus parent:    none — Verdigraph-native substrate
Catalog entry:    docs/lean_formalization_scope.md §T-VG-01
Tier:             S (substrate for T-VG-02 and T-VG-03; without this, neither
                  conservation nor pruning safety proofs carry any weight)

Statement:
  For any DevelopmentalLedger L and any ledger operation op, applying op to L
  yields a ledger L' such that L.events is a prefix of L'.events. No event in
  L's history is ever modified, removed, or reordered.

Operational use:
  This is the trust substrate for the Verdigraph audit trail. The 25%
  conservation accrual line items (recorded daily by the Viridis Operator
  agent) are only as trustworthy as the append-only property of the ledger
  they sit in.

Lean version:    leanprover/lean4:v4.28.0
Mathlib version: see lake-manifest.json

Aristotle status: STUB (spec defaults documented in ARISTOTLE_NOTES.md)
Co-authored-by: Aristotle (Harmonic) <aristotle-harmonic@harmonic.fun>
-/

import Mathlib

namespace Verdigraph.LedgerAppendOnly

/-- A single event in the developmental ledger. Modeled as a value type so
    structural equality gives payload immutability for free.
    `timestamp` is a rational (instead of `ℝ`) so we can decide equality and
    ordering by `omega`/`decide` where possible. -/
structure LedgerEvent where
  /-- Monotonic timestamp (seconds since some epoch; nat-valued for decidability). -/
  timestamp : Nat
  /-- Opaque payload; structural equality only. -/
  payload : String
  deriving DecidableEq, Repr

/-- The developmental ledger: a list of events with a monotone-timestamp
    invariant carried as part of the structure. -/
structure DevelopmentalLedger where
  events : List LedgerEvent
  /-- Timestamps are weakly monotone (newer events have ≥ timestamps). -/
  monotone_ts :
    ∀ i j : Fin events.length, i.val ≤ j.val →
      (events.get i).timestamp ≤ (events.get j).timestamp

/-- The empty ledger. -/
def empty : DevelopmentalLedger where
  events := []
  monotone_ts := by intro i; exact Fin.elim0 i

/-- Last timestamp of the ledger, or 0 if empty. -/
def lastTimestamp (L : DevelopmentalLedger) : Nat :=
  match h : L.events with
  | []      => 0
  | _ :: _  => (L.events.getLast (by simp [h])).timestamp

/-- The operations that can be applied to a ledger. -/
inductive LedgerOp where
  | noop
  | append (e : LedgerEvent)

/-- Apply an operation. Per Q1.1 default: an `append` with a timestamp earlier
    than the ledger's last is rejected (returns ledger unchanged). -/
def apply (L : DevelopmentalLedger) (op : LedgerOp) : DevelopmentalLedger :=
  match op with
  | .noop      => L
  | .append e  =>
    if h : lastTimestamp L ≤ e.timestamp then
      { events := L.events ++ [e]
        monotone_ts := by
          intro i j hij;
          by_cases hi : i.val < L.events.length <;> by_cases hj : j.val < L.events.length <;> simp_all +decide;
          · exact L.monotone_ts ⟨ i, hi ⟩ ⟨ j, hj ⟩ hij;
          · refine' le_trans _ h;
            unfold lastTimestamp;
            have := L.monotone_ts ⟨ i, by linarith ⟩ ⟨ L.events.length - 1, by omega ⟩ ; rcases L with ⟨ _ | ⟨ head, tail ⟩, h ⟩ <;> simp_all +decide [ List.getLast_eq_getElem ] ;
          · grind +revert }
    else
      L

/-! ## Main theorems

The three obligations Aristotle is asked to discharge. -/

/-- **T-VG-01.a (apply_preserves_prefix):** For any ledger L and any operation
    op, the resulting ledger's event list has L's event list as a prefix.
    This is the core append-only property. -/
theorem apply_preserves_prefix (L : DevelopmentalLedger) (op : LedgerOp) :
    L.events <+: (apply L op).events := by
  cases op <;> simp [Verdigraph.LedgerAppendOnly.apply];
  grind

/-- **T-VG-01.b (apply_never_shortens):** Length is monotone under apply. -/
theorem apply_never_shortens (L : DevelopmentalLedger) (op : LedgerOp) :
    L.events.length ≤ (apply L op).events.length := by
  convert List.IsPrefix.length_le ( apply_preserves_prefix L op ) using 1

/-- **T-VG-01.c (append_succ_or_noop):** An append either extends the ledger
    by exactly one event, or leaves it unchanged (when timestamp is stale). -/
theorem append_succ_or_noop (L : DevelopmentalLedger) (e : LedgerEvent) :
    (apply L (.append e)).events.length = L.events.length + 1
    ∨ (apply L (.append e)).events = L.events := by
  unfold apply;
  grind

end Verdigraph.LedgerAppendOnly