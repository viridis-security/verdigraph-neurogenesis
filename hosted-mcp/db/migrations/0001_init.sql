-- 0001_init.sql
-- Initial schema for verdigraph-ledger (Cloudflare D1).
-- All monetary values stored as integer micro-USD (1 micro = $0.000001) to avoid float dust.

PRAGMA foreign_keys = ON;

-- ─── identity ─────────────────────────────────────────────────────────────
CREATE TABLE callers (
  caller_id          TEXT PRIMARY KEY,                  -- ULID we mint at first auth
  display_name       TEXT NOT NULL,
  oauth_subject      TEXT NOT NULL UNIQUE,              -- 'sub' from external OIDC provider
  email              TEXT,
  stripe_customer_id TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL,                  -- unix ms
  updated_at         INTEGER NOT NULL
);

-- OAuth 2.1 dynamic client registration (MCP spec requirement).
CREATE TABLE oauth_clients (
  client_id                  TEXT PRIMARY KEY,
  client_secret_hash         TEXT,                       -- argon2id; NULL for public clients
  client_name                TEXT,
  redirect_uris              TEXT NOT NULL,              -- JSON array
  grant_types                TEXT NOT NULL,              -- JSON array
  response_types             TEXT NOT NULL,              -- JSON array
  token_endpoint_auth_method TEXT NOT NULL,
  created_by_caller          TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  created_at                 INTEGER NOT NULL
);

-- ─── usage ledger (append-only) ───────────────────────────────────────────
CREATE TABLE usage_ledger (
  id                       TEXT PRIMARY KEY,             -- ULID
  caller_id                TEXT NOT NULL REFERENCES callers(caller_id),
  tool_name                TEXT NOT NULL,
  request_id               TEXT NOT NULL,                -- idempotency token from caller
  model_used               TEXT,                         -- e.g., 'claude-haiku-4-5'
  input_tokens             INTEGER NOT NULL DEFAULT 0,
  output_tokens            INTEGER NOT NULL DEFAULT 0,
  model_cost_usd_micros    INTEGER NOT NULL DEFAULT 0,   -- passthrough
  routing_fee_usd_micros   INTEGER NOT NULL DEFAULT 0,   -- our margin
  total_charged_usd_micros INTEGER NOT NULL DEFAULT 0,
  latency_ms               INTEGER NOT NULL,
  success                  INTEGER NOT NULL,             -- 0 | 1
  error_code               TEXT,
  occurred_at              INTEGER NOT NULL,             -- unix ms
  stripe_usage_event_id    TEXT
);
CREATE INDEX        idx_ledger_caller_time ON usage_ledger(caller_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_ledger_request_id  ON usage_ledger(caller_id, request_id);

-- ─── pre-paid credits (optional path) ─────────────────────────────────────
CREATE TABLE credit_balances (
  caller_id          TEXT PRIMARY KEY REFERENCES callers(caller_id),
  balance_usd_micros INTEGER NOT NULL DEFAULT 0,
  updated_at         INTEGER NOT NULL
);

-- ─── Stripe webhook reconciliation log ────────────────────────────────────
CREATE TABLE stripe_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      TEXT NOT NULL,                            -- raw JSON
  received_at  INTEGER NOT NULL,
  processed_at INTEGER,
  error        TEXT
);
CREATE INDEX idx_stripe_unprocessed ON stripe_events(received_at) WHERE processed_at IS NULL;

-- ─── 25% conservation routing (audit trail) ───────────────────────────────
CREATE TABLE conservation_payouts (
  id                            TEXT PRIMARY KEY,
  period_start                  INTEGER NOT NULL,        -- unix ms inclusive
  period_end                    INTEGER NOT NULL,        -- unix ms exclusive
  gross_revenue_usd_micros      INTEGER NOT NULL,
  passthrough_cost_usd_micros   INTEGER NOT NULL,
  net_revenue_usd_micros        INTEGER NOT NULL,        -- gross minus passthrough
  conservation_share_usd_micros INTEGER NOT NULL,        -- 25% of net (CHECK enforces)
  recipient                     TEXT NOT NULL,
  stripe_transfer_id            TEXT,
  status                        TEXT NOT NULL,           -- pending|sent|failed
  notes                         TEXT,
  created_at                    INTEGER NOT NULL,
  CHECK (conservation_share_usd_micros = net_revenue_usd_micros / 4),
  CHECK (status IN ('pending','sent','failed'))
);
CREATE INDEX idx_conservation_period ON conservation_payouts(period_start, period_end);

-- ─── meta: track applied migrations ───────────────────────────────────────
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  notes      TEXT
);
INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (1, strftime('%s','now') * 1000, 'initial verdigraph-ledger schema');
