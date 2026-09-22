import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import {
  adminUserCrmStatus,
  adminUserDisplayName,
  adminUserDisplayUsername,
  isAdminUserUrlLike,
  normalizeAdminUserDirectoryInput,
  queryAdminUserDirectory
} from '../admin-user-directory.js';

test('admin CRM query keeps legacy default size but clamps explicit directory controls', () => {
  assert.deepEqual(normalizeAdminUserDirectoryInput({}), { q: '', role: '', status: '', page: 1, limit: 200 });
  assert.deepEqual(
    normalizeAdminUserDirectoryInput({ q: '  Alice  ', role: 'admin', status: 'at_risk', page: '2', limit: '25' }),
    { q: 'Alice', role: 'admin', status: 'at_risk', page: 2, limit: 25 }
  );
  assert.equal(normalizeAdminUserDirectoryInput({ limit: '2' }).limit, 5);
  assert.equal(normalizeAdminUserDirectoryInput({ limit: '999' }).limit, 100);
  assert.equal(normalizeAdminUserDirectoryInput({ role: 'root', status: 'whatever' }).role, '');
  assert.equal(normalizeAdminUserDirectoryInput({ role: 'root', status: 'whatever' }).status, '');
});

test('admin CRM lifecycle matches Customer 360 boundaries', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  assert.equal(adminUserCrmStatus({ created_at: '2026-09-01T12:00:00Z', operations_count: 0, last_activity_at: null }, now), 'new');
  assert.equal(adminUserCrmStatus({ created_at: '2026-07-01T12:00:00Z', operations_count: 4, last_activity_at: '2026-09-15T12:00:00Z' }, now), 'active');
  assert.equal(adminUserCrmStatus({ created_at: '2026-07-01T12:00:00Z', operations_count: 4, last_activity_at: '2026-08-05T12:00:00Z' }, now), 'at_risk');
  assert.equal(adminUserCrmStatus({ created_at: '2026-06-01T12:00:00Z', operations_count: 4, last_activity_at: '2026-07-01T12:00:00Z' }, now), 'sleeping');
  assert.equal(adminUserCrmStatus({ created_at: '2026-07-01T12:00:00Z', operations_count: 0, last_activity_at: null }, now), 'no_visits');
});

test('admin CRM directory filters real PostgreSQL rows with Customer 360 lifecycle semantics', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGINT PRIMARY KEY, telegram_id BIGINT, username TEXT, first_name TEXT, last_name TEXT,
        role TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, qr_short_code TEXT,
        unlimited_bonus BOOLEAN NOT NULL DEFAULT FALSE, profile_frame TEXT, staff_pin_hash TEXT,
        staff_pin_salt TEXT, merged_into_user_id BIGINT, deleted_at TIMESTAMPTZ
      );
      CREATE TABLE wallets (user_id BIGINT PRIMARY KEY, balance BIGINT NOT NULL DEFAULT 0);
      CREATE TABLE beer_loyalty (user_id BIGINT PRIMARY KEY, paid_ml_total INTEGER NOT NULL DEFAULT 0, gift_ml_balance INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE transactions (id BIGSERIAL PRIMARY KEY, client_id BIGINT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE user_identities (user_id BIGINT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL);

      INSERT INTO users (id, telegram_id, username, first_name, last_name, role, created_at, qr_short_code) VALUES
        (1, 101, 'new_user', 'Новый', 'Гость', 'client', NOW() - INTERVAL '2 days', 'NEW001'),
        (2, 102, 'active_user', 'Активный', 'Гость', 'client', NOW() - INTERVAL '80 days', 'ACT002'),
        (3, 103, 'risk_user', 'Риск', 'Гость', 'client', NOW() - INTERVAL '120 days', 'RSK003'),
        (4, 104, 'sleep_user', 'Спящий', 'Гость', 'client', NOW() - INTERVAL '180 days', 'SLP004'),
        (5, 105, 'no_visit_user', 'Без', 'Визитов', 'viewer', NOW() - INTERVAL '100 days', 'NOV005');
      INSERT INTO wallets (user_id, balance) VALUES (1,10),(2,20),(3,30),(4,40),(5,50);
      INSERT INTO beer_loyalty (user_id) VALUES (1),(2),(3),(4),(5);
      INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES
        (1, 'vk', '900001'), (2, 'vk', '900002'), (3, 'telegram', '103'), (4, 'vk', '900004'), (5, 'vk', '900005');
      INSERT INTO transactions (client_id, status, mode, created_at) VALUES
        (2, 'completed', 'accrue', NOW() - INTERVAL '4 days'),
        (2, 'completed', 'redeem', NOW() - INTERVAL '10 days'),
        (3, 'completed', 'accrue', NOW() - INTERVAL '45 days'),
        (4, 'completed', 'redeem', NOW() - INTERVAL '75 days'),
        (5, 'completed', 'adjustment', NOW() - INTERVAL '1 day');
    `);

    const active = await queryAdminUserDirectory(db, { status: 'active', limit: '25' });
    assert.deepEqual(active.rows.map((row) => String(row.id)), ['2']);
    assert.equal(active.rows[0].operations_count, 2);

    const atRisk = await queryAdminUserDirectory(db, { status: 'at_risk', limit: '25' });
    assert.deepEqual(atRisk.rows.map((row) => String(row.id)), ['3']);

    const sleeping = await queryAdminUserDirectory(db, { status: 'sleeping', limit: '25' });
    assert.deepEqual(sleeping.rows.map((row) => String(row.id)), ['4']);

    const noVisits = await queryAdminUserDirectory(db, { status: 'no_visits', limit: '25' });
    assert.deepEqual(noVisits.rows.map((row) => String(row.id)), ['5']);
    assert.equal(noVisits.rows[0].operations_count, 0, 'manual adjustments are not visits');

    const fresh = await queryAdminUserDirectory(db, { status: 'new', limit: '25' });
    assert.deepEqual(fresh.rows.map((row) => String(row.id)), ['1']);

    const legacyInactive = await queryAdminUserDirectory(db, { status: 'inactive', limit: '25' });
    assert.deepEqual(legacyInactive.rows.map((row) => String(row.id)).sort(), ['3', '4']);
    const legacyNoOps = await queryAdminUserDirectory(db, { status: 'no_ops', limit: '25' });
    assert.deepEqual(legacyNoOps.rows.map((row) => String(row.id)), ['5']);

    const vkSearch = await queryAdminUserDirectory(db, { q: '900002', limit: '25' });
    assert.deepEqual(vkSearch.rows.map((row) => String(row.id)), ['2']);
    assert.equal(String(vkSearch.rows[0].vk_id), '900002');

    const viewer = await queryAdminUserDirectory(db, { role: 'viewer', limit: '25' });
    assert.deepEqual(viewer.rows.map((row) => String(row.id)), ['5']);

    await db.exec(`
      INSERT INTO users (id, role, created_at) SELECT n, 'staff', '2026-01-01T00:00:00Z'::timestamptz FROM generate_series(10, 21) n;
      INSERT INTO wallets (user_id) SELECT n FROM generate_series(10, 21) n;
    `);
    const firstPage = await queryAdminUserDirectory(db, { role: 'staff', limit: '5', page: '1' });
    const secondPage = await queryAdminUserDirectory(db, { role: 'staff', limit: '5', page: '2' });
    assert.deepEqual(firstPage.rows.map(row => String(row.id)), ['21', '20', '19', '18', '17']);
    assert.deepEqual(secondPage.rows.map(row => String(row.id)), ['16', '15', '14', '13', '12']);
    const legacy = await queryAdminUserDirectory(db);
    assert.equal(String(legacy.rows[0].id), '1', 'legacy directory keeps creation-date order');
  } finally {
    await db.close();
  }
});

test('admin CRM pagination reports totals and lifecycle SQL boundaries', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 53 }] };
      return { rows: [] };
    }
  };

  const result = await queryAdminUserDirectory(pool, { q: 'anna', role: 'client', status: 'at_risk', page: '2', limit: '25' });
  assert.deepEqual(result.pagination, { page: 2, limit: 25, total: 53, pages: 3 });
  assert.deepEqual(calls[0].params, ['%anna%', 'client']);
  assert.deepEqual(calls[1].params, ['%anna%', 'client', 25, 25]);
  assert.match(calls[0].sql, /ui_search\.provider_user_id::text ILIKE/);
  assert.match(calls[0].sql, /activity\.last_activity_at < NOW\(\) - INTERVAL '30 days'/);
  assert.match(calls[0].sql, /activity\.last_activity_at >= NOW\(\) - INTERVAL '60 days'/);
  assert.match(calls[0].sql, /t\.mode IN \('accrue','redeem'\)/);
  assert.match(calls[1].sql, /LIMIT \$3/);
  assert.match(calls[1].sql, /OFFSET \$4/);
});

test('admin CRM never presents a URL as the user identity', () => {
  assert.equal(isAdminUserUrlLike('https://example.com/profile'), true);
  assert.equal(isAdminUserUrlLike('www.example.com'), true);
  assert.equal(isAdminUserUrlLike('normal_user'), false);
  assert.equal(adminUserDisplayName({ id: 7, first_name: 'https://example.com/profile', last_name: '', username: 'kirill', telegram_id: 7001, vk_id: null }), 'kirill');
  assert.equal(adminUserDisplayName({ id: 8, first_name: 'www.example.com', last_name: 'https://vk.com/id8', username: 'https://example.com', telegram_id: null, vk_id: '8001' }), 'Пользователь VK');
  assert.equal(adminUserDisplayUsername('https://example.com'), null);
  assert.equal(adminUserDisplayUsername('@real_user'), 'real_user');
});
