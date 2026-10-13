import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { normalizePersonalQr } from '../platform-core.js';
import { resolvePersonalQrRecord } from '../qr-resolver.js';

test('QR принимает URL, JSON, токен без префикса и короткий код без дефисов', () => {
  const token = 'AbC_def-123456789';
  assert.deepEqual(normalizePersonalQr(token), { type: 'token', value: token });
  assert.deepEqual(
    normalizePersonalQr(`https://example.test/open?payload=${encodeURIComponent(`PIVNIK:${token}`)}`),
    { type: 'token', value: token }
  );
  assert.deepEqual(
    normalizePersonalQr(JSON.stringify({ code: 'pvk ab12 cd34' })),
    { type: 'short', value: 'PVK-AB12-CD34' }
  );
});

test('PostgreSQL: старый QR alias возвращает текущий профиль', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        merged_into_user_id BIGINT REFERENCES users(id)
      );
      CREATE TABLE qr_aliases (
        id BIGSERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id),
        source_user_id BIGINT REFERENCES users(id)
      );
    `);
    const inserted = await db.query(
      `INSERT INTO users (qr_token, qr_short_code)
       VALUES ('CurrentToken_123456789', 'PVK-AAAA-2222')
       RETURNING id`
    );
    await db.query(
      `INSERT INTO qr_aliases (qr_token, qr_short_code, user_id)
       VALUES ('OldToken_123456789', 'PVK-BBBB-3333', $1)`,
      [inserted.rows[0].id]
    );

    const byAlias = await resolvePersonalQrRecord(db, 'PIVNIK:OldToken_123456789');
    const byCompact = await resolvePersonalQrRecord(db, 'pvk bbbb 3333');
    assert.equal(byAlias.qr_token, 'CurrentToken_123456789');
    assert.equal(byCompact.qr_short_code, 'PVK-AAAA-2222');
  } finally {
    await db.close();
  }
});

test('PostgreSQL: QR, отозванный перевыпуском, больше не находит клиента', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        merged_into_user_id BIGINT REFERENCES users(id)
      );
      CREATE TABLE qr_aliases (
        id BIGSERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id),
        source_user_id BIGINT REFERENCES users(id)
      );
    `);
    const canonical = await db.query(
      `INSERT INTO users (qr_token, qr_short_code)
       VALUES ('ReissuedToken_123456789', 'PVK-CCCC-4444')
       RETURNING id`
    );
    const merged = await db.query(
      `INSERT INTO users (qr_token, qr_short_code, merged_into_user_id)
       VALUES (NULL, NULL, $1)
       RETURNING id`,
      [canonical.rows[0].id]
    );
    // Admin reissue reserves the leaked code as a self-alias.
    await db.query(
      `INSERT INTO qr_aliases (qr_token, qr_short_code, user_id, source_user_id)
       VALUES ('LeakedToken_123456789', 'PVK-DDDD-5555', $1, $1)`,
      [canonical.rows[0].id]
    );
    // Account merge keeps the merged profile's code working.
    await db.query(
      `INSERT INTO qr_aliases (qr_token, qr_short_code, user_id, source_user_id)
       VALUES ('MergedToken_123456789', 'PVK-EEEE-6666', $1, $2)`,
      [canonical.rows[0].id, merged.rows[0].id]
    );

    assert.equal(await resolvePersonalQrRecord(db, 'PIVNIK:LeakedToken_123456789'), null);
    assert.equal(await resolvePersonalQrRecord(db, 'pvk dddd 5555'), null);
    const byMerged = await resolvePersonalQrRecord(db, 'PIVNIK:MergedToken_123456789');
    assert.equal(byMerged.qr_token, 'ReissuedToken_123456789');
  } finally {
    await db.close();
  }
});
