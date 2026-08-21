import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  applyReferralCode,
  ensureReferralCode,
  getReferralOverview,
  reconcileReferral,
  REFERRAL_CODE_TTL_MS,
  REFERRAL_QUALIFICATION_MS,
  REFERRER_MONTHLY_REWARD_LIMIT
} from '../referrals.js';

async function dbFixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT,
      username TEXT,
      first_name TEXT,
      merged_into_user_id BIGINT,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE wallets (
      user_id BIGINT PRIMARY KEY REFERENCES users(id),
      balance BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE reward_grants (
      code TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id),
      amount BIGINT NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (code, user_id)
    );
    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY,
      request_key TEXT UNIQUE,
      client_id BIGINT NOT NULL REFERENCES users(id),
      staff_id BIGINT,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      check_amount_cents BIGINT NOT NULL DEFAULT 0,
      discount_cents BIGINT NOT NULL DEFAULT 0,
      bonus_spent BIGINT NOT NULL DEFAULT 0,
      bonus_earned BIGINT NOT NULL DEFAULT 0,
      cash_paid_cents BIGINT NOT NULL DEFAULT 0,
      balance_after BIGINT,
      reason TEXT,
      reward_code TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE promotions (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE,
      title TEXT,
      description TEXT,
      badge TEXT,
      active BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const migration = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../migrations/008_referral_v2.sql', import.meta.url), 'utf8')
  );
  await db.exec(migration);
  return db;
}

async function addUser(db, username, createdAt) {
  const result = await db.query(
    `INSERT INTO users (username, first_name, created_at)
     VALUES ($1, $2, $3::timestamptz)
     RETURNING id`,
    [username, username, createdAt]
  );
  const id = String(result.rows[0].id);
  await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1::bigint, 0)', [id]);
  return id;
}

async function addPurchase(db, userId, rubles, at, overrides = {}) {
  const cents = Math.round(rubles * 100);
  const result = await db.query(
    `INSERT INTO transactions (
       request_key, client_id, mode, status,
       check_amount_cents, cash_paid_cents, completed_at
     ) VALUES ($1, $2::bigint, $3, $4, $5::bigint, $6::bigint, $7::timestamptz)
     RETURNING id`,
    [
      `purchase-${crypto.randomUUID()}`,
      userId,
      overrides.mode || 'accrue',
      overrides.status || 'completed',
      cents,
      overrides.cashPaidCents ?? cents,
      at
    ]
  );
  return String(result.rows[0].id);
}

const BASE = new Date('2026-08-21T08:00:00.000Z');
const hour = (count) => new Date(BASE.getTime() + count * 60 * 60 * 1000);

test('code is attachable only in first 24h, immutable, and self-referral is blocked', async () => {
  const db = await dbFixture();
  const inviter = await addUser(db, 'inviter', hour(-48));
  const invited = await addUser(db, 'invited', BASE);
  const late = await addUser(db, 'late', BASE);

  const code = await ensureReferralCode(db, inviter);
  await applyReferralCode(db, invited, code, { now: hour(23) });

  await assert.rejects(
    () => applyReferralCode(db, invited, 'PVK-ABCDEFGH', { now: hour(23) }),
    (error) => error.code === 'REFERRAL_ALREADY_BOUND'
  );

  await assert.rejects(
    () => applyReferralCode(
      db,
      late,
      code,
      { now: new Date(BASE.getTime() + REFERRAL_CODE_TTL_MS + 1) }
    ),
    (error) => error.code === 'REFERRAL_CODE_WINDOW_EXPIRED'
  );

  const boughtBeforeCode = await addUser(db, 'bought_before_code', BASE);
  await addPurchase(db, boughtBeforeCode, 100, hour(1));
  await assert.rejects(
    () => applyReferralCode(db, boughtBeforeCode, code, { now: hour(2) }),
    (error) => error.code === 'REFERRAL_PURCHASE_ALREADY_EXISTS'
  );

  const selfCode = await ensureReferralCode(db, late);
  await assert.rejects(
    () => applyReferralCode(db, late, selfCode, { now: hour(1) }),
    (error) => error.code === 'SELF_REFERRAL'
  );
  await db.close();
});

test('200 + 150 + 150 RUB in 72h rewards 100 / 50 exactly once', async () => {
  const db = await dbFixture();
  const inviter = await addUser(db, 'inviter', hour(-48));
  const invited = await addUser(db, 'invited', BASE);
  const code = await ensureReferralCode(db, inviter);
  await applyReferralCode(db, invited, code, { now: BASE });

  await addPurchase(db, invited, 200, hour(1));
  await addPurchase(db, invited, 150, hour(2));
  let progress = await reconcileReferral(db, invited, { now: hour(2) });
  assert.equal(progress.amountCents, 35_000);

  await addPurchase(db, invited, 150, hour(3));
  progress = await reconcileReferral(db, invited, { now: hour(3) });
  assert.equal(progress.amountCents, 50_000);
  assert.equal(progress.referral.status, 'rewarded');

  await reconcileReferral(db, invited, { now: hour(4) });
  await reconcileReferral(db, invited, { now: hour(5) });

  const balances = await db.query(
    'SELECT user_id, balance FROM wallets WHERE user_id IN ($1::bigint,$2::bigint) ORDER BY user_id',
    [inviter, invited]
  );
  const balanceByUser = Object.fromEntries(
    balances.rows.map((row) => [String(row.user_id), Number(row.balance)])
  );
  assert.equal(balanceByUser[inviter], 100);
  assert.equal(balanceByUser[invited], 50);

  const grants = await db.query(
    `SELECT code, user_id, amount, source
     FROM reward_grants
     WHERE code = $1
     ORDER BY user_id`,
    [`referral:${invited}:qualified`]
  );
  assert.equal(grants.rowCount, 2);
  assert.deepEqual(grants.rows.map((row) => Number(row.amount)).sort((a,b) => a-b), [50, 100]);

  const history = await db.query(
    `SELECT mode, bonus_earned
     FROM transactions
     WHERE reward_code = $1`,
    [`referral:${invited}:qualified`]
  );
  assert.equal(history.rowCount, 2);
  assert.ok(history.rows.every((row) => row.mode === 'referral'));
  await db.close();
});

test('only completed paid accrue/redeem cash counts, cancellation subtracts progress', async () => {
  const db = await dbFixture();
  const inviter = await addUser(db, 'inviter', hour(-48));
  const invited = await addUser(db, 'invited', BASE);
  const code = await ensureReferralCode(db, inviter);
  await applyReferralCode(db, invited, code, { now: BASE });

  const realId = await addPurchase(db, invited, 300, hour(1));
  await addPurchase(db, invited, 500, hour(1.1), { mode: 'adjustment' });
  await addPurchase(db, invited, 500, hour(1.2), { mode: 'welcome' });
  await addPurchase(db, invited, 500, hour(1.3), { mode: 'shop' });
  await addPurchase(db, invited, 500, hour(1.4), { mode: 'accrue', cashPaidCents: 0 });
  await addPurchase(db, invited, 500, hour(1.5), { mode: 'redeem', status: 'cancelled' });

  let progress = await reconcileReferral(db, invited, { now: hour(2) });
  assert.equal(progress.amountCents, 30_000);

  await db.query(
    `UPDATE transactions
     SET status = 'cancelled'
     WHERE id = $1::bigint`,
    [realId]
  );
  progress = await reconcileReferral(db, invited, { now: hour(3) });
  assert.equal(progress.amountCents, 0);

  await addPurchase(db, invited, 500, hour(4));
  progress = await reconcileReferral(db, invited, { now: hour(4) });
  assert.equal(progress.referral.status, 'rewarded');
  await db.close();
});

test('late purchases never activate expired referral; late worker preserves in-window qualification', async () => {
  const db = await dbFixture();

  const inviter1 = await addUser(db, 'inviter1', hour(-48));
  const invited1 = await addUser(db, 'invited1', BASE);
  const code1 = await ensureReferralCode(db, inviter1);
  await applyReferralCode(db, invited1, code1, { now: BASE });
  await addPurchase(
    db,
    invited1,
    1000,
    new Date(BASE.getTime() + REFERRAL_QUALIFICATION_MS + 1000)
  );
  let result = await reconcileReferral(
    db,
    invited1,
    { now: new Date(BASE.getTime() + REFERRAL_QUALIFICATION_MS + 2000) }
  );
  assert.equal(result.amountCents, 0);
  assert.equal(result.referral.status, 'expired');

  const inviter2 = await addUser(db, 'inviter2', hour(-48));
  const invited2 = await addUser(db, 'invited2', BASE);
  const code2 = await ensureReferralCode(db, inviter2);
  await applyReferralCode(db, invited2, code2, { now: BASE });
  await addPurchase(
    db,
    invited2,
    500,
    new Date(BASE.getTime() + REFERRAL_QUALIFICATION_MS - 1000)
  );
  result = await reconcileReferral(
    db,
    invited2,
    { now: new Date(BASE.getTime() + REFERRAL_QUALIFICATION_MS + 60_000) }
  );
  assert.equal(result.referral.status, 'rewarded');
  await db.close();
});

test('inviter monthly payout is capped while invited user still receives 50', async () => {
  const db = await dbFixture();
  const inviter = await addUser(db, 'popular_inviter', hour(-48));
  const code = await ensureReferralCode(db, inviter);

  for (let index = 0; index < REFERRER_MONTHLY_REWARD_LIMIT + 1; index += 1) {
    const invited = await addUser(db, `friend_${index}`, BASE);
    await applyReferralCode(db, invited, code, { now: hour(index / 10) });
    await addPurchase(db, invited, 500, hour(2 + index / 10));
    await reconcileReferral(db, invited, { now: hour(2 + index / 10) });

    const invitedBalance = await db.query(
      'SELECT balance FROM wallets WHERE user_id = $1::bigint',
      [invited]
    );
    assert.equal(Number(invitedBalance.rows[0].balance), 50);
  }

  const inviterBalance = await db.query(
    'SELECT balance FROM wallets WHERE user_id = $1::bigint',
    [inviter]
  );
  assert.equal(
    Number(inviterBalance.rows[0].balance),
    REFERRER_MONTHLY_REWARD_LIMIT * 100
  );

  const overview = await getReferralOverview(db, inviter, { now: hour(6) });
  assert.equal(overview.inviterStats.invited, REFERRER_MONTHLY_REWARD_LIMIT + 1);
  assert.equal(overview.inviterStats.rewarded, REFERRER_MONTHLY_REWARD_LIMIT + 1);
  assert.equal(overview.inviterStats.rewardedThisMonth, REFERRER_MONTHLY_REWARD_LIMIT);
  await db.close();
});

test('public overview exposes UX state, not internal status enum', async () => {
  const db = await dbFixture();
  const user = await addUser(db, 'new_user', BASE);
  const overview = await getReferralOverview(db, user, { now: hour(1) });
  assert.equal(overview.registrationWindow.canApply, true);
  assert.match(overview.ownCode, /^PVK-[A-Z2-9]{8}$/);
  assert.equal(overview.inviterStats.invited, 0);
  assert.equal(overview.inviterStats.rewarded, 0);
  assert.equal(overview.inviterStats.monthlyRewardLimit, REFERRER_MONTHLY_REWARD_LIMIT);
  assert.equal('status' in (overview.referral || {}), false);
  await db.close();
});
