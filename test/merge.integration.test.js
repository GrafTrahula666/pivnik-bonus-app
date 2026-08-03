import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'integration-test-session-secret-only';

test('PostgreSQL: mergeUsers preserves purchases, liters, role, PIN and QR alias', async () => {
  const db = new PGlite();
  const rawQuery = db.query.bind(db);
  db.query = async (...args) => {
    const result = await rawQuery(...args);
    return {
      ...result,
      rowCount: Array.isArray(result.rows)
        ? result.rows.length
        : Number(result.affectedRows || 0)
    };
  };
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT,
        photo_url TEXT,
        language_code TEXT,
        role TEXT NOT NULL DEFAULT 'client',
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        terms_accepted_at TIMESTAMPTZ,
        terms_version TEXT,
        staff_pin_hash TEXT,
        staff_pin_salt TEXT,
        staff_pin_updated_at TIMESTAMPTZ,
        avatar_source TEXT NOT NULL DEFAULT 'preset_male',
        avatar_key TEXT,
        onboarding_completed_at TIMESTAMPTZ,
        age_group TEXT,
        profile_public BOOLEAN NOT NULL DEFAULT TRUE,
        show_name BOOLEAN NOT NULL DEFAULT TRUE,
        show_avatar BOOLEAN NOT NULL DEFAULT TRUE,
        show_leaderboard_amount BOOLEAN NOT NULL DEFAULT TRUE,
        show_stats BOOLEAN NOT NULL DEFAULT TRUE,
        unlimited_bonus BOOLEAN NOT NULL DEFAULT FALSE,
        profile_frame TEXT NOT NULL DEFAULT 'none',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE wallets (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE beer_loyalty (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        paid_ml_total BIGINT NOT NULL DEFAULT 0,
        gift_ml_balance INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY,
        request_key TEXT UNIQUE,
        client_id BIGINT NOT NULL REFERENCES users(id),
        staff_id BIGINT REFERENCES users(id),
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        check_amount_cents BIGINT NOT NULL DEFAULT 0,
        discount_cents BIGINT NOT NULL DEFAULT 0,
        bonus_spent INTEGER NOT NULL DEFAULT 0,
        bonus_earned INTEGER NOT NULL DEFAULT 0,
        cash_paid_cents BIGINT NOT NULL DEFAULT 0,
        balance_after BIGINT,
        reason TEXT,
        expires_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_suspicious BOOLEAN NOT NULL DEFAULT FALSE,
        beer_ml INTEGER NOT NULL DEFAULT 0,
        beer_gift_earned_ml INTEGER NOT NULL DEFAULT 0,
        beer_gift_spent_ml INTEGER NOT NULL DEFAULT 0,
        cancelled_by BIGINT REFERENCES users(id),
        cancelled_at TIMESTAMPTZ,
        cancel_reason TEXT
      );
      CREATE TABLE qr_sessions (
        token TEXT PRIMARY KEY,
        short_code TEXT NOT NULL UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE shifts (
        id BIGSERIAL PRIMARY KEY,
        created_by BIGINT REFERENCES users(id),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        note TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE shift_members (
        shift_id BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position SMALLINT NOT NULL DEFAULT 0,
        PRIMARY KEY (shift_id, user_id)
      );
      CREATE TABLE cancel_quota_resets (
        id BIGSERIAL PRIMARY KEY,
        shift_id BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reset_by BIGINT NOT NULL REFERENCES users(id),
        reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE app_settings (
        id SMALLINT PRIMARY KEY,
        updated_by BIGINT REFERENCES users(id)
      );
      CREATE TABLE promotions (
        id BIGSERIAL PRIMARY KEY,
        updated_by BIGINT REFERENCES users(id)
      );
      CREATE TABLE shop_items (
        id BIGSERIAL PRIMARY KEY,
        updated_by BIGINT REFERENCES users(id)
      );
      CREATE TABLE shop_inquiries (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE beta_grants (
        code TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (code, user_id)
      );
    `);

    const migration = await readFile(
      new URL('../migrations/001_add_platform_identities.sql', import.meta.url),
      'utf8'
    );
    await db.exec(migration);
    const achievementsMigration = await readFile(
      new URL('../migrations/002_countable_achievements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(achievementsMigration);
    const publicLaunchMigration = await readFile(
      new URL('../migrations/003_public_launch_requirements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(publicLaunchMigration);
    const creatorMigration = await readFile(
      new URL('../migrations/004_creator_identity.sql', import.meta.url),
      'utf8'
    );
    await db.exec(creatorMigration);

    const telegramUser = await db.query(`
      INSERT INTO users (
        telegram_id, username, first_name, last_name, role,
        qr_token, qr_short_code, terms_accepted_at, terms_version,
        onboarding_completed_at, adult_confirmed_at, is_creator, created_at
      ) VALUES (
        1001, 'telegram_user', 'Телеграм', 'Клиент', 'client',
        'TelegramTokenCase', 'PVK-TG11-AAAA', NOW(), 'beta-0.4',
        NOW(), NOW(), TRUE, '2026-01-01T10:00:00Z'
      )
      RETURNING id
    `);
    const vkUser = await db.query(`
      INSERT INTO users (
        telegram_id, username, first_name, last_name, role,
        qr_token, qr_short_code, staff_pin_hash, staff_pin_salt,
        staff_pin_updated_at, profile_public, show_name, created_at
      ) VALUES (
        NULL, 'vk_user', 'ВК', 'Сотрудник', 'staff',
        'VkTokenCase', 'PVK-VK22-BBBB', 'pin-hash', 'pin-salt',
        NOW(), TRUE, FALSE, '2026-01-02T10:00:00Z'
      )
      RETURNING id
    `);
    const telegramId = telegramUser.rows[0].id;
    const vkId = vkUser.rows[0].id;

    await db.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username)
       VALUES ($1, 'telegram', '1001', 'telegram_user'),
              ($2, 'vk', '2002', 'vk_user')`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO wallets (user_id, balance)
       VALUES ($1, 140), ($2, 140)`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance)
       VALUES ($1, 5000, 0), ($2, 9000, 1000)`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO reward_grants (code, user_id, amount, source)
       VALUES ('welcome-100', $1, 100, 'consent'),
              ('welcome-100', $2, 100, 'consent')`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO reward_grants (
         code, user_id, amount, source, achievement_code,
         achievement_period, reward_beer_ml, announced_at
       ) VALUES (
         'achievement:monthly-top-spender:2026-01', $1, 0, 'achievement',
         'monthly-top-spender', '2026-01', 500, NOW()
       )`,
      [vkId]
    );
    await db.query(
      `INSERT INTO beta_grants (code, user_id, amount)
       VALUES ('beta-tester-legendary', $1, 150),
              ('beta-tester-legendary', $2, 150)`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, bonus_earned,
         balance_after, reason, reward_code, completed_at, created_at
       ) VALUES
         ('reward-tg-welcome', $1, 'welcome', 'completed', 100, 100,
          'Приветственный бонус за регистрацию', 'welcome-100', NOW(), '2026-01-01T10:01:00Z'),
         ('reward-vk-welcome', $2, 'welcome', 'completed', 100, 100,
          'Приветственный бонус за регистрацию', 'welcome-100', NOW(), '2026-01-02T10:01:00Z')`,
      [telegramId, vkId]
    );
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status, check_amount_cents,
         bonus_spent, bonus_earned, cash_paid_cents, balance_after,
         completed_at, created_at
       ) VALUES
         ('tg-purchase-0001', $1, 'accrue', 'completed', 10000, 0, 50, 10000, 150,
          NOW(), '2026-01-03T10:00:00Z'),
         ('tg-redeem-000001', $1, 'redeem', 'completed', 3000, 20, 10, 3000, 140,
          NOW(), '2026-01-04T10:00:00Z'),
         ('vk-purchase-0001', $2, 'accrue', 'completed', 8000, 0, 40, 8000, 140,
          NOW(), '2026-01-05T10:00:00Z')`,
      [telegramId, vkId]
    );

    const shift = await db.query(
      'INSERT INTO shifts (created_by) VALUES ($1) RETURNING id',
      [vkId]
    );
    await db.query(
      'INSERT INTO shift_members (shift_id, user_id, position) VALUES ($1, $2, 0)',
      [shift.rows[0].id, vkId]
    );
    await db.query('INSERT INTO app_settings (id, updated_by) VALUES (1, $1)', [vkId]);
    await db.query('INSERT INTO shop_inquiries (user_id) VALUES ($1)', [vkId]);
    const bar = await db.query(
      `INSERT INTO bars (code, name) VALUES ('pivnik', 'ПИВНИК') RETURNING id`
    );
    await db.query(
      `INSERT INTO bar_customers (bar_id, user_id)
       VALUES ($1, $2), ($1, $3)`,
      [bar.rows[0].id, telegramId, vkId]
    );

    const { mergeUsers, deleteUnifiedAccount } = await import('../universal-server.js?merge-integration');
    await db.exec('BEGIN');
    const merge = await mergeUsers(db, telegramId, vkId);
    await db.exec('COMMIT');

    assert.equal(String(merge.canonicalUserId), String(telegramId));
    assert.equal(String(merge.mergedUserId), String(vkId));
    assert.equal(merge.duplicateBonusRemoved, 100);
    assert.equal(merge.finalBalance, 180);

    const canonical = await db.query(
      `SELECT role, staff_pin_hash, staff_pin_salt, telegram_id, is_creator, adult_confirmed_at,
              profile_public, show_name, session_version
       FROM users WHERE id = $1`,
      [telegramId]
    );
    assert.equal(canonical.rows[0].role, 'staff');
    assert.equal(canonical.rows[0].staff_pin_hash, 'pin-hash');
    assert.equal(canonical.rows[0].staff_pin_salt, 'pin-salt');
    assert.equal(String(canonical.rows[0].telegram_id), '1001');
    assert.equal(canonical.rows[0].is_creator, true);
    assert.ok(canonical.rows[0].adult_confirmed_at);
    assert.equal(canonical.rows[0].profile_public, true);
    assert.equal(canonical.rows[0].show_name, false);
    assert.equal(Number(canonical.rows[0].session_version), 2);

    const archived = await db.query(
      `SELECT merged_into_user_id, qr_token, qr_short_code, role, is_creator,
              staff_pin_hash, session_version
       FROM users WHERE id = $1`,
      [vkId]
    );
    assert.equal(String(archived.rows[0].merged_into_user_id), String(telegramId));
    assert.equal(archived.rows[0].qr_token, null);
    assert.equal(archived.rows[0].qr_short_code, null);
    assert.equal(archived.rows[0].role, 'client');
    assert.equal(archived.rows[0].is_creator, false);
    assert.equal(archived.rows[0].staff_pin_hash, null);
    assert.equal(Number(archived.rows[0].session_version), 2);

    const wallet = await db.query('SELECT balance FROM wallets WHERE user_id = $1', [telegramId]);
    assert.equal(Number(wallet.rows[0].balance), 180);
    assert.equal((await db.query('SELECT 1 FROM wallets WHERE user_id = $1', [vkId])).rowCount, 0);

    const ledger = await db.query(
      `SELECT COALESCE(SUM(bonus_earned - bonus_spent), 0)::bigint AS balance,
              COUNT(*) FILTER (WHERE status = 'cancelled' AND reward_code = 'welcome-100')::int AS cancelled_rewards
       FROM transactions
       WHERE client_id = $1 AND status IN ('completed', 'cancelled')`,
      [telegramId]
    );
    assert.equal(Number(ledger.rows[0].balance), 280);
    assert.equal(Number(ledger.rows[0].cancelled_rewards), 1);
    const completedLedger = await db.query(
      `SELECT COALESCE(SUM(bonus_earned - bonus_spent), 0)::bigint AS balance
       FROM transactions WHERE client_id = $1 AND status = 'completed'`,
      [telegramId]
    );
    assert.equal(Number(completedLedger.rows[0].balance), 180);

    const beer = await db.query(
      'SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1',
      [telegramId]
    );
    assert.equal(Number(beer.rows[0].paid_ml_total), 14_000);
    assert.equal(Number(beer.rows[0].gift_ml_balance), 1_000);

    const achievementGrant = await db.query(
      `SELECT achievement_code, achievement_period, reward_beer_ml, announced_at
       FROM reward_grants
       WHERE user_id = $1 AND code = 'achievement:monthly-top-spender:2026-01'`,
      [telegramId]
    );
    assert.equal(achievementGrant.rowCount, 1);
    assert.equal(achievementGrant.rows[0].achievement_code, 'monthly-top-spender');
    assert.equal(achievementGrant.rows[0].achievement_period, '2026-01');
    assert.equal(Number(achievementGrant.rows[0].reward_beer_ml), 500);
    assert.ok(achievementGrant.rows[0].announced_at);

    const identities = await db.query(
      'SELECT provider, user_id FROM user_identities ORDER BY provider'
    );
    assert.deepEqual(
      identities.rows.map((row) => [row.provider, String(row.user_id)]),
      [['telegram', String(telegramId)], ['vk', String(telegramId)]]
    );

    const alias = await db.query(
      `SELECT qr_token, qr_short_code, user_id, source_user_id
       FROM qr_aliases WHERE qr_token = 'VkTokenCase'`
    );
    assert.equal(alias.rowCount, 1);
    assert.equal(String(alias.rows[0].user_id), String(telegramId));
    assert.equal(String(alias.rows[0].source_user_id), String(vkId));

    const membership = await db.query(
      'SELECT user_id FROM shift_members WHERE shift_id = $1',
      [shift.rows[0].id]
    );
    assert.equal(String(membership.rows[0].user_id), String(telegramId));
    assert.equal(
      String((await db.query('SELECT user_id FROM shop_inquiries LIMIT 1')).rows[0].user_id),
      String(telegramId)
    );
    assert.equal(
      Number((await db.query('SELECT duplicate_bonus_removed FROM account_merge_audit')).rows[0].duplicate_bonus_removed),
      100
    );

    const otherUser = await db.query(
      `INSERT INTO users (telegram_id, first_name)
       VALUES (3003, 'Другой клиент') RETURNING id`
    );
    const otherUserId = otherUser.rows[0].id;
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, cash_paid_cents, completed_at
       ) VALUES ('other-client-purchase', $1, $2, 'accrue', 'completed', 5000, 5000, NOW())`,
      [otherUserId, telegramId]
    );

    await db.exec('BEGIN');
    const deletion = await deleteUnifiedAccount(db, telegramId, 'vk');
    await db.exec('COMMIT');
    assert.equal(deletion.deleted, true);
    assert.equal(deletion.linkedIdentityCount, 2);
    assert.equal(deletion.deletedUserRows, 2);
    assert.ok(deletion.deletedTransactionRows >= 5);
    assert.equal((await db.query('SELECT 1 FROM users WHERE id = ANY($1::bigint[])', [[telegramId, vkId]])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM user_identities')).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM shop_inquiries')).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM account_merge_audit')).rowCount, 0);
    const preserved = await db.query(
      `SELECT staff_id FROM transactions WHERE request_key = 'other-client-purchase'`
    );
    assert.equal(preserved.rowCount, 1);
    assert.equal(preserved.rows[0].staff_id, null);
    assert.equal((await db.query('SELECT updated_by FROM app_settings WHERE id = 1')).rows[0].updated_by, null);
    const audit = await db.query(
      `SELECT requested_from, linked_identity_count, deleted_user_rows,
              deleted_transaction_rows
       FROM account_deletion_audit`
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].requested_from, 'vk');
    assert.equal(Number(audit.rows[0].linked_identity_count), 2);
    assert.equal(Number(audit.rows[0].deleted_user_rows), 2);
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await db.close();
  }
});
