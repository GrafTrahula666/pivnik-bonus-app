-- Halloween "Night of Cauldrons" raffle: pumpkin-ticket ledger, balances, cauldrons (raffles),
-- candles (entries) and recorded draws. MANUAL migration: it is intentionally NOT in
-- migration-startup-policy.js. Apply it with the reviewed operator procedure before the
-- theme flag and the raffle API are switched on.
--
-- Invariants (enforced in halloween-raffle.js, all inside one transaction per operation):
--   * halloween_ticket_ledger is append-only; source_key is UNIQUE so an event can never apply twice.
--   * halloween_ticket_balance is a cache equal to SUM(ledger.delta) per user.
--   * a candle purchase locks the balance row, the cauldron row and writes ledger + candles together.

CREATE TABLE IF NOT EXISTS halloween_ticket_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL CHECK (reason IN (
    'wheel', 'quest', 'purchase', 'purchase_revoke', 'entry', 'admin'
  )),
  source_key TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_halloween_ledger_user
  ON halloween_ticket_ledger(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS halloween_ticket_balance (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS halloween_raffles (
  id TEXT PRIMARY KEY CHECK (id IN ('light', 'medium', 'super')),
  title TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  winners_count INTEGER NOT NULL CHECK (winners_count > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'drawn')),
  closes_at TIMESTAMPTZ NOT NULL,
  entries_count INTEGER NOT NULL DEFAULT 0 CHECK (entries_count >= 0),
  entries_hash TEXT
);

CREATE TABLE IF NOT EXISTS halloween_raffle_entries (
  id BIGSERIAL PRIMARY KEY,
  raffle_id TEXT NOT NULL REFERENCES halloween_raffles(id),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  ledger_id BIGINT NOT NULL REFERENCES halloween_ticket_ledger(id),
  entry_no INTEGER NOT NULL CHECK (entry_no > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (raffle_id, entry_no)
);

CREATE INDEX IF NOT EXISTS idx_halloween_entries_user
  ON halloween_raffle_entries(raffle_id, user_id);

CREATE TABLE IF NOT EXISTS halloween_raffle_draws (
  raffle_id TEXT PRIMARY KEY REFERENCES halloween_raffles(id),
  seed TEXT NOT NULL,
  winners JSONB NOT NULL,
  reserves JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- closes_at is an ASSUMPTION (31 Oct 2026, 20:00 Moscow) until the owner confirms the draw time.
INSERT INTO halloween_raffles (id, title, price, winners_count, closes_at) VALUES
  ('light',  'Котелок Новичка', 1, 3, '2026-10-31T20:00:00+03:00'),
  ('medium', 'Котёл Ведьмы',    2, 2, '2026-10-31T20:00:00+03:00'),
  ('super',  'Чёрный Котёл',    3, 1, '2026-10-31T20:00:00+03:00')
ON CONFLICT (id) DO NOTHING;
