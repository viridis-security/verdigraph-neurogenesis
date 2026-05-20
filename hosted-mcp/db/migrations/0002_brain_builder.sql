-- 0002_brain_builder.sql
-- Adds the brain-builder shop: brains, builds, build_sessions, session_events.

-- ── Built brains (paid + free preview) ─────────────────────────────────
CREATE TABLE brains (
  brain_id          TEXT PRIMARY KEY,        -- deterministic from input bytes + format
  caller_id         TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  content_hash      TEXT NOT NULL,           -- sha256 of canonical body
  input_format      TEXT NOT NULL,
  input_sha256      TEXT NOT NULL,
  input_bytes       INTEGER NOT NULL,
  node_count        INTEGER NOT NULL,
  edge_count        INTEGER NOT NULL,
  agent_name        TEXT NOT NULL,
  artifact_r2_key   TEXT NOT NULL,           -- path inside STATE_BUCKET
  invariants_passed INTEGER NOT NULL,        -- 0|1
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_brains_caller ON brains(caller_id, created_at DESC);
CREATE INDEX idx_brains_hash   ON brains(content_hash);

-- ── Build receipts (paid unlocks, ties Stripe events -> brains) ────────
CREATE TABLE brain_builds (
  build_id              TEXT PRIMARY KEY,    -- ULID
  brain_id              TEXT NOT NULL REFERENCES brains(brain_id),
  caller_id             TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  product               TEXT NOT NULL,       -- 'single_brain_unlock' | 'unlimited_brains' | 'attestation'
  amount_usd_micros     INTEGER NOT NULL,
  stripe_session_id     TEXT,
  status                TEXT NOT NULL,       -- 'pending' | 'paid' | 'refunded' | 'free'
  created_at            INTEGER NOT NULL,
  CHECK (status IN ('pending','paid','refunded','free')),
  CHECK (product IN ('single_brain_unlock','unlimited_brains','attestation','free_preview'))
);
CREATE INDEX idx_builds_brain  ON brain_builds(brain_id, created_at DESC);
CREATE INDEX idx_builds_caller ON brain_builds(caller_id, created_at DESC);

-- ── Live build sessions (web UI <-> agent pairing) ──────────────────────
CREATE TABLE build_sessions (
  session_id       TEXT PRIMARY KEY,         -- ULID, shown in the URL
  pairing_code     TEXT NOT NULL UNIQUE,     -- short code the human pastes into their agent
  caller_id        TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  status           TEXT NOT NULL,            -- 'awaiting_pair' | 'active' | 'closed'
  current_brain_id TEXT REFERENCES brains(brain_id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  paired_at        INTEGER,
  closed_at        INTEGER,
  CHECK (status IN ('awaiting_pair','active','closed'))
);
CREATE INDEX idx_sessions_pairing ON build_sessions(pairing_code);
CREATE INDEX idx_sessions_caller  ON build_sessions(caller_id, created_at DESC);

-- ── Event log per session (SSE replay + audit) ──────────────────────────
CREATE TABLE session_events (
  event_id    TEXT PRIMARY KEY,              -- ULID
  session_id  TEXT NOT NULL REFERENCES build_sessions(session_id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,              -- monotonic per session
  kind        TEXT NOT NULL,                 -- 'tool_call_start' | 'tool_call_result' | 'tool_call_error' | 'invariant_report' | 'note'
  tool        TEXT,
  payload     TEXT NOT NULL,                 -- JSON
  occurred_at INTEGER NOT NULL
);
CREATE INDEX idx_events_session_seq ON session_events(session_id, seq);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (2, strftime('%s','now') * 1000, 'brain-builder shop: brains, builds, sessions, session_events');
