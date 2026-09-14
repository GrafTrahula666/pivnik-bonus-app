import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerAchievementGrantRouteHandler } from '../customer-achievement-grant-route-handler.js';

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function request(overrides = {}) {
  return {
    spaceverseAuthorization: {
      context: { membershipRole: 'owner', tenantId: 'tenant-a' },
      requestedScope: { tenantId: 'tenant-a', locationId: 'location-1' }
    },
    user: { id: 'owner-7' },
    params: {
      tenantId: 'tenant-a',
      locationId: 'location-1',
      id: '42',
      achievementCode: 'raise-shields'
    },
    body: {
      reason: 'Manual support correction',
      requestKey: 'achievement-grant-1',
      confirmed: true
    },
    ...overrides
  };
}

test('delegates a confirmed scoped grant using authorization scope and actor', async () => {
  const calls = [];
  const handler = createCustomerAchievementGrantRouteHandler({
    grant: async (command) => {
      calls.push(command);
      return { replayed: false };
    }
  });
  const res = responseHarness();

  await handler(request(), res, (error) => { throw error; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(calls, [{
    context: { membershipRole: 'owner', tenantId: 'tenant-a' },
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    achievementCode: 'raise-shields',
    reason: 'Manual support correction',
    requestKey: 'achievement-grant-1',
    confirmed: true
  }]);
});

test('reports replay without exposing reward executor internals', async () => {
  const handler = createCustomerAchievementGrantRouteHandler({
    grant: async () => ({ replayed: true, internalRewardData: 'hidden' })
  });
  const res = responseHarness();

  await handler(request(), res, (error) => { throw error; });

  assert.deepEqual(res.body, { ok: true, replayed: true });
});

test('fails closed without scoped authorization context', async () => {
  let called = false;
  const handler = createCustomerAchievementGrantRouteHandler({
    grant: async () => { called = true; }
  });
  const res = responseHarness();

  await handler(request({ spaceverseAuthorization: undefined }), res, (error) => { throw error; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'authorization_context_required');
});

test('maps customer scope denial to 404 and policy denial to 403', async () => {
  for (const [code, expectedStatus] of [
    ['customer_scope_denied', 404],
    ['manager_required', 403],
    ['scope_denied', 403]
  ]) {
    const handler = createCustomerAchievementGrantRouteHandler({
      grant: async () => { throw Object.assign(new Error(code), { code }); }
    });
    const res = responseHarness();

    await handler(request(), res, (error) => { throw error; });

    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.body.code, code);
  }
});

test('maps validation/idempotency failures and forwards unexpected errors', async () => {
  const validation = createCustomerAchievementGrantRouteHandler({
    grant: async () => { throw Object.assign(new Error('Explicit confirmation is required'), { code: 'confirmation_required' }); }
  });
  const validationRes = responseHarness();
  await validation(request(), validationRes, (error) => { throw error; });
  assert.equal(validationRes.statusCode, 400);

  const conflict = createCustomerAchievementGrantRouteHandler({
    grant: async () => { throw Object.assign(new Error('conflict'), { code: 'idempotency_conflict' }); }
  });
  const conflictRes = responseHarness();
  await conflict(request(), conflictRes, (error) => { throw error; });
  assert.equal(conflictRes.statusCode, 409);

  const unexpected = new Error('database unavailable');
  const forwarding = createCustomerAchievementGrantRouteHandler({
    grant: async () => { throw unexpected; }
  });
  const forwardingRes = responseHarness();
  let forwarded;
  await forwarding(request(), forwardingRes, (error) => { forwarded = error; });
  assert.equal(forwarded, unexpected);
});
