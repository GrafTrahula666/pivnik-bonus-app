import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  activeAchievementCatalog,
  configureAchievements,
  evaluateAchievementCatalog,
  getUserAchievementState,
  grantAchievementManually,
  normalizeAchievementSettings,
  syncUserAchievements
} from '../achievements.js';
import { giftedFrameChoices } from '../personal-profile-frames.js';
import { onRuntimeConfig, refreshRuntimeConfig, saveRuntimeConfig, BUSINESS_RUNTIME_CONFIG_SQL } from '../business-runtime-config.js';

async function rewardsDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE, first_name TEXT NOT NULL,
      merged_into_user_id BIGINT REFERENCES users(id), deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY, request_key TEXT UNIQUE, client_id BIGINT NOT NULL REFERENCES users(id),
      mode TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed',
      check_amount_cents BIGINT NOT NULL DEFAULT 0, cash_paid_cents BIGINT NOT NULL DEFAULT 0,
      bonus_spent BIGINT NOT NULL DEFAULT 0, bonus_earned BIGINT NOT NULL DEFAULT 0,
      beer_gift_earned_ml BIGINT NOT NULL DEFAULT 0, balance_after BIGINT, reason TEXT, reward_code TEXT,
      completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE reward_grants (
      code TEXT NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (code, user_id)
    );
    CREATE TABLE wallets (user_id BIGINT PRIMARY KEY REFERENCES users(id), balance BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE beer_loyalty (user_id BIGINT PRIMARY KEY REFERENCES users(id), paid_ml_total BIGINT NOT NULL DEFAULT 0, gift_ml_balance BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await db.exec(await readFile(new URL('../migrations/002_countable_achievements.sql', import.meta.url), 'utf8'));
  const user = await db.query(`INSERT INTO users (telegram_id, first_name) VALUES (2001, 'Гость') RETURNING id`);
  const userId = user.rows[0].id;
  await db.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [userId]);
  return { db, userId };
}

test.afterEach(() => configureAchievements(null));

test('Business settings: off, other reward, own achievements; broken settings fall back', () => {
  configureAchievements({
    overrides: { 'first-purchase': { rewardBonus: 50 }, 'three-purchases': { enabled: false }, unknown: { enabled: false } },
    custom: [{ code: 'custom-birthday', title: 'С днём рождения', description: 'Подарок', rarity: 'epic', rewardBonus: 200 }]
  });
  const catalog = activeAchievementCatalog();
  assert.equal(catalog.find((item) => item.code === 'first-purchase').rewardBonus, 50);
  assert.equal(catalog.find((item) => item.code === 'three-purchases').enabled, false);
  assert.equal(catalog.find((item) => item.code === 'custom-birthday').manual, true);
  const evaluated = evaluateAchievementCatalog({ purchaseCount: 5 });
  assert.equal(evaluated.some((item) => item.code === 'three-purchases'), false);
  assert.equal(evaluated.some((item) => item.code === 'custom-birthday'), false);

  assert.throws(() => normalizeAchievementSettings({ custom: [{ code: 'birthday', title: 'x' }] }), /custom-/);
  assert.throws(() => normalizeAchievementSettings({ overrides: { 'first-purchase': { rewardBonus: -1 } } }), /награда/);
  configureAchievements({ custom: [{ code: 'bad', title: '' }] });
  assert.equal(activeAchievementCatalog().some((item) => item.manual), false);
});

test('PostgreSQL: switched-off achievement is not awarded, override reward is paid', async () => {
  const { db, userId } = await rewardsDb();
  try {
    await db.query(
      `INSERT INTO transactions (request_key, client_id, mode, check_amount_cents, cash_paid_cents)
       SELECT 'p-' || n, $1, 'accrue', 10000, 10000 FROM generate_series(1, 3) n`,
      [userId]
    );
    configureAchievements({ overrides: { 'first-purchase': { rewardBonus: 77 }, 'three-purchases': { enabled: false } } });
    const { granted } = await syncUserAchievements(db, userId);
    assert.deepEqual(granted, ['achievement:first-purchase']);
    assert.equal(Number((await db.query('SELECT balance FROM wallets WHERE user_id = $1', [userId])).rows[0].balance), 77);
  } finally {
    await db.close();
  }
});

test('PostgreSQL: manual grant pays once, shows to the guest and blocks the automatic double', async () => {
  const { db, userId } = await rewardsDb();
  try {
    configureAchievements({ custom: [{ code: 'custom-hero', title: 'Герой вечера', rewardBonus: 150 }] });
    const result = await grantAchievementManually(db, userId, 'custom-hero');
    assert.equal(result.rewardBonus, 150);
    assert.equal(result.balance, 150);
    await assert.rejects(grantAchievementManually(db, userId, 'custom-hero'), (error) => error.statusCode === 409);
    await assert.rejects(grantAchievementManually(db, userId, 'monthly-top-spender'), (error) => error.statusCode === 400);
    await assert.rejects(grantAchievementManually(db, userId, 'nope'), (error) => error.statusCode === 404);

    await grantAchievementManually(db, userId, 'first-purchase');
    await db.query(`INSERT INTO transactions (request_key, client_id, mode, cash_paid_cents) VALUES ('p-1', $1, 'accrue', 100)`, [userId]);
    const sync = await syncUserAchievements(db, userId);
    assert.equal(sync.granted.includes('achievement:first-purchase'), false);

    const state = await getUserAchievementState(db, userId, { sync: false });
    const hero = state.achievements.find((item) => item.code === 'custom-hero');
    assert.equal(hero.earned, true);
    assert.ok(state.unannounced.some((item) => item.code === 'custom-hero'));
    const tx = await db.query(`SELECT reason FROM transactions WHERE mode = 'achievement' AND reward_code = 'achievement:custom-hero'`);
    assert.match(tx.rows[0].reason, /Герой вечера/);
  } finally {
    await db.close();
  }
});

test('Runtime config is read from the database and applied', async () => {
  const db = new PGlite();
  try {
    const seen = [];
    onRuntimeConfig('test-key', (value) => seen.push(value));
    assert.equal(await refreshRuntimeConfig(db), false);
    await db.exec(BUSINESS_RUNTIME_CONFIG_SQL);
    await saveRuntimeConfig(db, 'test-key', { a: 1 }, 'owner');
    assert.equal(await refreshRuntimeConfig(db), true);
    assert.deepEqual(seen, [{ a: 1 }, { a: 1 }]);
  } finally {
    await db.close();
  }
});

test('Frames given from Business become selectable', () => {
  const codes = (row) => giftedFrameChoices(row).map((frame) => frame.code);
  assert.deepEqual(codes({ profile_frame: 'none', owned_frame_ids: ['fire', 'diamond'] }), ['fire', 'diamond']);
  assert.deepEqual(codes({ profile_frame: 'none', owned_frame_ids: ['gold-bars', 'unknown'] }), ['gold-bars']);
  assert.deepEqual(codes({ profile_frame: 'money' }), ['money']);
});
