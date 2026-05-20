-- 0008_conservation_multistream.sql — iter4 H2: conservation cron counts all
-- revenue streams.
--
-- Before iter4 the monthly conservation cron aggregated usage_ledger (per-call
-- routing fees) ONLY. Brain unlocks and attestations (brain_builds) and
-- marketplace sales (marketplace_purchases / marketplace_conservation_ledger)
-- were never counted, so the public "25% of net revenue funds conservation"
-- claim was inaccurate and marketplace_conservation_ledger rows accrued
-- 'pending' forever with no consumer.
--
-- This migration gives marketplace_conservation_ledger rows a consumer: the
-- monthly payout. Each row, once folded into a conservation_payouts run, is
-- linked to that payout via conservation_payout_id — so every marketplace
-- conservation entry is traceable to the payout that accounted for it.
--
-- The column is nullable (rows created before a payout are NULL until the next
-- cron run links them) and references conservation_payouts(id); a NULL default
-- is required for ADD COLUMN of a REFERENCES column under foreign_keys = ON.

ALTER TABLE marketplace_conservation_ledger
  ADD COLUMN conservation_payout_id TEXT REFERENCES conservation_payouts(id);

CREATE INDEX idx_marketplace_cons_payout
  ON marketplace_conservation_ledger(conservation_payout_id);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (8, strftime('%s','now') * 1000, 'iter4 H2: link marketplace_conservation_ledger rows to conservation_payouts');
