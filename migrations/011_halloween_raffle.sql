-- Halloween "Night of Cauldrons" raffle: pumpkin-ticket ledger, numbered tickets, balances, one draw with a
-- frozen snapshot of every active ticket number and the recorded result (1st, 2nd, 3rd place and 5 frames).
-- MANUAL migration: it is intentionally NOT in
-- migration-startup-policy.js. Apply it with the reviewed operator procedure before the
-- theme flag and the raffle API are switched on.
--
-- Invariants (enforced in halloween-raffle.js, all inside one transaction per operation):
--   * halloween_ticket_ledger is append-only; source_key is UNIQUE so an event can never apply twice.
--   * every positive ledger row creates exactly `delta` rows in halloween_ticket, each with its own number
--     (BIGSERIAL, 1, 2, 3, ... across the whole draw); a negative row voids that many active tickets.
--   * halloween_ticket_balance is a cache equal to SUM(ledger.delta) per user AND to the count of the
--     user's active tickets; it never goes below zero.
--   * tickets are never spent: every active ticket number when the draw closes is one chance.

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

-- One row per ticket. number is the ticket's serial number in the draw (starts at 1). A number taken by a
-- transaction that was rolled back is skipped (sequences are not transactional); the draw picks from the list
-- of numbers in the snapshot, so a gap changes nothing.
CREATE TABLE IF NOT EXISTS halloween_ticket (
  number BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL REFERENCES halloween_ticket_ledger(source_key),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  void_source_key TEXT REFERENCES halloween_ticket_ledger(source_key),
  CHECK ((status = 'active') = (voided_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_halloween_ticket_user_active
  ON halloween_ticket(user_id, number DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_halloween_ticket_source ON halloween_ticket(source_key);

CREATE TABLE IF NOT EXISTS halloween_draw (
  id TEXT PRIMARY KEY CHECK (id = 'night-of-cauldrons'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'drawn')),
  closes_at TIMESTAMPTZ NOT NULL,
  snapshot_hash TEXT,
  seed TEXT,
  results JSONB,
  drawn_at TIMESTAMPTZ
);

-- Frozen at close: every active ticket number and its owner. snapshot_hash is SHA-256 of
-- "number:user_id" sorted by number, joined with commas. No foreign keys on purpose: the frozen list must not
-- change after close, even if an account is removed (drawNight refuses a snapshot that no longer matches).
CREATE TABLE IF NOT EXISTS halloween_draw_snapshot_ticket (
  number BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL
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

-- One inviter per invitee, forever (invitee_id is the primary key). A code can be entered only during the
-- invitee's first 24 hours after registration, before any purchase, while the draw is open. The inviter earns
-- 1 ticket and 100 bonuses on the invitee's first completed purchase, at most 3 per ISO week (bar clock)
-- counted by week_key of status 'qualified'. 'capped' = the week was already full when the friend bought;
-- 'revoked' = the qualifying purchase was cancelled and the ticket and bonuses taken back. The bonuses are an
-- ordinary 'adjustment' row in transactions (request_key halloween-invite-bonus:<invitee_id>, revoked by
-- halloween-invite-bonus-cancel:<invitee_id>), so wallet, history and client list stay one source of truth.
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
