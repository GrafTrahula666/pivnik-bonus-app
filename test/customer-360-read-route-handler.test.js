import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCustomer360ReadRouteHandler,
  customer360ReadRouteHandlerContract
} from '../customer-360-read-route-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const authorization = {
  context: { platformRole: null, membershipRole: 'owner', tenantId: 'tenant-a', locationId: null },
  requestedScope: { tenantId: 'tenant-a', locationId: null }
};

test('Customer 360 route uses middleware authorization scope and never trusts a body tenant', async () => {
  let received;
  const handler = createCustomer360ReadRouteHandler({
    async getCustomerCard(input) { received = input; return { customerId: 42 }; }
  });
  const req = {
    params: { tenantId: 'tenant-a', customerId: '42' },
    query: { locationId: 'location-1', limit: '20', offset: '0' },
    body: { tenantId: 'tenant-b' },
    spaceverseAuthorization: authorization
  };
  const res = responseRecorder();
  await handler(req, res, (error) => { throw error; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, customer: { customerId: 42 } });
  assert.equal(received.tenantId, 'tenant-a');
  assert.equal(received.locationId, 'location-1');
  assert.equal(received.customerId, '42');
  assert.equal(received.authorizationContext, authorization.context);
});

test('Customer 360 route returns 404 without leaking global identity when customer is invisible', async () => {
  const handler = createCustomer360ReadRouteHandler({ getCustomerCard: async () => null });
  const res = responseRecorder();
  await handler({ params: { tenantId: 'tenant-a', customerId: '42' }, query: {}, spaceverseAuthorization: authorization }, res, (error) => { throw error; });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'customer_not_visible');
});

test('Customer 360 route fails closed without scoped authorization context', async () => {
  const handler = createCustomer360ReadRouteHandler({ getCustomerCard: async () => ({}) });
  const res = responseRecorder();
  await handler({ params: { tenantId: 'tenant-a', customerId: '42' }, query: {} }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'authorization_context_required');
});

test('Customer 360 route contract is read-only and manager scoped', () => {
  assert.equal(customer360ReadRouteHandlerContract.requiresScopedAuthorizationMiddleware, true);
  assert.equal(customer360ReadRouteHandlerContract.tenantWideManagerRead, true);
  assert.equal(customer360ReadRouteHandlerContract.invisibleCustomerReturns404, true);
  assert.equal(customer360ReadRouteHandlerContract.readOnly, true);
});
