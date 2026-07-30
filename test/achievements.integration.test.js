import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  ACHIEVEMENT_CATALOG,
  acknowledgeAchievement,
  evaluateAchievementCatalog,
  getUserAchievementState,
  syncUserAchievements
} from '../achievements.js';

test('Каталог содержит по 6 считаемых достижений каждой новой редкости', () => {
  for (const rarity of ['common', 'rare', 'epic']) {
    assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === rarity).length, 6);
  }
  assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === 'legendary').length, 0);
  assert.equal(
    ACHIEVEMENT_CATALOG.find((item) => item.code === 'single-check-1000')?.target,
    100_000
  );
  assert.equal(
    ACHIEVEMENT_CATALOG.find((item) => item.code === 'monthly-top-spender')?.rewardBeerMl,
    500
  );
  assert.ok(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === 'common').every((item) => item.rewardBonus === 10));
  assert.ok(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === 'rare').every((item) => item.rewardBonus === 20));
  assert.ok(
    ACHIEVEMENT_CATALOG
      .filter((item) => item.rarity === 'epic' && item.code !== 'monthly-top-spender')
      .every((item) => item.rewardBonus === 30)
  );

  const evaluated = evaluateAchievementCatalog({
    purchaseCount: 3,
    maxCheckCents: 100_000,
    paidBeerMl: 3_000,
    redemptionCount: 1,
    shopPurchaseCount: 1
  });
  assert.ok(evaluated.find((item) => item.code === 'single-check-1000')?.eligible);
  assert.equal(evaluated.find((item) => item.code === 'single-check-3000')?.eligible, false);
});

test('PostgreSQL: достижения и пинта выдаются один раз и отражаются в журнале', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        first_name TEXT NOT NULL,
        merged_into_user_id BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY,
        request_key TEXT UNIQUE,
        client_id BIGINT NOT NULL REFERENCES users(id),
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        check_amount_cents BIGINT NOT NULL DEFAULT 0,
        cash_paid_cents BIGINT NOT NULL DEFAULT 0,
        bonus_spent BIGINT NOT NULL DEFAULT 0,
        bonus_earned BIGINT NOT NULL DEFAULT 0,
        beer_gift_earned_ml BIGINT NOT NULL DEFAULT 0,
        balance_after BIGINT,
        reason TEXT,
        reward_code TEXT,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT transactions_mode_check CHECK (
          mode IN ('accrue','redeem','adjustment','beer_gift','welcome','shop')
        )
      );
      CREATE TABLE reward_grants (
        code TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (code, user_id)
      );
      CREATE TABLE wallets (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE beer_loyalty (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        paid_ml_total BIGINT NOT NULL DEFAULT 0,
        gift_ml_balance BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const migration = await readFile(
      new URL('../migrations/002_countable_achievements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(migration);

    const inserted = await db.query(
      `INSERT INTO users (telegram_id, first_name)
       VALUES (1001, 'Лидер')
       RETURNING id`
    );
    const userId = inserted.rows[0].id;
    await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 1000)', [userId]);
    await db.query(
      'INSERT INTO beer_loyalty (user_id, paid_ml_total) VALUES ($1, 50000)',
      [userId]
    );
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, check_amount_cents, cash_paid_cents,
         bonus_spent, created_at, completed_at
       )
       SELECT
         'purchase-' || n::text,
         $1::bigint,
         CASE WHEN n = 1 THEN 'redeem' ELSE 'accrue' END,
         'completed',
         700000,
         700000,
         CASE WHEN n = 1 THEN 500 ELSE 0 END,
         (
           date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow')
           - INTERVAL '1 month'
           + ((n - 1) % 20) * INTERVAL '1 day'
         ) AT TIME ZONE 'Europe/Moscow',
         NOW()
       FROM generate_series(1, 50) AS n`,
      [userId]
    );
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, bonus_spent, created_at, completed_at
       ) VALUES ('shop-first', $1, 'shop', 'completed', 100, NOW(), NOW())`,
      [userId]
    );

    const first = await syncUserAchievements(db, userId);
    const second = await syncUserAchievements(db, userId);
    assert.equal(first.granted.length, 18);
    assert.equal(second.granted.length, 0);

    const another = await db.query(
      `INSERT INTO users (telegram_id, first_name)
       VALUES (1002, 'Гость')
       RETURNING id`
    );
    const anotherId = another.rows[0].id;
    await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [anotherId]);
    await db.query('INSERT INTO beer_loyalty (user_id) VALUES ($1)', [anotherId]);
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, check_amount_cents,
         cash_paid_cents, created_at, completed_at
       ) VALUES ('another-first', $1, 'accrue', 'completed', 100000, 100000, NOW(), NOW())`,
      [anotherId]
    );
    const anotherAwards = await syncUserAchievements(db, anotherId);
    assert.equal(anotherAwards.granted.length, 2);

    const grants = await db.query(
      `SELECT COUNT(*)::int AS count,
              SUM(amount)::bigint AS bonus,
              SUM(reward_beer_ml)::bigint AS beer
       FROM reward_grants
       WHERE user_id = $1 AND source = 'achievement'`,
      [userId]
    );
    assert.equal(Number(grants.rows[0].count), 18);
    assert.equal(Number(grants.rows[0].bonus), 330);
    assert.equal(Number(grants.rows[0].beer), 500);

    const wallet = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
    const beer = await db.query('SELECT gift_ml_balance FROM beer_loyalty WHERE user_id = $1', [userId]);
    assert.equal(Number(wallet.rows[0].balance), 1330);
    assert.equal(Number(beer.rows[0].gift_ml_balance), 500);

    const ledger = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM transactions
       WHERE client_id = $1 AND mode = 'achievement'`,
      [userId]
    );
    assert.equal(Number(ledger.rows[0].count), 18);

    const state = await getUserAchievementState(db, userId, { sync: false });
    assert.equal(state.achievements.length, 18);
    assert.equal(state.earned.length, 18);
    assert.equal(state.unannounced.length, 18);
    const monthly = state.earned.find((item) => item.code === 'monthly-top-spender');
    assert.equal(monthly.rewardBeerMl, 500);

    assert.equal(await acknowledgeAchievement(db, userId, monthly.grantCode), true);
    const acknowledged = await getUserAchievementState(db, userId, { sync: false });
    assert.equal(acknowledged.unannounced.length, 17);
  } finally {
    await db.close();
  }
});
