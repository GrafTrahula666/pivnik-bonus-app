-- Halloween "Night of Cauldrons" raffle: pumpkin-ticket ledger, balances, one draw with a frozen
-- snapshot of everyone's tickets and the recorded result (1st, 2nd, 3rd place and 5 participation frames). MANUAL migration: it is intentionally NOT in
-- migration-startup-policy.js. Apply it with the reviewed operator procedure before the
-- theme flag and the raffle API are switched on.
--
-- Invariants (enforced in halloween-raffle.js, all inside one transaction per operation):
--   * halloween_ticket_ledger is append-only; source_key is UNIQUE so an event can never apply twice.
--   * halloween_ticket_balance is a cache equal to SUM(ledger.delta) per user.
--   * tickets are never spent: every ticket a person holds when the draw closes is one chance.

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

CREATE TABLE IF NOT EXISTS halloween_draw (
  id TEXT PRIMARY KEY CHECK (id = 'night-of-cauldrons'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'drawn')),
  closes_at TIMESTAMPTZ NOT NULL,
  snapshot_hash TEXT,
  seed TEXT,
  results JSONB,
  drawn_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS halloween_draw_snapshot (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tickets INTEGER NOT NULL CHECK (tickets > 0)
);

-- closes_at is an ASSUMPTION (31 Oct 2026, 20:00 Moscow) until the owner confirms the draw time.
INSERT INTO halloween_draw (id, closes_at) VALUES ('night-of-cauldrons', '2026-10-31T20:00:00+03:00')
ON CONFLICT (id) DO NOTHING;
