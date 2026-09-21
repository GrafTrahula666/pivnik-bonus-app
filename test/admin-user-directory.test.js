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
  assert.deepEqual(normalizeAdminUserDirectoryInput({}), {
    q: '',
    role: '',
    status: '',
    page: 1,
    limit: 200
  });
  assert.deepEqual(
    normalizeAdminUserDirectoryInput({ q: '  Alice  ', role: 'admin', status: 'active', page: '2', limit: '25' }),
    { q: 'Alice', role: 'admin', status: 'active', page: 2, limit: 25 }
  );
  assert.equal(normalizeAdminUserDirectoryInput({ limit: '2' }).limit, 5);
  assert.equal(normalizeAdminUserDirectoryInput({ limit: '999' }).limit, 100);
  assert.equal(normalizeAdminUserDirectoryInput({ role: 'root', status: 'whatever' }).role, '');
  assert.equal(normalizeAdminUserDirectoryInput({ role: 'root', status: 'whatever' }).status, '');
});

test('admin CRM status is exclusive and prioritizes new users', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  assert.equal(adminUserCrmStatus({
    created_at: '2026-09-17T12:00:00Z',
    operations_count: 0,
    last_activity_at: null
  }, now), 'new');
  assert.equal(adminUserCrmStatus({
    created_at: '2026-07-01T12:00:00Z',
    operations_count: 4,
    last_activity_at: '2026-09-15T12:00:00Z'
  }, now), 'active');
  assert.equal(adminUserCrmStatus({
    created_at: '2026-07-01T12:00:00Z',
    operations_count: 4,
    last_activity_at: '2026-07-15T12:00:00Z'
  }, now), 'inactive');
  assert.equal(adminUserCrmStatus({
    created_at: '2026-07-01T12:00:00Z',
    operations_count: 0,
    last_activity_at: null
  }, now), 'no_ops');
});

test('admin CRM directory filters real PostgreSQL rows by activity, role and VK identity', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE users (
        id BIGINT PRIMARY KEY,
        telegram_id BIGINT,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        role TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        qr_short_code TEXT,
        unlimited_bonus BOOLEAN NOT NULL DEFAULT FALSE,
        profile_frame TEXT,
        staff_pin_hash TEXT,
        staff_pin_salt TEXT,
        merged_into_user_id BIGINT,
        deleted_at TIMESTAMPTZ
      );
      CREATE TABLE wallets (
        user_id BIGINT PRIMARY KEY,
        balance BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE beer_loyalty (
        user_id BIGINT PRIMARY KEY,
        paid_ml_total INTEGER NOT NULL DEFAULT 0,
        gift_ml_balance INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE transactions (
        id BIGSERIAL PRIMARY KEY,
        client_id BIGINT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE user_identities (
        user_id BIGINT NOT NULL,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL
      );

      INSERT INTO users (id, telegram_id, username, first_name, last_name, role, created_at, qr_short_code)
      VALUES
        (1, 101, 'new_user', 'Новый', 'Гость', 'client', NOW() - INTERVAL '2 days', 'NEW001'),
        (2, 102, 'active_user', 'Активный', 'Гость', 'client', NOW() - INTERVAL '80 days', 'ACT002'),
        (3, 103, 'inactive_user', 'Спящий', 'Гость', 'client', NOW() - INTERVAL '120 days', 'OLD003'),
        (4, 104, 'no_ops_user', 'Без', 'Операций', 'viewer', NOW() - INTERVAL '100 days', 'NOP004');

      INSERT INTO wallets (user_id, balance) VALUES (1,10),(2,20),(3,30),(4,40);
      INSERT INTO beer_loyalty (user_id) VALUES (1),(2),(3),(4);
      INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES
        (1, 'vk', '900001'),
        (2, 'vk', '900002'),
        (3, 'telegram', '103'),
        (4, 'vk', '900004');

      INSERT INTO transactions (client_id, status, created_at) VALUES
        (2, 'completed', NOW() - INTERVAL '4 days'),
        (2, 'completed', NOW() - INTERVAL '10 days'),
        (3, 'completed', NOW() - INTERVAL '45 days'),
        (4, 'cancelled', NOW() - INTERVAL '1 day');
    `);

    const active = await queryAdminUserDirectory(db, { status: 'active', limit: '25' });
    assert.deepEqual(active.rows.map((row) => String(row.id)), ['2']);
    assert.equal(active.rows[0].operations_count, 2);
    assert.equal(active.pagination.total, 1);

    const inactive = await queryAdminUserDirectory(db, { status: 'inactive', limit: '25' });
    assert.deepEqual(inactive.rows.map((row) => String(row.id)), ['3']);

    const noOps = await queryAdminUserDirectory(db, { status: 'no_ops', limit: '25' });
    assert.deepEqual(noOps.rows.map((row) => String(row.id)), ['4']);

    const fresh = await queryAdminUserDirectory(db, { status: 'new', limit: '25' });
    assert.deepEqual(fresh.rows.map((row) => String(row.id)), ['1']);

    const vkSearch = await queryAdminUserDirectory(db, { q: '900002', limit: '25' });
    assert.deepEqual(vkSearch.rows.map((row) => String(row.id)), ['2']);
    assert.equal(String(vkSearch.rows[0].vk_id), '900002');

    const viewer = await queryAdminUserDirectory(db, { role: 'viewer', limit: '25' });
    assert.deepEqual(viewer.rows.map((row) => String(row.id)), ['4']);

    await db.exec(`
      INSERT INTO users (id, role, created_at)
      SELECT n, 'staff', '2026-01-01T00:00:00Z'::timestamptz FROM generate_series(10, 21) n;
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

test('admin CRM pagination reports totals and clamps pages after filtering', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT COUNT\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 53 }] };
      return { rows: [] };
    }
  };

  const result = await queryAdminUserDirectory(pool, {
    q: 'anna',
    role: 'client',
    status: 'active',
    page: '2',
    limit: '25'
  });

  assert.deepEqual(result.pagination, { page: 2, limit: 25, total: 53, pages: 3 });
  assert.deepEqual(calls[0].params, ['%anna%', 'client']);
  assert.deepEqual(calls[1].params, ['%anna%', 'client', 25, 25]);
  assert.match(calls[0].sql, /ui_search\.provider_user_id::text ILIKE/);
  assert.match(calls[0].sql, /activity\.last_activity_at >= NOW\(\) - INTERVAL '30 days'/);
  assert.match(calls[1].sql, /LIMIT \$3/);
  assert.match(calls[1].sql, /OFFSET \$4/);
});


test('admin CRM never presents a URL as the user identity', () => {
  assert.equal(isAdminUserUrlLike('https://example.com/profile'), true);
  assert.equal(isAdminUserUrlLike('www.example.com'), true);
  assert.equal(isAdminUserUrlLike('normal_user'), false);

  assert.equal(
    adminUserDisplayName({
      id: 7,
      first_name: 'https://example.com/profile',
      last_name: '',
      username: 'kirill',
      telegram_id: 7001,
      vk_id: null
    }),
    'kirill'
  );

  assert.equal(
    adminUserDisplayName({
      id: 8,
      first_name: 'www.example.com',
      last_name: 'https://vk.com/id8',
      username: 'https://example.com',
      telegram_id: null,
      vk_id: '8001'
    }),
    'Пользователь VK'
  );

  assert.equal(adminUserDisplayUsername('https://example.com'), null);
  assert.equal(adminUserDisplayUsername('@real_user'), 'real_user');
});
