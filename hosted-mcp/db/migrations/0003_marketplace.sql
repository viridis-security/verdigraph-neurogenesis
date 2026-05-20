-- 0003_marketplace.sql — published brains marketplace + 70/20/10 revenue split.
--
-- Invariants (enforced by CHECKs or app logic referenced in comments):
--   M1 only creator can publish (app-side: caller_id == brains.caller_id)
--   M2 publish price 0..99 USD inclusive
--   M3 forks reference parent_brain_id; cycles prevented app-side
--   M4 purchase splits sum to net_after_stripe_micros (DB CHECK)
--   M5 conservation pool captures rounding so split is exact
--   M6 purchases insert into brain_builds with status='paid' so isBrainUnlocked
--      treats marketplace purchases identically to single_brain_unlock
--   M7 listings are public; brain artifact still gated by brain_builds
--   M8 marketplace conservation is a SEPARATE ledger from routing-revenue 25%

CREATE TABLE marketplace_listings (
  listing_id            TEXT PRIMARY KEY,
  brain_id              TEXT NOT NULL REFERENCES brains(brain_id),
  creator_caller_id     TEXT NOT NULL REFERENCES callers(caller_id),
  parent_brain_id       TEXT REFERENCES brains(brain_id),     -- non-null for forks
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  price_usd_micros      INTEGER NOT NULL,                     -- 0..99_000_000
  status                TEXT NOT NULL,                        -- 'published'|'unpublished'
  view_count            INTEGER NOT NULL DEFAULT 0,
  purchase_count        INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK (price_usd_micros >= 0 AND price_usd_micros <= 99000000),
  CHECK (status IN ('published','unpublished'))
);
CREATE INDEX idx_listings_status   ON marketplace_listings(status, created_at DESC);
CREATE INDEX idx_listings_creator  ON marketplace_listings(creator_caller_id, created_at DESC);
CREATE INDEX idx_listings_brain    ON marketplace_listings(brain_id);
CREATE INDEX idx_listings_parent   ON marketplace_listings(parent_brain_id);

CREATE TABLE marketplace_purchases (
  purchase_id              TEXT PRIMARY KEY,
  listing_id               TEXT NOT NULL REFERENCES marketplace_listings(listing_id),
  brain_id                 TEXT NOT NULL REFERENCES brains(brain_id),
  buyer_caller_id          TEXT NOT NULL REFERENCES callers(caller_id),
  creator_caller_id        TEXT NOT NULL REFERENCES callers(caller_id),
  stripe_session_id        TEXT UNIQUE,
  gross_usd_micros         INTEGER NOT NULL,
  stripe_fee_usd_micros    INTEGER NOT NULL,
  net_usd_micros           INTEGER NOT NULL,
  creator_share_micros     INTEGER NOT NULL,
  viridis_share_micros     INTEGER NOT NULL,
  conservation_share_micros INTEGER NOT NULL,
  status                   TEXT NOT NULL,                     -- 'pending'|'paid'|'refunded'
  created_at               INTEGER NOT NULL,
  -- M4 sum invariant.
  CHECK (creator_share_micros + viridis_share_micros + conservation_share_micros = net_usd_micros),
  -- M5 ratios (with rounding caught by conservation pool).
  CHECK (creator_share_micros = net_usd_micros * 70 / 100),
  CHECK (viridis_share_micros = net_usd_micros * 20 / 100),
  CHECK (status IN ('pending','paid','refunded'))
);
CREATE INDEX idx_purchases_buyer    ON marketplace_purchases(buyer_caller_id, created_at DESC);
CREATE INDEX idx_purchases_listing  ON marketplace_purchases(listing_id, created_at DESC);
CREATE INDEX idx_purchases_creator  ON marketplace_purchases(creator_caller_id, created_at DESC);

CREATE TABLE marketplace_creator_balances (
  caller_id                  TEXT PRIMARY KEY REFERENCES callers(caller_id),
  owed_usd_micros            INTEGER NOT NULL DEFAULT 0,
  lifetime_paid_usd_micros   INTEGER NOT NULL DEFAULT 0,
  updated_at                 INTEGER NOT NULL
);

CREATE TABLE marketplace_conservation_ledger (
  entry_id                  TEXT PRIMARY KEY,
  purchase_id               TEXT NOT NULL REFERENCES marketplace_purchases(purchase_id),
  share_usd_micros          INTEGER NOT NULL,
  period_yyyymm             INTEGER NOT NULL,    -- 202605 etc., for monthly rollup
  payout_status             TEXT NOT NULL,        -- 'pending'|'sent'|'failed'
  stripe_transfer_id        TEXT,
  created_at                INTEGER NOT NULL,
  CHECK (payout_status IN ('pending','sent','failed'))
);
CREATE INDEX idx_marketplace_cons_period ON marketplace_conservation_ledger(period_yyyymm, payout_status);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (3, strftime('%s','now') * 1000, 'marketplace: listings, purchases, creator balances, separate conservation ledger');
