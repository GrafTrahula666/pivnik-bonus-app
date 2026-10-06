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
    'wheel', 'quest', 'purchase', 'purchase_revoke', 'invite', 'invite_revoke', 'entry', 'admin'
  )),
  source_key TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Re-runnable widening of the reason list for a database that ran an earlier draft of this file.
ALTER TABLE halloween_ticket_ledger DROP CONSTRAINT IF EXISTS halloween_ticket_ledger_reason_check;
ALTER TABLE halloween_ticket_ledger ADD CONSTRAINT halloween_ticket_ledger_reason_check CHECK (reason IN (
  'wheel', 'quest', 'purchase', 'purchase_revoke', 'invite', 'invite_revoke', 'entry', 'admin'
));

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

-- "Invite a friend" (halloween-invite.js).
-- One stable code per user: HMAC of the user id with the server session secret, base32, stored here on
-- first use so it never changes afterwards (even if the secret is rotated).
CREATE TABLE IF NOT EXISTS halloween_invite_code (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-7]{8,16}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One inviter per invitee, forever (invitee_id is the primary key). The inviter earns 1 ticket on the
-- invitee's first completed purchase, at most 3 per ISO week (bar clock) counted by week_key of status
-- 'qualified'. 'capped' = the week was already full when the friend bought; 'revoked' = the qualifying
-- purchase was cancelled and the ticket taken back.
CREATE TABLE IF NOT EXISTS halloween_invite (
  invitee_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inviter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('telegram_start_param', 'claim')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'qualified', 'capped', 'revoked')),
  qualifying_tx_id BIGINT,
  week_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (invitee_id <> inviter_id)
);

CREATE INDEX IF NOT EXISTS idx_halloween_invite_inviter_week
  ON halloween_invite(inviter_id, week_key) WHERE status = 'qualified';
