import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL: unified-account migration is repeatable and enforces uniqueness', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL UNIQUE
      );
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'completed',
        mode TEXT NOT NULL DEFAULT 'adjustment',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cash_paid_cents BIGINT NOT NULL DEFAULT 0,
        bonus_spent INTEGER NOT NULL DEFAULT 0,
        bonus_earned INTEGER NOT NULL DEFAULT 0
      );
    `);

    const migration = await readFile(
      new URL('../migrations/001_add_platform_identities.sql', import.meta.url),
      'utf8'
    );
    await db.exec(migration);
    await db.exec(migration);
    const achievementsMigration = await readFile(
      new URL('../migrations/002_countable_achievements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(achievementsMigration);
    await db.exec(achievementsMigration);
    const publicLaunchMigration = await readFile(
      new URL('../migrations/003_public_launch_requirements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(publicLaunchMigration);
    await db.exec(publicLaunchMigration);

    const first = await db.query(`
      INSERT INTO users (telegram_id)
      VALUES (1001)
      RETURNING id, session_version
    `);
    const second = await db.query(`
      INSERT INTO users (telegram_id)
      VALUES (1002)
      RETURNING id
    `);
    const firstId = first.rows[0].id;
    const secondId = second.rows[0].id;
    assert.equal(Number(first.rows[0].session_version), 1);

    await db.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'telegram', '1001')`,
      [firstId]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id)
         VALUES ($1, 'telegram', '1001')`,
        [secondId]
      )
    );
    await assert.rejects(
      db.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id)
         VALUES ($1, 'telegram', 'different-id')`,
        [firstId]
      )
    );

    await db.query(
      `INSERT INTO reward_grants (code, user_id, amount)
       VALUES ('welcome-100', $1, 100)`,
      [firstId]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO reward_grants (code, user_id, amount)
         VALUES ('welcome-100', $1, 100)`,
        [firstId]
      )
    );

    await db.query(
      `INSERT INTO qr_aliases (qr_token, qr_short_code, user_id, source_user_id)
       VALUES ('OldTokenCase', 'PVK-AAAA-2222', $1, $2)`,
      [firstId, secondId]
    );
    await assert.rejects(
      db.query(
        `INSERT INTO qr_aliases (qr_token, user_id)
         VALUES ('OldTokenCase', $1)`,
        [secondId]
      )
    );

    await db.query(
      `UPDATE users
       SET merged_into_user_id = $1, merged_at = NOW(), session_version = session_version + 1
       WHERE id = $2`,
      [firstId, secondId]
    );
    const archived = await db.query(
      'SELECT merged_into_user_id, session_version FROM users WHERE id = $1',
      [secondId]
    );
    assert.equal(String(archived.rows[0].merged_into_user_id), String(firstId));
    assert.equal(Number(archived.rows[0].session_version), 2);

    const adultColumn = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'adult_confirmed_at'`
    );
    assert.equal(adultColumn.rows.length, 1);
    await db.query(
      `INSERT INTO api_rate_limits (
         subject_hash, route_group, request_count, expires_at
       ) VALUES ('subject', 'test', 1, NOW() + INTERVAL '1 minute')`
    );
    await db.query(
      `INSERT INTO account_deletion_audit (
         deletion_id, requested_from, linked_identity_count,
         deleted_user_rows, deleted_transaction_rows
       ) VALUES ('00000000-0000-4000-8000-000000000001', 'vk', 2, 2, 3)`
    );
    assert.equal((await db.query('SELECT 1 FROM api_rate_limits')).rows.length, 1);
    assert.equal((await db.query('SELECT 1 FROM account_deletion_audit')).rows.length, 1);
  } finally {
    await db.close();
  }
});
