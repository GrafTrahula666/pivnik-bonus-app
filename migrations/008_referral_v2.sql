-- Referral v2: 24h attach window, 72h qualifying window, 500 RUB real spend.
-- Executed once by universal-server.js schema_migrations runner.

CREATE TABLE IF NOT EXISTS referral_codes (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (code = UPPER(code))
);

CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  inviter_user_id BIGINT NOT NULL REFERENCES users(id),
  invited_user_id BIGINT NOT NULL REFERENCES users(id),
  referral_code TEXT NOT NULL,
  invited_registered_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  qualified_deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rewarded', 'expired')),
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT referrals_one_inviter_per_user UNIQUE (invited_user_id),
  CONSTRAINT referrals_no_self_referral CHECK (inviter_user_id <> invited_user_id),
  CONSTRAINT referrals_deadline_exact
    CHECK (qualified_deadline = applied_at + INTERVAL '72 hours')
);

CREATE INDEX IF NOT EXISTS idx_referrals_inviter
  ON referrals(inviter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_active_deadline
  ON referrals(qualified_deadline)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_transactions_referral_qualifying
  ON transactions(client_id, completed_at)
  WHERE status = 'completed'
    AND mode IN ('accrue', 'redeem')
    AND cash_paid_cents > 0;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_mode_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_mode_check
  CHECK (
    mode IN (
      'accrue',
      'redeem',
      'adjustment',
      'beer_gift',
      'welcome',
      'shop',
      'achievement',
      'referral'
    )
  );

-- Replace the stale "coming soon" referral promo from the previous specification.
UPDATE promotions
SET
  title = 'Пригласить друга',
  description = 'Пригласи друга — получишь 100 бонусов. Друг получит 50 бонусов. Ему нужно ввести твой код в первый день после регистрации и за следующие 3 дня купить в Пивнике в общей сложности на 500 ₽.',
  badge = '100 Б + 50 Б',
  active = TRUE,
  updated_at = NOW()
WHERE code = 'referral-beta';
