-- 0004_attestations.sql — compliance attestation tier.
--
-- Invariants:
--   C1 attestation rows are signed; signature stored as base64
--   C2 immutable + idempotent: one row per (brain_id, content_hash, tier)
--   C3 attestation refused if any brain invariant fails (app-side gate)
--   C4 tiers: preview|standard|enterprise
--   C5 public verify endpoint re-runs invariants + checks signature
--   C6 private signing key is a Worker secret; public key is exposed
--   C7 25% conservation goes through the existing routing-revenue cron
--      (NOT the marketplace 10% ledger). Tracked via brain_builds.product='attestation'.

CREATE TABLE attestations (
  attestation_id    TEXT PRIMARY KEY,                -- ULID
  brain_id          TEXT NOT NULL REFERENCES brains(brain_id),
  content_hash      TEXT NOT NULL,
  tier              TEXT NOT NULL,                   -- 'standard' | 'enterprise'
  issuer            TEXT NOT NULL,                   -- 'Viridis Security'
  issued_at         INTEGER NOT NULL,
  server_version    TEXT NOT NULL,
  signature_b64     TEXT NOT NULL,                   -- Ed25519 sig over canonical body
  body_r2_key       TEXT NOT NULL,                   -- attestations/{id}.json
  buyer_caller_id   TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  stripe_session_id TEXT UNIQUE,
  CHECK (tier IN ('standard','enterprise'))
);
-- One attestation per (brain, hash, tier).
CREATE UNIQUE INDEX idx_attestations_unique ON attestations(brain_id, content_hash, tier);
CREATE INDEX idx_attestations_buyer ON attestations(buyer_caller_id, issued_at DESC);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (4, strftime('%s','now') * 1000, 'compliance attestation tier: signed JSON + public verify');
