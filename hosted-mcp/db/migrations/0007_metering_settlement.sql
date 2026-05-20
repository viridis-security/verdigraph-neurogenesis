-- 0007_metering_settlement.sql — iter4 H1: exactly-once metering.
--
-- Adds an explicit settlement_state to usage_ledger.
--
-- Background: meteredCall now *reserves* a usage_ledger row (claiming the
-- UNIQUE (caller_id, request_id) slot) BEFORE any credit debit. The unique
-- index elects exactly one winner; concurrent or retried calls observe the
-- conflict and never debit. A reserved-but-not-yet-billed row must be
-- distinguishable from a fully settled row — that is what settlement_state is:
--   'pending'  — row reserved, winner still quoting/running/finalizing
--   'settled'  — row finalized (success or failure); charge is final
--
-- Every row that existed before this migration is, by definition, fully
-- settled, so the column DEFAULTs to 'settled' and the backfill is implicit.

ALTER TABLE usage_ledger
  ADD COLUMN settlement_state TEXT NOT NULL DEFAULT 'settled'
  CHECK (settlement_state IN ('pending','settled'));

-- Partial index: lets a sweeper find rows stranded in 'pending' (e.g. a Worker
-- evicted mid-call) without scanning the whole append-only ledger.
CREATE INDEX idx_ledger_pending
  ON usage_ledger(occurred_at)
  WHERE settlement_state = 'pending';

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (7, strftime('%s','now') * 1000, 'iter4 H1: usage_ledger.settlement_state for exactly-once metering');
