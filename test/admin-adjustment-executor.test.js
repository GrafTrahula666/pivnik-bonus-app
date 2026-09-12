import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminAdjustmentExecutorContract,
  createAdminAdjustmentExecutor
} from '../admin-adjustment-executor.js';

function createHarness({
  balance = 100,
  existing = null,
  target = { id: '42', telegram_id: 'tg-42', role: 'client', unlimited_bonus: false },
  persistenceError = null
} = {}) {
  const events = [];
  let released = false;
  const persisted = [];

  const client = {
    async query(sql, params = []) {
      events.push({ type: 'query', sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.includes('FROM users')) return target ? { rowCount: 1, rows: [target] } : { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT balance FROM wallets')) {
        return target ? { rowCount: 1, rows: [{ balance }] } : { rowCount: 0, rows: [] };
      }
      if (sql.startsWith('SELECT * FROM transactions')) {
        return existing ? { rowCount: 1, rows: [existing] } : { rowCount: 0, rows: [] };
      }
      if (sql.startsWith('UPDATE wallets')) return { rowCount: 1, rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() {
      released = true;
      events.push({ type: 'release' });
    }
  };

  const pool = {
    async connect() {
      events.push({ type: 'connect' });
      return client;
    }
  };

  const replayChecks = [];
  const executor = createAdminAdjustmentExecutor({
    pool,
    lockRequestKey: async (_client, requestKey) => {
      events.push({ type: 'request-lock', requestKey });
    },
    assertMatchingTransaction: (transaction, expected) => {
      replayChecks.push({ transaction, expected });
      events.push({ type: 'replay-assert' });
    },
    hasUnlimitedBonus: (row) => Boolean(row?.unlimited_bonus) || row?.role === 'viewer',
    createPersistence: ({ query }) => {
      assert.equal(typeof query, 'function');
      return async ({ transaction }) => {
        events.push({ type: 'persist' });
        if (persistenceError) throw persistenceError;
        persisted.push(transaction);
        return { rowCount: 1 };
      };
    }
  });

  return {
    executor,
    events,
    persisted,
    replayChecks,
    wasReleased: () => released
  };
}

function queryIndex(events, matcher) {
  return events.findIndex((event) => event.type === 'query' && matcher(event.sql));
}

test('executor preserves atomic lock/mutation/journal order and commits once', async () => {
  const harness = createHarness({ balance: 100 });
  const result = await harness.executor({
    customerId: '42',
    actorId: '7',
    amount: 25,
    reason: 'Service correction',
    requestKey: 'adjust-1'
  });

  assert.deepEqual(result, {
    ok: true,
    replayed: false,
    customerId: '42',
    balanceBefore: 100,
    balanceAfter: 125
  });
  assert.equal(harness.persisted.length, 1);
  assert.deepEqual(harness.persisted[0], {
    request_key: 'adjust-1',
    client_id: '42',
    staff_id: '7',
    mode: 'adjustment',
    status: 'completed',
    bonus_spent: 0,
    bonus_earned: 25,
    balance_after: 125,
    reason: 'Service correction'
  });

  const begin = queryIndex(harness.events, (sql) => sql === 'BEGIN');
  const lock = harness.events.findIndex((event) => event.type === 'request-lock');
  const user = queryIndex(harness.events, (sql) => sql.includes('FROM users'));
  const wallet = queryIndex(harness.events, (sql) => sql.startsWith('SELECT balance FROM wallets'));
  const replay = queryIndex(harness.events, (sql) => sql.startsWith('SELECT * FROM transactions'));
  const update = queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets'));
  const persist = harness.events.findIndex((event) => event.type === 'persist');
  const commit = queryIndex(harness.events, (sql) => sql === 'COMMIT');

  assert.ok(begin < lock);
  assert.ok(lock < user);
  assert.ok(user < wallet);
  assert.ok(wallet < replay);
  assert.ok(replay < update);
  assert.ok(update < persist);
  assert.ok(persist < commit);
  assert.equal(queryIndex(harness.events, (sql) => sql === 'ROLLBACK'), -1);
  assert.equal(harness.wasReleased(), true);
});

test('idempotent replay validates semantic identity and performs no wallet mutation', async () => {
  const replay = {
    id: 99,
    request_key: 'adjust-replay',
    client_id: '42',
    staff_id: '7',
    mode: 'adjustment',
    bonus_earned: 20,
    bonus_spent: 0,
    balance_after: 120,
    reason: 'Correction'
  };
  const harness = createHarness({ balance: 120, existing: replay });
  const result = await harness.executor({
    customerId: '42', actorId: '7', amount: 20,
    reason: 'Correction', requestKey: 'adjust-replay'
  });

  assert.equal(result.replayed, true);
  assert.equal(result.balanceAfter, 120);
  assert.equal(harness.replayChecks.length, 1);
  assert.deepEqual(harness.replayChecks[0].expected, {
    clientId: '42',
    staffId: '7',
    mode: 'adjustment',
    adjustmentAmount: 20,
    reason: 'Correction'
  });
  assert.equal(queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets')), -1);
  assert.equal(harness.persisted.length, 0);
  assert.notEqual(queryIndex(harness.events, (sql) => sql === 'COMMIT'), -1);
  assert.equal(harness.wasReleased(), true);
});

test('unlimited bonus profile rolls back before wallet mutation or journal persistence', async () => {
  const harness = createHarness({
    balance: 100,
    target: { id: '42', telegram_id: 'tg-42', role: 'client', unlimited_bonus: true }
  });

  await assert.rejects(harness.executor({
    customerId: '42', actorId: '7', amount: 25,
    reason: 'Correction', requestKey: 'adjust-unlimited'
  }), (error) => (
    error?.code === 'unlimited_bonus'
    && error?.statusCode === 400
    && error?.message === 'У этого профиля включён постоянный безлимит бонусов.'
  ));

  assert.equal(queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets')), -1);
  assert.equal(harness.persisted.length, 0);
  assert.notEqual(queryIndex(harness.events, (sql) => sql === 'ROLLBACK'), -1);
  assert.equal(harness.wasReleased(), true);
});

test('viewer profile remains protected by the injected legacy unlimited-bonus predicate', async () => {
  const harness = createHarness({
    balance: 100,
    target: { id: '42', telegram_id: 'tg-42', role: 'viewer', unlimited_bonus: false }
  });

  await assert.rejects(harness.executor({
    customerId: '42', actorId: '7', amount: -10,
    reason: 'Correction', requestKey: 'adjust-viewer'
  }), (error) => error?.code === 'unlimited_bonus' && error?.statusCode === 400);

  assert.equal(queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets')), -1);
  assert.equal(harness.persisted.length, 0);
});

test('negative resulting balance rolls back before mutation or journal persistence', async () => {
  const harness = createHarness({ balance: 10 });
  await assert.rejects(harness.executor({
    customerId: '42', actorId: '7', amount: -11,
    reason: 'Correction', requestKey: 'adjust-negative'
  }), (error) => error?.code === 'negative_balance' && error?.statusCode === 400);

  assert.equal(queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets')), -1);
  assert.equal(harness.persisted.length, 0);
  assert.notEqual(queryIndex(harness.events, (sql) => sql === 'ROLLBACK'), -1);
  assert.equal(harness.wasReleased(), true);
});

test('journal persistence failure rolls back the wallet mutation transaction', async () => {
  const persistenceError = new Error('journal unavailable');
  const harness = createHarness({ balance: 100, persistenceError });
  await assert.rejects(harness.executor({
    customerId: '42', actorId: '7', amount: 15,
    reason: 'Correction', requestKey: 'adjust-persist-fail'
  }), persistenceError);

  assert.notEqual(queryIndex(harness.events, (sql) => sql.startsWith('UPDATE wallets')), -1);
  assert.notEqual(queryIndex(harness.events, (sql) => sql === 'ROLLBACK'), -1);
  assert.equal(queryIndex(harness.events, (sql) => sql === 'COMMIT'), -1);
  assert.equal(harness.wasReleased(), true);
});

test('invalid command fails before acquiring a database connection', async () => {
  const harness = createHarness();
  await assert.rejects(harness.executor({
    customerId: '42', actorId: '7', amount: 0,
    reason: 'Correction', requestKey: 'adjust-invalid'
  }), /amount must be a non-zero safe integer/);
  assert.equal(harness.events.length, 0);
});

test('factory requires the legacy unlimited-bonus predicate before any production wiring', () => {
  assert.throws(() => createAdminAdjustmentExecutor({
    pool: { connect() {} },
    lockRequestKey() {},
    assertMatchingTransaction() {}
  }), /hasUnlimitedBonus must be a function/);
});

test('executor contract documents the reusable financial invariants', () => {
  assert.equal(adminAdjustmentExecutorContract.atomic, true);
  assert.equal(adminAdjustmentExecutorContract.reusesAdminAdjustmentPersistence, true);
  assert.equal(adminAdjustmentExecutorContract.preservesIdempotentReplayValidation, true);
  assert.equal(adminAdjustmentExecutorContract.preservesUnlimitedBonusGuard, true);
  assert.equal(adminAdjustmentExecutorContract.productionRouteWired, false);
});
