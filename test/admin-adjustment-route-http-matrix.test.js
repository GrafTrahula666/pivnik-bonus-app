import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAdjustmentRouteHandler } from '../admin-adjustment-route-handler.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

function createHandler({ normalizeRequestKey = (value) => String(value || '').trim(), executeAdjustment } = {}) {
  return createAdminAdjustmentRouteHandler({ normalizeRequestKey, executeAdjustment });
}

test('legacy adjustment HTTP matrix: validation stops before executor delegation', async () => {
  const calls = [];
  const handler = createHandler({ executeAdjustment: async (input) => calls.push(input) });

  const cases = [
    { body: { amount: 0, reason: 'x', requestKey: 'rk-1' }, statusCode: 400, error: 'Укажите сумму и причину.' },
    { body: { amount: 10, reason: '', requestKey: 'rk-2' }, statusCode: 400, error: 'Укажите сумму и причину.' },
    { body: { amount: 10, reason: 'x', requestKey: '' }, statusCode: 400, error: 'Некорректный requestKey корректировки.' }
  ];

  for (const entry of cases) {
    const response = createResponse();
    await handler({ body: entry.body, params: { id: '42' }, user: { id: 'admin-1' } }, response, () => {
      throw new Error('unexpected next()');
    });
    assert.equal(response.statusCode, entry.statusCode);
    assert.deepEqual(response.payload, { error: entry.error });
  }

  assert.equal(calls.length, 0);
});

test('legacy adjustment HTTP matrix: success and replay preserve response shapes', async () => {
  const results = [
    { balanceAfter: 125 },
    { balanceAfter: null, replayed: true }
  ];
  const calls = [];
  const handler = createHandler({
    executeAdjustment: async (input) => {
      calls.push(input);
      return results.shift();
    }
  });

  const first = createResponse();
  await handler({ body: { amount: 25, reason: 'manual correction', requestKey: 'rk-3' }, params: { id: '42' }, user: { id: 'admin-1' } }, first, () => {
    throw new Error('unexpected next()');
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.payload, { ok: true, balance: 125 });

  const replay = createResponse();
  await handler({ body: { amount: 25, reason: 'manual correction', requestKey: 'rk-3' }, params: { id: '42' }, user: { id: 'admin-1' } }, replay, () => {
    throw new Error('unexpected next()');
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.payload, { ok: true, balance: 0, replayed: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].actorId, 'admin-1');
  assert.equal(calls[0].customerId, '42');
});

test('legacy adjustment HTTP matrix: typed client failures map to 4xx and unknown failures reach next', async () => {
  const clientError = Object.assign(new Error('customer not visible'), { statusCode: 404 });
  const handler = createHandler({ executeAdjustment: async () => { throw clientError; } });
  const response = createResponse();
  await handler({ body: { amount: 10, reason: 'x', requestKey: 'rk-4' }, params: { id: '42' }, user: { id: 'admin-1' } }, response, () => {
    throw new Error('unexpected next()');
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.payload, { error: 'customer not visible' });

  const serverError = new Error('db unavailable');
  let forwarded = null;
  const forwardingHandler = createHandler({ executeAdjustment: async () => { throw serverError; } });
  const secondResponse = createResponse();
  await forwardingHandler({ body: { amount: 10, reason: 'x', requestKey: 'rk-5' }, params: { id: '42' }, user: { id: 'admin-1' } }, secondResponse, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, serverError);
  assert.equal(secondResponse.payload, null);
});
