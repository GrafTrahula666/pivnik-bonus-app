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
const route = between("app.post('/api/staff/transactions/:id/cancel'", "app.get('/api/staff/transactions/:id'");

async function fixture(t, failureAt) {
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
    INSERT INTO users (id, first_name, role) VALUES (10, 'Employee', 'staff'),
      (11, 'Other owner', 'admin'), (20, 'Client', 'client');
    INSERT INTO wallets (user_id, balance) VALUES (20, 100);
    INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance) VALUES (20, 1000, 700);
  `);
  const query = async (sql, values = []) => {
    const result = await db.query(sql, values);
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  let releases = 0, notifications = 0;
  const pool = { query, async connect() { return { query, release() { releases++; } }; } };
  const cancel = new Function('isOwnerRow', 'UNLIMITED_BONUS_BALANCE', unlimited + lock + engine + '\nreturn cancelCompletedTransaction;')(
    () => false, 999999999);
  let execute;
  new Function('app', 'authRequired', 'requireRole', 'normalizeRequestKey', 'pool',
    'cancelCompletedTransaction', 'getProfile', 'sendTelegramMessage', 'transactionResponse', 'resolveActingStaff', 'unlimitedCancellationQuota', 'getCancellationQuota', 'console', route)(
    { post(path, ...handlers) { execute = handlers.at(-1); } }, () => {}, () => () => {}, normalizeRequestKey, pool, cancel,
    async id => { if (failureAt === 'profile') throw new Error('Fixture private profile failure'); return ({ id: String(id), telegramId: 'fixture', balance: Number((await query('SELECT balance FROM wallets WHERE user_id = $1', [id])).rows[0].balance) }); },
    async () => { notifications++; return { ok: false }; }, row => row,
    async () => ({ id: '10', role: 'staff' }), () => ({ unlimited: true }),
    async (id, client) => {
      if (failureAt === 'quota' && !client) throw new Error('Fixture private quota failure');
      const count = (await query("SELECT COUNT(*) AS n FROM transactions WHERE cancelled_by = $1", [id])).rows[0].n;
      return { active: true, countFrom: '2000-01-01T00:00:00Z', remaining: 3 - Number(count) };
    }, { error() {} });
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

test('staff cancellation SQL: confirmed profile/quota error and replay preserve one reversal', async t => {
  for (const failureAt of ['profile', 'quota']) {
    const h = await fixture(t, failureAt); await h.seed();
    const first = await h.invoke();
    assert.deepEqual(first.errors, []); assert.equal(first.replies[0].status, 503);
    assert.equal(first.replies[0].body.code, 'cancellation_committed');
    assert.equal(first.replies[0].body.cancelled, true);
    const saved = await h.snapshot();
    assert.equal(Number(saved.wallet[0].balance), 75);
    assert.deepEqual(saved.beer.map(row => [Number(row.paid_ml_total), Number(row.gift_ml_balance)]), [[500, 500]]);
    assert.equal(saved.journal[0].status, 'cancelled');
    assert.equal(Number(saved.journal[0].cancelled_by), 10);
    assert.equal(saved.journal[0].cancel_reason, 'Fixture cancellation');
    const replay = await h.invoke();
    assert.equal(replay.replies[0].body.cancelled, true);
    assert.deepEqual(await h.snapshot(), saved);
    assert.equal(h.releases, 1); assert.equal(h.notifications, failureAt === 'quota' ? 1 : 0);
    const conflict = await h.invoke({ reason: 'Changed reason' });
    assert.equal(conflict.replies[0].status, 409); assert.deepEqual(await h.snapshot(), saved);
  }
});

test('staff cancellation SQL: journal failure and foreign employee do not confirm saved reversal', async t => {
  const h = await fixture(t, 'profile'); await h.seed(); const before = await h.snapshot();
  await h.db.exec("ALTER TABLE transactions ADD CONSTRAINT fixture_cancel_failure CHECK (status <> 'cancelled')");
  const failed = await h.invoke(); assert.equal(failed.errors[0].code, '23514');
  assert.deepEqual(failed.replies, []); assert.deepEqual(await h.snapshot(), before);
  await h.db.exec('ALTER TABLE transactions DROP CONSTRAINT fixture_cancel_failure');
  await h.db.exec('UPDATE transactions SET staff_id = 11'); const foreign = await h.snapshot();
  const denied = await h.invoke(); assert.equal(denied.replies[0].status, 403);
  assert.equal(denied.replies[0].body.cancelled, undefined); assert.deepEqual(await h.snapshot(), foreign);
  assert.equal(h.notifications, 0);
});
