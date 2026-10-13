import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCustomerMetadataNetworkAdapter,
  customerMetadataNetworkAdapterContract
} from '../customer-metadata-network-adapter.js';

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test('Customer metadata adapter posts one same-origin scoped append-only mutation', async () => {
  const calls = [];
  const adapter = createCustomerMetadataNetworkAdapter({
    tenantId: 'tenant/a',
    locationId: 'loc 1',
    customerId: 42,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return response({ ok: true, eventId: '9007199254740993', eventType: 'note_added', value: 'VIP guest' });
    }
  });

  const result = await adapter.addNote({
    note: '  VIP guest  ',
    reason: '  manual CRM note  ',
    requestKey: '  req-1  '
  });

  assert.deepEqual(result, {
    eventId: '9007199254740993',
    eventType: 'note_added',
    value: 'VIP guest'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/spaceverse/tenants/tenant%2Fa/locations/loc%201/customers/42/notes');
  assert.deepEqual(calls[0].options, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ note: 'VIP guest', reason: 'manual CRM note', requestKey: 'req-1' })
  });
});

test('Customer metadata adapter exposes only fixed mutation routes and matching value fields', async () => {
  const calls = [];
  const adapter = createCustomerMetadataNetworkAdapter({
    tenantId: 'tenant',
    locationId: 'location',
    customerId: 'customer',
    async fetchImpl(url, options) {
      calls.push({ url, body: JSON.parse(options.body) });
      return response({ ok: true });
    }
  });

  await adapter.addTag({ tag: 'vip', reason: 'segmenting', requestKey: '1' });
  await adapter.removeTag({ tag: 'vip', reason: 'outdated', requestKey: '2' });
  await adapter.addSegment({ segment: 'regular', reason: 'manual', requestKey: '3' });
  await adapter.removeSegment({ segment: 'regular', reason: 'manual', requestKey: '4' });

  assert.deepEqual(calls, [
    {
      url: '/api/spaceverse/tenants/tenant/locations/location/customers/customer/tags',
      body: { tag: 'vip', reason: 'segmenting', requestKey: '1' }
    },
    {
      url: '/api/spaceverse/tenants/tenant/locations/location/customers/customer/tags/remove',
      body: { tag: 'vip', reason: 'outdated', requestKey: '2' }
    },
    {
      url: '/api/spaceverse/tenants/tenant/locations/location/customers/customer/segments',
      body: { segment: 'regular', reason: 'manual', requestKey: '3' }
    },
    {
      url: '/api/spaceverse/tenants/tenant/locations/location/customers/customer/segments/remove',
      body: { segment: 'regular', reason: 'manual', requestKey: '4' }
    }
  ]);
});

test('Customer metadata adapter rejects unsafe paths and invalid commands before fetch', async () => {
  assert.throws(
    () => createCustomerMetadataNetworkAdapter({
      tenantId: 't', locationId: 'l', customerId: 'c', basePath: 'https://evil.example/api'
    }),
    /same-origin/
  );

  let fetched = false;
  const adapter = createCustomerMetadataNetworkAdapter({
    tenantId: 't',
    locationId: 'l',
    customerId: 'c',
    async fetchImpl() {
      fetched = true;
      throw new Error('must not fetch');
    }
  });

  await assert.rejects(
    () => adapter.addTag({ tag: '', reason: 'reason', requestKey: 'key' }),
    /tag is required/
  );
  await assert.rejects(
    () => adapter.addNote({ note: 'x', reason: '', requestKey: 'key' }),
    /reason is required/
  );
  await assert.rejects(
    () => adapter.addSegment({ segment: 'x', reason: 'reason', requestKey: '' }),
    /requestKey is required/
  );
  assert.equal(fetched, false);
});

test('Customer metadata adapter preserves server denial and fails closed on malformed success', async () => {
  const denied = createCustomerMetadataNetworkAdapter({
    tenantId: 't', locationId: 'l', customerId: 'c',
    async fetchImpl() {
      return response({ error: 'Customer is not visible', code: 'customer_scope_denied' }, { ok: false, status: 404 });
    }
  });
  await assert.rejects(
    () => denied.addTag({ tag: 'vip', reason: 'manual', requestKey: 'req-denied' }),
    (error) => error.code === 'customer_scope_denied' && error.statusCode === 404
  );

  const malformed = createCustomerMetadataNetworkAdapter({
    tenantId: 't', locationId: 'l', customerId: 'c',
    async fetchImpl() { return response({ eventId: '1' }); }
  });
  await assert.rejects(
    () => malformed.addTag({ tag: 'vip', reason: 'manual', requestKey: 'req-malformed' }),
    (error) => error.code === 'customer_metadata_response_invalid' && error.statusCode === 502
  );
});

test('Customer metadata network adapter contract keeps browser authority narrow', () => {
  assert.equal(customerMetadataNetworkAdapterContract.sameOriginOnly, true);
  assert.equal(customerMetadataNetworkAdapterContract.browserScopeIsRequestOnly, true);
  assert.equal(customerMetadataNetworkAdapterContract.serverAuthorizationAuthoritative, true);
  assert.equal(customerMetadataNetworkAdapterContract.reasonRequired, true);
  assert.equal(customerMetadataNetworkAdapterContract.idempotencyKeyRequired, true);
  assert.equal(customerMetadataNetworkAdapterContract.appendOnlyActionsOnly, true);
  assert.equal(customerMetadataNetworkAdapterContract.destructiveActionsIncluded, false);
  assert.equal(customerMetadataNetworkAdapterContract.productionNavigationWiring, false);
  assert.equal(customerMetadataNetworkAdapterContract.dependenciesAdded, false);
});
