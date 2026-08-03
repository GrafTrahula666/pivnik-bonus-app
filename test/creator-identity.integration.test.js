import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'creator-test-session-secret-only';

test('PostgreSQL: «Создатель» закрепляется один раз и переживает смену платформы', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        role TEXT NOT NULL DEFAULT 'client',
        unlimited_bonus BOOLEAN NOT NULL DEFAULT FALSE,
        profile_frame TEXT NOT NULL DEFAULT 'none',
        is_creator BOOLEAN NOT NULL DEFAULT FALSE,
        merged_into_user_id BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX idx_users_single_creator
        ON users ((1)) WHERE is_creator = TRUE;
      CREATE TABLE user_identities (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        UNIQUE (provider, provider_user_id),
        UNIQUE (user_id, provider)
      );
    `);

    const telegram = await db.query(
      `INSERT INTO users (telegram_id, created_at)
       VALUES (111, '2026-01-01T00:00:00Z') RETURNING id`
    );
    const vk = await db.query(
      `INSERT INTO users (telegram_id, created_at)
       VALUES (NULL, '2026-01-02T00:00:00Z') RETURNING id`
    );
    await db.query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id)
       VALUES ($1, 'telegram', '111'), ($2, 'vk', '222')`,
      [telegram.rows[0].id, vk.rows[0].id]
    );

    const { synchronizeCreatorAccount } = await import('../universal-server.js?creator-identity');
    const creatorId = await synchronizeCreatorAccount(db, {
      telegramId: '111',
      vkId: '222'
    });
    assert.equal(String(creatorId), String(telegram.rows[0].id));

    const firstState = await db.query(
      `SELECT id, role, unlimited_bonus, profile_frame, is_creator
       FROM users ORDER BY id`
    );
    assert.deepEqual(
      firstState.rows.map((row) => ({
        id: String(row.id),
        role: row.role,
        unlimited: row.unlimited_bonus,
        frame: row.profile_frame,
        creator: row.is_creator
      })),
      [
        { id: String(telegram.rows[0].id), role: 'admin', unlimited: true, frame: 'money', creator: true },
        { id: String(vk.rows[0].id), role: 'client', unlimited: false, frame: 'none', creator: false }
      ]
    );

    // Once assigned, mutable environment IDs cannot silently move the unique
    // achievement to another profile.
    const persistedId = await synchronizeCreatorAccount(db, {
      telegramId: '',
      vkId: '222'
    });
    assert.equal(String(persistedId), String(telegram.rows[0].id));
    assert.equal(
      Number((await db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_creator = TRUE')).rows[0].count),
      1
    );
  } finally {
    await db.close();
  }
});
