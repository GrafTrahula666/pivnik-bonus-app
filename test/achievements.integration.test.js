import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  ACHIEVEMENT_CATALOG,
  acknowledgeAchievement,
  evaluateAchievementCatalog,
  getUserAchievementState,
  initializeAchievementGrants,
  syncUserAchievements
} from '../achievements.js';

test('Каталог содержит по 6 считаемых достижений каждой новой редкости', () => {
  for (const rarity of ['common', 'rare', 'epic']) {
    assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === rarity).length, 6);
  }
  assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.rarity === 'legendary').length, 3);
  assert.equal(
    ACHIEVEMENT_CATALOG.find((item) => item.code === 'active-beta-participant')?.rewardBonus,
    1000
  );
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

    const newUser = await db.query(
      `INSERT INTO users (telegram_id, first_name)
       VALUES (1000, 'Новый пользователь')
       RETURNING id`
    );
    await db.query(
      'INSERT INTO wallets (user_id, balance) VALUES ($1, 0)',
      [newUser.rows[0].id]
    );
    await db.query(
      'INSERT INTO beer_loyalty (user_id) VALUES ($1)',
      [newUser.rows[0].id]
    );
    const emptyState = await getUserAchievementState(db, newUser.rows[0].id);
    assert.equal(emptyState.achievements.length, 21);
    assert.equal(emptyState.earned.length, 0);
    assert.equal(emptyState.unannounced.length, 0);
    assert.ok(emptyState.achievements.every((item) => item.locked));

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
    assert.equal(state.achievements.length, 21);
    assert.equal(state.earned.length, 18);
    assert.equal(state.achievements.filter((item) => item.locked).length, 3);
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

test('PostgreSQL: единый журнал выдерживает перезапуски, повторные запросы и идемпотентную выдачу трём beta-тестерам', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        first_name TEXT NOT NULL,
        profile_frame TEXT NOT NULL DEFAULT 'none',
        merged_into_user_id BIGINT REFERENCES users(id),
        deleted_at TIMESTAMPTZ,
        terms_accepted_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE user_identities (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        PRIMARY KEY (provider, provider_user_id),
        UNIQUE (user_id, provider)
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
      CREATE TABLE beta_grants (
        code TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL DEFAULT 0,
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
    const countableMigration = await readFile(
      new URL('../migrations/002_countable_achievements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(countableMigration);

    const users = [];
    for (const [telegramId, firstName, frame] of [
      [9001, 'Анна', 'anna'],
      [9002, 'Олеся', 'olesya'],
      [9003, 'Владислав', 'vladislav'],
      [9004, 'Создатель', 'money']
    ]) {
      const inserted = await db.query(
        `INSERT INTO users (telegram_id, first_name, profile_frame)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [telegramId, firstName, frame]
      );
      const userId = inserted.rows[0].id;
      users.push(userId);
      await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [userId]);
      await db.query('INSERT INTO beer_loyalty (user_id) VALUES ($1)', [userId]);
      await db.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id)
         VALUES ($1, 'telegram', $2)`,
        [userId, String(telegramId)]
      );
    }

    // The first tester already received the old 150-bonus reward. The migration
    // must materialize it without touching the balance a second time.
    await db.query('UPDATE wallets SET balance = 150 WHERE user_id = $1', [users[0]]);
    await db.query(
      `INSERT INTO beta_grants (code, user_id, amount)
       VALUES ('beta-tester-legendary', $1, 150)`,
      [users[0]]
    );
    const ledgerMigration = await readFile(
      new URL('../migrations/007_achievement_source_of_truth.sql', import.meta.url),
      'utf8'
    );
    await db.exec(ledgerMigration);
    await db.exec(ledgerMigration);

    const first = await initializeAchievementGrants(db, {
      ownerTelegramId: '9004',
      activeBetaTesterTelegramIds: ['9001', '9002', '9003']
    });
    const second = await initializeAchievementGrants(db, {
      ownerTelegramId: '9004',
      activeBetaTesterTelegramIds: ['9001', '9002', '9003']
    });
    assert.equal(first.activeBetaResolved, 3);
    assert.equal(first.activeBetaGranted, 3);
    assert.equal(first.activeBetaLedgerCount, 3);
    assert.equal(first.activeBetaLedgerAmount, 3000);
    assert.equal(first.activeBetaTransactionCount, 3);
    assert.equal(first.activeBetaTransactionAmount, 3000);
    assert.equal(second.activeBetaGranted, 0);
    assert.equal(second.activeBetaLedgerCount, 3);
    assert.equal(second.activeBetaLedgerAmount, 3000);
    assert.equal(second.activeBetaTransactionCount, 3);
    assert.equal(second.activeBetaTransactionAmount, 3000);
    assert.equal(second.creatorGranted, false);
    const completedBatch = await db.query(
      `SELECT COUNT(*)::integer AS count
       FROM achievement_award_batches
       WHERE code = 'active-beta-participant-v1'`
    );
    assert.equal(Number(completedBatch.rows[0].count), 1);

    const betaBalances = await db.query(
      `SELECT u.telegram_id, w.balance
       FROM users u JOIN wallets w ON w.user_id = u.id
       WHERE u.telegram_id IN (9001, 9002, 9003)
       ORDER BY u.telegram_id`
    );
    assert.deepEqual(
      betaBalances.rows.map((row) => Number(row.balance)),
      [1150, 1000, 1000]
    );
    const activeGrants = await db.query(
      `SELECT COUNT(*)::integer AS count, SUM(amount)::bigint AS amount
       FROM reward_grants
       WHERE achievement_code = 'active-beta-participant'`
    );
    assert.equal(Number(activeGrants.rows[0].count), 3);
    assert.equal(Number(activeGrants.rows[0].amount), 3000);
    const activeLedger = await db.query(
      `SELECT COUNT(*)::integer AS count
       FROM transactions
       WHERE reward_code = 'achievement:active-beta-participant'`
    );
    assert.equal(Number(activeLedger.rows[0].count), 3);

    const betaState = await getUserAchievementState(db, users[0]);
    assert.ok(betaState.earned.some((item) => item.code === 'active-beta-participant'));
    assert.ok(betaState.earned.some((item) => item.code === 'beta-tester'));
    assert.ok(betaState.achievements.every((item) => item.progress.percent < 100 || item.earned));
    assert.equal(
      betaState.unannounced.filter((item) => item.code === 'active-beta-participant').length,
      1
    );

    const activeNotification = betaState.unannounced.find(
      (item) => item.code === 'active-beta-participant'
    );
    assert.equal(await acknowledgeAchievement(db, users[0], activeNotification.grantCode), true);
    assert.equal(await acknowledgeAchievement(db, users[0], activeNotification.grantCode), true);
    for (let restart = 0; restart < 3; restart += 1) {
      const reloaded = await getUserAchievementState(db, users[0]);
      assert.ok(reloaded.earned.some((item) => item.code === 'active-beta-participant'));
      assert.equal(
        reloaded.unannounced.some((item) => item.code === 'active-beta-participant'),
        false
      );
    }

    const partialUser = users[3];
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, check_amount_cents,
         cash_paid_cents, completed_at
       ) VALUES
         ('partial-1', $1, 'accrue', 'completed', 50000, 50000, NOW()),
         ('partial-2', $1, 'accrue', 'completed', 50000, 50000, NOW())`,
      [partialUser]
    );
    const partial = await getUserAchievementState(db, partialUser);
    const threePurchases = partial.achievements.find((item) => item.code === 'three-purchases');
    assert.equal(threePurchases.earned, false);
    assert.equal(threePurchases.progress.current, 2);
    assert.equal(partial.earned.some((item) => item.code === 'three-purchases'), false);

    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, check_amount_cents,
         cash_paid_cents, completed_at
       ) VALUES ('partial-3', $1, 'accrue', 'completed', 50000, 50000, NOW())`,
      [partialUser]
    );
    const repeatedRequests = [];
    for (let request = 0; request < 3; request += 1) {
      repeatedRequests.push(await getUserAchievementState(db, partialUser));
    }
    assert.ok(repeatedRequests.every((snapshot) => (
      snapshot.achievements.find((item) => item.code === 'three-purchases').earned
    )));
    const duplicated = await db.query(
      `SELECT COUNT(*)::integer AS count
       FROM reward_grants
       WHERE user_id = $1 AND achievement_code = 'three-purchases'`,
      [partialUser]
    );
    assert.equal(Number(duplicated.rows[0].count), 1);

    // A completed batch is not reopened after a recipient deletes the account.
    // No replacement is sought and the service can still restart safely.
    await db.query(
      `DELETE FROM reward_grants
       WHERE user_id = $1 AND achievement_code = 'active-beta-participant'`,
      [users[2]]
    );
    await db.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [users[2]]);
    const afterDeletion = await initializeAchievementGrants(db, {
      ownerTelegramId: '9004',
      activeBetaTesterTelegramIds: []
    });
    assert.equal(afterDeletion.activeBetaResolved, 3);
    assert.equal(afterDeletion.activeBetaGranted, 0);
    assert.equal(afterDeletion.activeBetaLedgerCount, 2);
    assert.equal(afterDeletion.activeBetaLedgerAmount, 2000);
  } finally {
    await db.close();
  }
});
