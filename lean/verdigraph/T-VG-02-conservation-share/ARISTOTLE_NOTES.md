# T-VG-02 — Spec Defaults

These defaults were adopted by the Viridis Operator on 2026-05-26 to unblock
Aristotle. They are reasonable interpretations consistent with SKILL.md
("net completed-payment revenue") and the Stripe catalog in
`examples/viridis_operator.genome.json`. Override if business reality differs.

## Q2.1 — Net revenue definition

**Default:** `net = gross - stripe_fee - refunds`.

This is standard SaaS net-revenue accounting: gross is the customer charge,
Stripe takes its fee, refunds reduce what Viridis keeps. Conservation share is
applied to what Viridis actually keeps before any other allocation.

**Alternative not adopted:** `net = gross - refunds` (Viridis absorbs the
Stripe fee). If the public claim or accounting policy uses this alternative,
remove the `stripe_fee_cents` field from `RevenueEvent` and `netRevenue` and
the proofs still close (they're parameterized over `netRevenue`).

## Q2.2 — Rounding semantics

**Default:** Integer-cent floor: `conservationShare = netRevenue / 4`
(Nat division = floor).

This is the simplest provable invariant and what the theorems below state.
The residual (up to 3 cents per event) stays in the retained bucket.

**Alternative not adopted:** Accumulate the residual into the next period.
Provable but messier; defer unless legal/accounting requires it.

## Q2.3 — Currency

**Default:** USD only. All Stripe catalog products are USD-denominated.
Multi-currency conservation (with FX drift) is deferred to a future theorem
(T-VG-02b: "conservation share exactness under FX conversion").

## Q2.4 — "25% of NET" is the public claim

**Confirmed:** SKILL.md says "25% of net completed-payment revenue."
Verify against landing page copy and registry submission before merging.
