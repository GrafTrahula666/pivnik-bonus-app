import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

async function prepareSchema(db) {
  await db.exec(`
    CREATE TABLE users (
      id BIGSERIAL PRIMARY KEY,
      merged_into_user_id BIGINT REFERENCES users(id),
      deleted_at TIMESTAMPTZ,
      profile_frame TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE user_identities (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      provider_username TEXT,
      UNIQUE(provider, provider_user_id)
    );
    CREATE TABLE wallets (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE transactions (
      id BIGSERIAL PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      client_id BIGINT REFERENCES users(id),
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      bonus_earned BIGINT NOT NULL DEFAULT 0,
      bonus_spent BIGINT NOT NULL DEFAULT 0,
      balance_after BIGINT NOT NULL DEFAULT 0,
      reason TEXT,
      reward_code TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE reward_grants (
      code TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'system',
      achievement_code TEXT,
      achievement_period TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(code, user_id)
    );
    CREATE TABLE beta_grants (
      code TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(code, user_id)
    );
    CREATE TABLE shop_items (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE
    );
    CREATE TABLE wheel_spins (
      id BIGSERIAL PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'telegram' CONSTRAINT wheel_spins_platform_check CHECK(platform='telegram'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const migration = await readFile(new URL('../migrations/007_red_cosmos_v2.sql', import.meta.url), 'utf8');
  await db.exec(migration);
}

test('RED COSMOS tester reward is paid once for exact Telegram username and then becomes inert', async () => {
  const db = new PGlite();
  try {
    await prepareSchema(db);
    const user = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
    const userId = user.rows[0].id;
    await db.query(`INSERT INTO user_identities(user_id,provider,provider_user_id,provider_username) VALUES($1,'telegram','tg-77','@distraktor')`, [userId]);
    await db.query('INSERT INTO wallets(user_id,balance) VALUES($1,100)', [userId]);

    const first = await db.query(
      `SELECT * FROM pivnik_claim_pending_special_achievement($1,'telegram','tg-77','@distraktor')`,
      [userId]
    );
    assert.equal(first.rows[0].claimed, true);
    assert.equal(first.rows[0].recipient_handle, 'distraktor');
    assert.equal(Number(first.rows[0].awarded_bonus), 750);

    const second = await db.query(
      `SELECT * FROM pivnik_claim_pending_special_achievement($1,'telegram','tg-77','@distraktor')`,
      [userId]
    );
    assert.equal(second.rows[0].claimed, false);

    const wallet = await db.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    assert.equal(Number(wallet.rows[0].balance), 850);
    const grants = await db.query(`SELECT amount,achievement_code FROM reward_grants WHERE user_id=$1 AND achievement_code='raise-shields'`, [userId]);
    assert.equal(grants.rows.length, 1);
    assert.equal(Number(grants.rows[0].amount), 750);
    const tx = await db.query(`SELECT bonus_earned FROM transactions WHERE client_id=$1 AND mode='achievement'`, [userId]);
    assert.equal(tx.rows.length, 1);
    assert.equal(Number(tx.rows[0].bonus_earned), 750);
    const pending = await db.query(`SELECT granted_user_id FROM pending_special_achievement_recipients WHERE handle='distraktor'`);
    assert.equal(String(pending.rows[0].granted_user_id), String(userId));
  } finally {
    await db.close();
  }
});

test('RED COSMOS drolted entitlement can bind through the previously recorded stable VK identity', async () => {
  const db = new PGlite();
  try {
    await prepareSchema(db);
    const user = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
    const userId = user.rows[0].id;
    await db.query(`INSERT INTO user_identities(user_id,provider,provider_user_id,provider_username) VALUES($1,'vk','418990245','some_vk_screen_name')`, [userId]);
    await db.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [userId]);

    const claim = await db.query(
      `SELECT * FROM pivnik_claim_pending_special_achievement($1,'vk','418990245','some_vk_screen_name')`,
      [userId]
    );
    assert.equal(claim.rows[0].claimed, true);
    assert.equal(claim.rows[0].recipient_handle, 'drolted');
    assert.equal(Number(claim.rows[0].awarded_bonus), 750);
    const wallet = await db.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
    assert.equal(Number(wallet.rows[0].balance), 750);
  } finally {
    await db.close();
  }
});
