import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomerMetadataRouteHandler } from '../customer-metadata-route-handler.js';

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; }
  };
}

test('adapts scoped request into metadata service input', async () => {
  let received;
  const handler = createCustomerMetadataRouteHandler({
    mutation: 'addTag',
    async execute(input) {
      received = input;
      return { id: 9, event_type: 'tag_added', value: 'vip' };
    }
  });
  const req = {
    user: { id: 'actor-1' },
    params: { tenantId: 'wrong', locationId: 'wrong', id: 'customer-1' },
    body: { tag: 'vip', reason: 'manual crm label', requestKey: 'meta-1' },
    spaceverseAuthorization: {
      context: { memberships: [] },
      requestedScope: { tenantId: 'tenant-1', locationId: 'location-1' }
    }
  };
  const res = responseRecorder();

  await handler(req, res, (error) => { throw error; });

  assert.deepEqual(received, {
    context: req.spaceverseAuthorization.context,
    tenantId: 'tenant-1',
    locationId: 'location-1',
    actorId: 'actor-1',
    customerId: 'customer-1',
    tag: 'vip',
    reason: 'manual crm label',
    requestKey: 'meta-1'
  });
  assert.deepEqual(res.body, { ok: true, eventId: 9, eventType: 'tag_added', value: 'vip' });
});

test('maps invisible customer to 404 without exposing existence', async () => {
  const handler = createCustomerMetadataRouteHandler({
    mutation: 'addNote',
    async execute() {
      throw Object.assign(new Error('not visible'), { code: 'customer_scope_denied' });
    }
  });
  const res = responseRecorder();
  await handler({
    user: { id: 'actor-1' },
    params: { id: 'customer-x' },
    body: { note: 'x', reason: 'y', requestKey: 'z' },
    spaceverseAuthorization: {
      context: {},
      requestedScope: { tenantId: 'tenant-1', locationId: 'location-1' }
    }
  }, res, (error) => { throw error; });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'customer_scope_denied');
});

test('requires authorization context and validates mutation name', async () => {
  assert.throws(
    () => createCustomerMetadataRouteHandler({ mutation: 'unknown', execute: async () => ({}) }),
    /Unknown customer metadata mutation/
  );

  const handler = createCustomerMetadataRouteHandler({ mutation: 'addSegment', execute: async () => ({}) });
  const res = responseRecorder();
  await handler({ user: { id: 'actor-1' }, params: {}, body: {} }, res, (error) => { throw error; });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'authorization_context_required');
});
