import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminAdjustmentRouteHandlerContract,
  createAdminAdjustmentRouteHandler
} from '../admin-adjustment-route-handler.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    }
  };
}

function createRequest(overrides = {}) {
  return {
    params: { id: '42' },
    user: { id: '7' },
    body: { amount: 25, reason: 'Корректировка', requestKey: 'rk-1' },
    ...overrides
  };
}

test('legacy adjustment adapter delegates normalized command and preserves success response', async () => {
  const calls = [];
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => String(value || '').trim() || null,
    executeAdjustment: async (command) => {
      calls.push(command);
      return { ok: true, replayed: false, balanceAfter: 125 };
    }
  });
  const res = createResponse();

  await handler(
    createRequest({ body: { amount: '25.9', reason: '  Причина  ', requestKey: ' rk-1 ' } }),
    res,
    (error) => { throw error; }
  );

  assert.deepEqual(calls, [{
    customerId: '42',
    actorId: '7',
    amount: 25,
    reason: 'Причина',
    requestKey: 'rk-1'
  }]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, balance: 125 });
});

test('legacy adjustment adapter preserves idempotent replay response shape', async () => {
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => value,
    executeAdjustment: async () => ({ ok: true, replayed: true, balanceAfter: 90 })
  });
  const res = createResponse();

  await handler(createRequest(), res, (error) => { throw error; });

  assert.deepEqual(res.payload, { ok: true, balance: 90, replayed: true });
});

test('legacy validation failures happen before executor delegation', async () => {
  let calls = 0;
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => String(value || '').trim() || null,
    executeAdjustment: async () => { calls += 1; }
  });

  const missingAmount = createResponse();
  await handler(createRequest({ body: { amount: 0, reason: 'Причина', requestKey: 'rk' } }), missingAmount, () => {});
  assert.equal(missingAmount.statusCode, 400);
  assert.deepEqual(missingAmount.payload, { error: 'Укажите сумму и причину.' });

  const missingReason = createResponse();
  await handler(createRequest({ body: { amount: 10, reason: ' ', requestKey: 'rk' } }), missingReason, () => {});
  assert.equal(missingReason.statusCode, 400);
  assert.deepEqual(missingReason.payload, { error: 'Укажите сумму и причину.' });

  const missingKey = createResponse();
  await handler(createRequest({ body: { amount: 10, reason: 'Причина', requestKey: ' ' } }), missingKey, () => {});
  assert.equal(missingKey.statusCode, 400);
  assert.deepEqual(missingKey.payload, { error: 'Некорректный requestKey корректировки.' });

  assert.equal(calls, 0);
});

test('executor business errors keep legacy status/message contract', async () => {
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => value,
    executeAdjustment: async () => {
      throw Object.assign(new Error('Баланс не может стать отрицательным.'), { statusCode: 400 });
    }
  });
  const res = createResponse();

  await handler(createRequest(), res, (error) => { throw error; });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Баланс не может стать отрицательным.' });
});

test('stricter executor input failures become 400 and never leak as server errors', async () => {
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => value,
    executeAdjustment: async () => {
      throw new TypeError('amount must be a non-zero safe integer');
    }
  });
  const res = createResponse();

  await handler(createRequest(), res, (error) => { throw error; });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'Укажите корректную целую сумму.' });
});

test('unexpected executor failure is delegated to express error handling', async () => {
  const failure = new Error('database unavailable');
  let delegated = null;
  const handler = createAdminAdjustmentRouteHandler({
    normalizeRequestKey: (value) => value,
    executeAdjustment: async () => { throw failure; }
  });

  await handler(createRequest(), createResponse(), (error) => { delegated = error; });

  assert.equal(delegated, failure);
});

test('route handler contract documents financial ownership boundary', () => {
  assert.equal(adminAdjustmentRouteHandlerContract.route, '/api/admin/users/:id/adjust');
  assert.equal(adminAdjustmentRouteHandlerContract.delegatesFinancialMutation, true);
  assert.equal(adminAdjustmentRouteHandlerContract.ownsTransactions, false);
  assert.equal(adminAdjustmentRouteHandlerContract.productionRouteWired, false);
});
