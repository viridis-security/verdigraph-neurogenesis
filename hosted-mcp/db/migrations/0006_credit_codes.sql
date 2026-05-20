-- 0006_credit_codes.sql — anonymous credit purchase + subscription metadata.
--
-- Invariants:
--   C-INV1 anonymous /credits purchase mints a redeemable code; existing
--          caller-attached topup path unchanged
--   C-INV5 codes are single-use; redemption is atomic (transactional UPDATE
--          gated on status='pending', then balance credit)
--   C-INV4 subscription cancellation does NOT zero the balance — unused credits
--          persist (just no future auto-refill)

CREATE TABLE credit_codes (
  code                TEXT PRIMARY KEY,         -- vdc_<24 char crockford>
  amount_usd_micros   INTEGER NOT NULL,
  status              TEXT NOT NULL,            -- 'pending' | 'redeemed' | 'refunded'
  buyer_email         TEXT,                     -- captured at Stripe checkout
  stripe_session_id   TEXT UNIQUE,              -- the checkout session that minted this
  redeemed_by_caller  TEXT REFERENCES callers(caller_id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  redeemed_at         INTEGER,
  CHECK (status IN ('pending','redeemed','refunded')),
  CHECK (amount_usd_micros > 0)
);
CREATE INDEX idx_credit_codes_status ON credit_codes(status, created_at DESC);
CREATE INDEX idx_credit_codes_email  ON credit_codes(buyer_email);

-- Subscription tracking — one row per active subscription per caller.
CREATE TABLE credit_subscriptions (
  subscription_id      TEXT PRIMARY KEY,        -- Stripe sub_xxx
  caller_id            TEXT NOT NULL REFERENCES callers(caller_id),
  monthly_amount_usd   INTEGER NOT NULL,        -- in dollars (whole), e.g. 20
  status               TEXT NOT NULL,           -- 'active' | 'cancelled' | 'past_due'
  current_period_end   INTEGER,                 -- unix ms
  total_credits_issued INTEGER NOT NULL DEFAULT 0,  -- micro-USD lifetime
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (status IN ('active','cancelled','past_due'))
);
CREATE INDEX idx_subscriptions_caller ON credit_subscriptions(caller_id, status);

INSERT INTO schema_migrations (version, applied_at, notes)
VALUES (6, strftime('%s','now') * 1000, 'iter4: credit_codes + credit_subscriptions for /credits anonymous + auto-refill');
