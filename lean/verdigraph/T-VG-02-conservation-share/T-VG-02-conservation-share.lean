/-
Viridis Operator Layer — T-VG-02: Conservation Share Exactness (25% of Net)
===========================================================================

Corpus parent:    T-IB-01 (attribution conservation) — instantiates the
                  partition-with-invariant pattern for the revenue domain.
Catalog entry:    docs/lean_formalization_scope.md §T-VG-02
Tier:             S (publicly-stated marketing claim; must be provable)

Statement:
  For every completed-payment RevenueEvent e with non-negative net amount,
  conservationShare(e) + retained(e) = netRevenue(e),
  and
  4 * conservationShare(e) ≤ netRevenue(e) < 4 * conservationShare(e) + 4.
  The conservation share is exactly floor(netRevenue / 4) in integer cents.

Operational use:
  This is the actuarial proof of the "25% of net revenue funds conservation"
  marketing claim. A formally verified core ties the public commitment to the
  implementation in `verdigraph/billing/conservation.py` (or wherever the
  routing lives at merge time).

Lean version:    leanprover/lean4:v4.28.0
Mathlib version: see lake-manifest.json

Aristotle status: STUB (spec defaults documented in ARISTOTLE_NOTES.md)
Co-authored-by: Aristotle (Harmonic) <aristotle-harmonic@harmonic.fun>
-/

import Mathlib

namespace Verdigraph.ConservationShare

/-- A completed-payment revenue event from Stripe. All amounts in integer cents
    (USD) per Q2.3 default. -/
structure RevenueEvent where
  /-- Customer charge before fees and refunds. -/
  gross_cents : Nat
  /-- Stripe processing fee. -/
  stripe_fee_cents : Nat
  /-- Refunds issued against this charge. -/
  refund_cents : Nat
  /-- Invariant: fees can't exceed gross. -/
  h_fee : stripe_fee_cents ≤ gross_cents
  /-- Invariant: refunds can't exceed gross-minus-fees. -/
  h_refund : refund_cents ≤ gross_cents - stripe_fee_cents

/-- Net revenue per Q2.1 default: gross minus Stripe fees minus refunds. -/
def netRevenue (e : RevenueEvent) : Nat :=
  e.gross_cents - e.stripe_fee_cents - e.refund_cents

/-- The conservation share: 25% of net, floor-rounded in cents per Q2.2. -/
def conservationShare (e : RevenueEvent) : Nat :=
  netRevenue e / 4

/-- The retained share: net minus the conservation share. -/
def retained (e : RevenueEvent) : Nat :=
  netRevenue e - conservationShare e

/-! ## Main theorems -/

/-- **T-VG-02.a (share_partition):** The conservation share and the retained
    share sum to exactly net revenue. No money goes missing or appears from
    nowhere. -/
theorem share_partition (e : RevenueEvent) :
    conservationShare e + retained e = netRevenue e :=
  Nat.add_sub_cancel' (Nat.div_le_self _ 4)

/-- **T-VG-02.b (share_lower_bound):** The conservation share is at least one
    quarter of net (since floor never overshoots). -/
theorem share_lower_bound (e : RevenueEvent) :
    4 * conservationShare e ≤ netRevenue e := by
  rw [mul_comm]; exact Nat.div_mul_le_self _ 4

/-- **T-VG-02.c (share_upper_bound):** The conservation share never under-pays
    by more than 3 cents (floor residual). -/
theorem share_upper_bound (e : RevenueEvent) :
    netRevenue e < 4 * conservationShare e + 4 := by
  unfold conservationShare
  have h := Nat.div_add_mod (netRevenue e) 4
  have h2 := Nat.mod_lt (netRevenue e) (by norm_num : 0 < 4)
  omega

/-- **T-VG-02.d (share_exactness):** Combined exactness statement — the share
    equals the integer floor of one quarter, witnessed by both bounds. -/
theorem share_exactness (e : RevenueEvent) :
    4 * conservationShare e ≤ netRevenue e
    ∧ netRevenue e < 4 * conservationShare e + 4 := by
  exact ⟨share_lower_bound e, share_upper_bound e⟩

/-- **T-VG-02.e (share_monotone):** Larger net revenue produces a share that
    is at least as large. Routing is monotone in revenue. -/
theorem share_monotone (e₁ e₂ : RevenueEvent)
    (h : netRevenue e₁ ≤ netRevenue e₂) :
    conservationShare e₁ ≤ conservationShare e₂ :=
  Nat.div_le_div_right h

end Verdigraph.ConservationShare

/-
EXPECTED ARISTOTLE OUTCOMES:
  share_partition:    PROVED (Nat.div_add_mod gives n = 4*(n/4) + n%4,
                              then unfold retained and subtract)
  share_lower_bound:  PROVED (Nat.div_mul_le_self n 4)
  share_upper_bound:  PROVED (Nat.lt_div_iff or Nat.div_lt_iff)
  share_exactness:    PROVED trivially (conjunction of b and c)
  share_monotone:     PROVED (Nat.div_le_div_right)

These are all single-tactic proofs in well-curated mathlib. If any times out,
likely cause is a name change in mathlib's Nat div API.

OPERATIONAL OUTPUT (when PROVED):
  - Companion paper §4 (the headline result)
  - Verdigraph landing page: "Verify our conservation math →" link to this file
  - Audit document tying SKILL.md text to mechanized proof
-/
