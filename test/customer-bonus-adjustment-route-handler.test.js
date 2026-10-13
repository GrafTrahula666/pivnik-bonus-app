import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCustomerBonusAdjustmentRouteHandler,
  customerBonusAdjustmentRouteHandlerContract
} from '../customer-bonus-adjustment-route-handler.js';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function baseRequest() {
  return {
    user: { id: 'owner-1' },
    params: {
      tenantId: 'tenant-1',
      locationId: 'location-1',
      id: 'customer-1'
    },
    body: {
      amount: 125,
      reason: 'Service recovery',
      requestKey: 'req-1',
      confirmed: true
    },
    spaceverseAuthorization: {
      context: { platformRole: null, memberships: [] },
      requestedScope: {
        tenantId: 'tenant-1',
        locationId: 'location-1'
      }
    }
  };
}

test('Customer 360 bonus route delegates scoped command without owning financial logic', async () => {
  let command;
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async (value) => {
      command = value;
      return { balanceAfter: 725 };
    }
  });
  const req = baseRequest();
  const res = createResponse();

  await handler(req, res, assert.fail);

  assert.deepEqual(command, {
    context: req.spaceverseAuthorization.context,
    tenantId: 'tenant-1',
    locationId: 'location-1',
    actorId: 'owner-1',
    customerId: 'customer-1',
    amount: 125,
    reason: 'Service recovery',
    requestKey: 'req-1',
    confirmed: true
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, balance: 725 });
});

test('Customer 360 bonus route preserves replay signal', async () => {
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async () => ({ balanceAfter: 725, replayed: true })
  });
  const res = createResponse();

  await handler(baseRequest(), res, assert.fail);

  assert.deepEqual(res.payload, { ok: true, balance: 725, replayed: true });
});

test('Customer 360 bonus route requires authorization context before delegation', async () => {
  let called = false;
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async () => {
      called = true;
    }
  });
  const req = baseRequest();
  delete req.spaceverseAuthorization;
  const res = createResponse();

  await handler(req, res, assert.fail);

  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'authorization_context_required');
});

test('Customer 360 bonus route does not reveal cross-scope customer existence', async () => {
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async () => {
      throw Object.assign(new Error('Customer is not visible in the authorized tenant/location scope'), {
        code: 'customer_scope_denied'
      });
    }
  });
  const res = createResponse();

  await handler(baseRequest(), res, assert.fail);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.code, 'customer_scope_denied');
});

test('Customer 360 bonus route maps confirmation and idempotency conflicts', async () => {
  for (const [code, expectedStatus] of [
    ['confirmation_required', 400],
    ['idempotency_conflict', 409]
  ]) {
    const handler = createCustomerBonusAdjustmentRouteHandler({
      adjust: async () => {
        throw Object.assign(new Error(code), { code });
      }
    });
    const res = createResponse();

    await handler(baseRequest(), res, assert.fail);

    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.payload.code, code);
  }
});

test('Customer 360 bonus route maps malformed command values to 400', async () => {
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async () => {
      throw new TypeError('amount must be a non-zero safe integer');
    }
  });
  const res = createResponse();

  await handler(baseRequest(), res, assert.fail);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'amount must be a non-zero safe integer' });
});

test('Customer 360 bonus route forwards unexpected failures', async () => {
  const failure = new Error('database unavailable');
  const handler = createCustomerBonusAdjustmentRouteHandler({
    adjust: async () => {
      throw failure;
    }
  });
  const res = createResponse();
  let forwarded;

  await handler(baseRequest(), res, (error) => {
    forwarded = error;
  });

  assert.equal(forwarded, failure);
  assert.equal(res.payload, null);
});

test('Customer 360 bonus route contract remains unwired and scoped', () => {
  assert.equal(customerBonusAdjustmentRouteHandlerContract.requiresScopedAuthorizationMiddleware, true);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.requiresAuthorizationContext, true);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.delegatesCustomerVisibilityProof, true);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.delegatesFinancialMutation, true);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.exposesCrossTenantExistenceOnScopeDenial, false);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.ownsTransactions, false);
  assert.equal(customerBonusAdjustmentRouteHandlerContract.productionRouteWired, false);
});
