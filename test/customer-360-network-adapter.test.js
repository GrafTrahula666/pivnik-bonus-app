import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCustomer360NetworkAdapter,
  customer360NetworkAdapterContract
} from '../customer-360-network-adapter.js';

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return payload; } };
}

test('Customer 360 adapter performs one same-origin scoped GET with bounded pagination', async () => {
  const calls = [];
  const adapter = createCustomer360NetworkAdapter({
    tenantId: 'tenant/a',
    locationId: 'loc 1',
    customerId: 42,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return response({ ok: true, customer: { customerId: 42 } });
    }
  });

  const customer = await adapter.loadCustomerCard({
    timeline: { limit: 20, offset: 40 },
    metadata: { limit: 10, offset: 5 }
  });

  assert.deepEqual(customer, { customerId: 42 });
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.match(url, /^\/api\/spaceverse\/tenants\/tenant%2Fa\/customers\/42\?/);
  const query = new URL(url, 'https://example.test').searchParams;
  assert.equal(query.get('locationId'), 'loc 1');
  assert.equal(query.get('limit'), '20');
  assert.equal(query.get('offset'), '40');
  assert.equal(query.get('metadataLimit'), '10');
  assert.equal(query.get('metadataOffset'), '5');
  assert.deepEqual(options, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  });
});

test('Customer 360 adapter rejects external base paths and invalid pagination', async () => {
  assert.throws(
    () => createCustomer360NetworkAdapter({ tenantId: 't', customerId: 1, basePath: 'https://evil.example/api' }),
    /same-origin/
  );
  const adapter = createCustomer360NetworkAdapter({
    tenantId: 't',
    customerId: 1,
    async fetchImpl() { throw new Error('must not fetch'); }
  });
  await assert.rejects(() => adapter.loadCustomerCard({ timeline: { limit: 101 } }), /between 1 and 100/);
  await assert.rejects(() => adapter.loadCustomerCard({ metadata: { offset: -1 } }), /non-negative/);
});

test('Customer 360 adapter preserves server denial code without exposing malformed success', async () => {
  const denied = createCustomer360NetworkAdapter({
    tenantId: 'tenant-a',
    customerId: 42,
    async fetchImpl() {
      return response({ error: 'Клиент не найден в доступном scope.', code: 'customer_not_visible' }, { ok: false, status: 404 });
    }
  });
  await assert.rejects(
    () => denied.loadCustomerCard(),
    (error) => error.code === 'customer_not_visible' && error.statusCode === 404
  );

  const malformed = createCustomer360NetworkAdapter({
    tenantId: 'tenant-a',
    customerId: 42,
    async fetchImpl() { return response({ ok: true }); }
  });
  await assert.rejects(
    () => malformed.loadCustomerCard(),
    (error) => error.code === 'customer_360_card_missing' && error.statusCode === 502
  );
});

test('Customer 360 network adapter contract remains read-only and unwired from production navigation', () => {
  assert.equal(customer360NetworkAdapterContract.readOnly, true);
  assert.equal(customer360NetworkAdapterContract.sameOriginOnly, true);
  assert.equal(customer360NetworkAdapterContract.browserScopeIsRequestOnly, true);
  assert.equal(customer360NetworkAdapterContract.rawResponseExposed, false);
  assert.equal(customer360NetworkAdapterContract.dependenciesAdded, false);
  assert.equal(customer360NetworkAdapterContract.productionNavigationWiring, false);
});
