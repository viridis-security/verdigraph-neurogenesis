-- 0005_marketplace_visibility.sql — Iter3 P0.1: brain_publish.visibility
--
-- Invariants:
--   - 'public' (default for backward compat) appears in brain_search
--   - 'unlisted' does NOT appear in brain_search; brain_get_listing returns
--     metadata only when caller_id == creator_caller_id (404 for others)
--   - re-publishing same brain_id with different visibility flips in place,
--     preserving Stripe linkage + fork lineage + attestation state

ALTER TABLE marketplace_listings ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

-- Backfill existing rows defensively (DEFAULT handles new ones).
UPDATE marketplace_listings SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';

CREATE INDEX idx_listings_visibility ON marketplace_listings(visibility, status, created_at DESC);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (5, strftime('%s','now') * 1000, 'iter3: marketplace visibility (public|unlisted)');
