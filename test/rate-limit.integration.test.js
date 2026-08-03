import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'rate-limit-test-session-secret-only';

test('PostgreSQL: API rate limit is durable and resets after its window', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE users (id BIGSERIAL PRIMARY KEY)');
    const migration = await readFile(
      new URL('../migrations/003_public_launch_requirements.sql', import.meta.url),
      'utf8'
    );
    await db.exec(migration);
    const { enforceRateLimit } = await import('../universal-server.js?rate-limit-integration');

    await enforceRateLimit('subject-hash', 'support', 2, 60_000, db);
    await enforceRateLimit('subject-hash', 'support', 2, 60_000, db);
    await assert.rejects(
      enforceRateLimit('subject-hash', 'support', 2, 60_000, db),
      (error) => error?.statusCode === 429
    );

    await db.query(
      `UPDATE api_rate_limits
       SET window_started_at = NOW() - INTERVAL '2 minutes'`
    );
    await enforceRateLimit('subject-hash', 'support', 2, 60_000, db);
    const current = await db.query(
      `SELECT request_count FROM api_rate_limits
       WHERE subject_hash = 'subject-hash' AND route_group = 'support'`
    );
    assert.equal(Number(current.rows[0].request_count), 1);
  } finally {
    await db.close();
  }
});
