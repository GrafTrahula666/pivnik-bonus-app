import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { normalizeRequestKey } from '../platform-core.js';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source anchors: ${start}`);
  return source.slice(from, to);
}
const lock = between('async function lockRequestKey(', 'function signSession(');
const engine = between('async function cancelCompletedTransaction(', "app.get('/api/health'");
const unlimited = between('function hasUnlimitedBonus(', '// Anna frame entitlement');
const route = between("app.post('/api/admin/transactions/:id/cancel'", "app.post('/api/admin/users/:id/cancel-limit/reset'");

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  for (const table of ['users', 'wallets', 'beer_loyalty', 'transactions']) {
    const match = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(match, `Missing ${table} schema`); await db.exec(match[0]);
  }
  const upgrades = source.match(/ALTER TABLE (?:users ADD COLUMN IF NOT EXISTS (?:merged_into_user_id|unlimited_bonus)[^'\n]*|wallets ALTER COLUMN balance TYPE BIGINT|transactions (?:ALTER COLUMN (?:balance_after|bonus_spent|bonus_earned) TYPE BIGINT|ADD COLUMN IF NOT EXISTS (?:beer_ml|beer_gift_earned_ml|beer_gift_spent_ml|cancelled_by|cancelled_at|cancel_reason|cancel_request_key)[^'\n]*))/g);
  assert.equal(upgrades.length, 13);
  for (const sql of upgrades) await db.exec(sql);
  // Same unique cancellation key constraint as main startup.
  const index = source.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_cancel_request_key[^'\n]*/);
  assert.ok(index); await db.exec(index[0]);
  await db.exec(`
    ALTER TABLE transactions DROP CONSTRAINT transactions_mode_check;
    ALTER TABLE transactions ADD CONSTRAINT transactions_mode_check
      CHECK (mode IN ('accrue','redeem','adjustment','beer_gift','shop'));
    INSERT INTO users (id, first_name, role) VALUES (10, 'Owner', 'admin'),
      (11, 'Other owner', 'admin'), (20, 'Client', 'client');
    INSERT INTO wallets (user_id, balance) VALUES (20, 100);
    INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance) VALUES (20, 1000, 700);
  `);
  const query = async (sql, values = []) => {
    const result = await db.query(sql, values);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  let releases = 0, notifications = 0;
  const pool = { async connect() { return { query, release() { releases++; } }; } };
  const cancel = new Function('isOwnerRow', 'UNLIMITED_BONUS_BALANCE', unlimited + lock + engine + '\nreturn cancelCompletedTransaction;')(
    () => false, 999999999);
  let execute;
  new Function('app', 'authRequired', 'requireRole', 'normalizeRequestKey', 'pool',
    'cancelCompletedTransaction', 'getProfile', 'sendTelegramMessage', 'transactionResponse', route)(
    { post(path, ...handlers) { execute = handlers.at(-1); } }, () => {}, () => () => {}, normalizeRequestKey, pool, cancel,
    async id => ({ id: String(id), telegramId: 'fixture', balance: Number((await query('SELECT balance FROM wallets WHERE user_id = $1', [id])).rows[0].balance) }),
    async () => { notifications++; }, row => row);
  return {
    db, cancel,
    get releases() { return releases; }, get notifications() { return notifications; },
    async seed({ mode = 'accrue', earned = 25, spent = 0, paidMl = 500, giftEarned = 200, giftSpent = 0 } = {}) {
      await query(`INSERT INTO transactions (id, request_key, client_id, staff_id, mode,
        bonus_earned, bonus_spent, beer_ml, beer_gift_earned_ml, beer_gift_spent_ml)
        VALUES (30, 'original-fixture-sale', 20, 10, $1, $2, $3, $4, $5, $6)`,
      [mode, earned, spent, paidMl, giftEarned, giftSpent]);
    },
    async snapshot() {
      return {
        wallet: (await query('SELECT balance FROM wallets WHERE user_id = 20')).rows,
        beer: (await query('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = 20')).rows,
        journal: (await query('SELECT * FROM transactions ORDER BY id')).rows
      };
    },
    async invoke({ id = '30', actor = '10', reason = 'Fixture cancellation', key = 'sql-cancellation-fixture' } = {}) {
      const replies = [], errors = [];
      const res = { status(code) { this.code = code; return this; }, json(value) { replies.push({ status: this.code || 200, body: value }); } };
      await execute({ params: { id }, user: { id: actor }, body: { reason, requestKey: key } }, res, error => errors.push(error));
      return { replies, errors };
    },
    async scoped(options) {
      await query('BEGIN');
      try { const result = await cancel({ query }, '30', '10', 'Fixture cancellation', 'scoped-cancellation-key', options); await query('COMMIT'); return result; }
      catch (error) { await query('ROLLBACK'); throw error; }
    }
  };
}

test('cancellation SQL: supported modes reverse wallet/beer and journal actor/reason atomically', async t => {
  for (const mode of ['accrue', 'redeem', 'shop', 'beer_gift']) {
    const h = await fixture(t);
    const sale = ['accrue', 'redeem'].includes(mode);
    await h.seed({ mode, earned: mode === 'accrue' ? 25 : 0, spent: ['redeem', 'shop'].includes(mode) ? 10 : 0,
      paidMl: sale ? 500 : 0, giftEarned: sale ? 200 : 0, giftSpent: mode === 'beer_gift' ? 100 : 0 });
    const result = await h.invoke(); assert.deepEqual(result.errors, []);
    assert.equal(result.replies[0].status, 200); assert.equal(result.replies[0].body.ok, true);
    const s = await h.snapshot();
    assert.equal(Number(s.wallet[0].balance), mode === 'accrue' ? 75 : mode === 'beer_gift' ? 100 : 110);
    assert.deepEqual(s.beer.map(row => [Number(row.paid_ml_total), Number(row.gift_ml_balance)]),
      [[sale ? 500 : 1000, sale ? 500 : mode === 'beer_gift' ? 800 : 700]]);
    assert.equal(s.journal.length, 1); assert.equal(s.journal[0].status, 'cancelled');
    assert.equal(Number(s.journal[0].cancelled_by), 10); assert.equal(s.journal[0].cancel_reason, 'Fixture cancellation');
    assert.equal(s.journal[0].cancel_request_key, 'sql-cancellation-fixture'); assert.ok(s.journal[0].cancelled_at);
    assert.equal(h.notifications, 1); assert.equal(h.releases, 1);
  }
});

test('cancellation SQL: replay cannot refund twice; actor/reason/transaction conflicts preserve tables', async t => {
  const h = await fixture(t); await h.seed(); await h.invoke(); const before = await h.snapshot();
  const replay = await h.invoke(); assert.equal(replay.replies[0].body.transaction.__idempotentReplay, true);
  assert.equal(h.notifications, 1); assert.deepEqual(await h.snapshot(), before);
  for (const options of [{ actor: '11' }, { reason: 'Changed reason' }, { id: '31' }]) {
    assert.equal((await h.invoke(options)).replies[0].status, 409);
    assert.deepEqual(await h.snapshot(), before);
  }
  assert.equal((await h.invoke({ key: 'different-cancellation-key' })).replies[0].status, 400);
  assert.deepEqual(await h.snapshot(), before);
});

test('cancellation SQL: journal UPDATE failure rolls wallet/beer back; same key retry succeeds', async t => {
  const h = await fixture(t); await h.seed(); const before = await h.snapshot();
  await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_cancel_failure CHECK (status <> 'cancelled')");
  const result = await h.invoke(); assert.equal(result.errors[0].code, '23514'); assert.deepEqual(result.replies, []);
  assert.deepEqual(await h.snapshot(), before); assert.equal(h.notifications, 0); assert.equal(h.releases, 1);
  await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_cancel_failure');
  assert.equal((await h.invoke()).replies[0].status, 200); assert.equal(h.notifications, 1);
  assert.equal((await h.snapshot()).journal[0].status, 'cancelled');
});

test('cancellation SQL: consumed rewards, missing transaction and unsupported mode preserve state', async t => {
  for (const setup of ["UPDATE wallets SET balance = 0", "UPDATE beer_loyalty SET gift_ml_balance = 0", "UPDATE beer_loyalty SET paid_ml_total = 0", "UPDATE transactions SET mode = 'adjustment'"]) {
    const h = await fixture(t); await h.seed(); await h.db.exec(setup); const before = await h.snapshot();
    assert.equal((await h.invoke()).replies[0].status, setup.includes('adjustment') ? 400 : 409);
    assert.deepEqual(await h.snapshot(), before); assert.equal(h.notifications, 0);
  }
  const h = await fixture(t); const before = await h.snapshot();
  assert.equal((await h.invoke()).replies[0].status, 404); assert.deepEqual(await h.snapshot(), before);
});

test('cancellation SQL: employee cannot reverse another employee or earlier-shift operation', async t => {
  const h = await fixture(t); await h.seed(); const before = await h.snapshot();
  for (const options of [{ staffId: '11' }, { staffId: '10', notBefore: '2999-01-01T00:00:00Z' }]) {
    await assert.rejects(h.scoped(options), error => error.statusCode === 403);
    assert.deepEqual(await h.snapshot(), before);
  }
});

test('cancellation SQL: unlimited wallet remains unchanged and invalid reason/key performs no mutation', async t => {
  const h = await fixture(t); await h.seed(); const before = await h.snapshot();
  for (const options of [{ reason: 'x' }, { key: '' }]) {
    assert.equal((await h.invoke(options)).replies[0].status, 400); assert.deepEqual(await h.snapshot(), before);
  }
  assert.equal(h.releases, 0);
  await h.db.exec('UPDATE users SET unlimited_bonus = TRUE WHERE id = 20');
  assert.equal((await h.invoke()).replies[0].status, 200);
  assert.deepEqual((await h.snapshot()).wallet, before.wallet);
});
