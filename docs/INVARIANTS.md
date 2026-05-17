# Verdigraph Invariants

1. Every cognitive structure must be inspectable.
2. Every growth event must be logged.
3. Every new node must have a purpose.
4. Every strengthened pathway must be tied to evaluation.
5. Every pruning action must preserve safety.
6. The agent may evolve routing, not foundational safety boundaries.
7. Growth must improve measured performance or remain reversible.
8. Different agents may develop different architectures.
9. Fixed infrastructure enforces logging, safety, and review.
10. Digital development should remain translatable to future physical substrates.
11. Agent routing should maximize successful task completion per unit compute.

## Practical checks in this repo

- Genome validation blocks malformed rules.
- Protected nodes cannot be removed if declared in the initial genome.
- New nodes require descriptions.
- Graph size is bounded by genome rules.
- All growth/pruning actions write ledger events.
- `ComputeOptimizer.choose_profile` refuses any compute profile whose `quality_score`
  is below the task's `min_quality`, preserving invariant 11 without silently
  degrading task quality to save compute.
