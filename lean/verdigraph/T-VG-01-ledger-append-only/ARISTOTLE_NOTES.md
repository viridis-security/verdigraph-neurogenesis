# T-VG-01 — Spec Defaults

These defaults were adopted by the Viridis Operator on 2026-05-26 to unblock
Aristotle. They are reasonable interpretations of the underlying Python code in
`verdigraph/ledger.py` and `verdigraph/agent.py`. Override if business or
implementation reality differs.

## Q1.1 — Out-of-order append handling

**Default:** `apply` returns the unchanged ledger (noop) when given an event
whose timestamp precedes the most recent event in the ledger. This preserves
the `monotone_ts` invariant unconditionally.

**Alternative not adopted:** raise an error or panic. The proof can be adapted
trivially if you prefer the error-raising shape; just change `apply`'s body and
the proof should still close via `linarith`/`omega`.

## Q1.2 — Concurrency model

**Default:** Single-writer. The operator agent is the only entity that calls
`apply`; concurrent writes are out of scope for T-VG-01. A future T-VG-04
("ledger linearizability under concurrent writers") can extend this.

## Q1.3 — Payload immutability

**Default:** `LedgerEvent` is modeled as a value type (structural equality).
Structural append-only therefore proves payload immutability automatically.
There is no extra obligation in this project.
