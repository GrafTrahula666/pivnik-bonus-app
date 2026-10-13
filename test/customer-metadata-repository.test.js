import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCustomerMetadataRepository,
  customerMetadataRepositoryContract
} from '../customer-metadata-repository.js';

function row(overrides = {}) {
  return {
    id: 1,
    tenant_id: 'tenant-a',
    location_id: 'loc-1',
    customer_id: '10',
    actor_id: '20',
    event_type: 'tag_added',
    value: 'vip',
    reason: 'Manual CRM classification',
    request_key: 'req-1',
    created_at: '2026-09-12T09:00:00.000Z',
    ...overrides
  };
}

test('metadata contract is append-only and fail-closed by tenant scope', () => {
  assert.equal(customerMetadataRepositoryContract.migration, '010_spaceverse_customer_metadata.sql');
  assert.equal(customerMetadataRepositoryContract.appendOnly, true);
  assert.equal(customerMetadataRepositoryContract.destructiveDeletes, false);
  assert.equal(customerMetadataRepositoryContract.requiresExplicitTenant, true);
  assert.equal(customerMetadataRepositoryContract.globalFallback, false);
  assert.equal(customerMetadataRepositoryContract.idempotentWrites, true);
});

test('appendEvent writes all audit/scope fields with a caller supplied idempotency key', async () => {
  const calls = [];
  const repo = createCustomerMetadataRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [row()] };
    }
  });

  const result = await repo.appendEvent({
    tenantId: ' tenant-a ',
    locationId: ' loc-1 ',
    customerId: 10,
    actorId: 20,
    eventType: 'tag_added',
    value: ' vip ',
    reason: ' Manual CRM classification ',
    requestKey: ' req-1 '
  });

  assert.equal(result.value, 'vip');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT \(request_key\) DO NOTHING/);
  assert.deepEqual(calls[0].params, [
    'tenant-a', 'loc-1', '10', '20', 'tag_added', 'vip', 'Manual CRM classification', 'req-1'
  ]);
});

test('appendEvent returns a semantic replay for the same request key', async () => {
  const calls = [];
  const existing = row();
  const repo = createCustomerMetadataRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [] };
      return { rows: [existing] };
    }
  });

  const result = await repo.appendEvent({
    tenantId: 'tenant-a',
    locationId: 'loc-1',
    customerId: '10',
    actorId: '20',
    eventType: 'tag_added',
    value: 'vip',
    reason: 'Manual CRM classification',
    requestKey: 'req-1'
  });

  assert.equal(result.id, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /WHERE request_key = \$1/);
});

test('appendEvent rejects reusing an idempotency key for a different semantic command', async () => {
  const repo = createCustomerMetadataRepository({
    query: async (sql) => {
      if (/INSERT INTO/.test(sql)) return { rows: [] };
      return { rows: [row({ value: 'different-tag' })] };
    }
  });

  await assert.rejects(
    repo.appendEvent({
      tenantId: 'tenant-a',
      locationId: 'loc-1',
      customerId: '10',
      actorId: '20',
      eventType: 'tag_added',
      value: 'vip',
      reason: 'Manual CRM classification',
      requestKey: 'req-1'
    }),
    (error) => error?.code === 'idempotency_conflict'
  );
});

test('listEvents always requires tenant/customer and scopes location when supplied', async () => {
  const calls = [];
  const repo = createCustomerMetadataRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  await repo.listEvents({
    tenantId: 'tenant-a',
    locationId: 'loc-1',
    customerId: '10',
    limit: 25,
    offset: 50
  });

  assert.match(calls[0].sql, /tenant_id = \$1/);
  assert.match(calls[0].sql, /customer_id = \$2/);
  assert.match(calls[0].sql, /location_id = \$3/);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/);
  assert.deepEqual(calls[0].params, ['tenant-a', '10', 'loc-1', 25, 50]);

  await assert.rejects(
    repo.listEvents({ customerId: '10' }),
    /tenantId is required/
  );
});

test('tenant-wide owner metadata reads do not invent a location predicate', async () => {
  const calls = [];
  const repo = createCustomerMetadataRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  await repo.listEvents({ tenantId: 'tenant-a', customerId: '10' });

  assert.match(calls[0].sql, /tenant_id = \$1/);
  assert.match(calls[0].sql, /customer_id = \$2/);
  assert.doesNotMatch(calls[0].sql, /location_id =/);
  assert.deepEqual(calls[0].params, ['tenant-a', '10', 50, 0]);
});

test('listCurrentLabels derives state from latest append-only add/remove events', async () => {
  const calls = [];
  const repo = createCustomerMetadataRepository({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ label_kind: 'tag', value: 'vip' }] };
    }
  });

  const result = await repo.listCurrentLabels({
    tenantId: 'tenant-a',
    locationId: 'loc-1',
    customerId: '10'
  });

  assert.equal(result[0].value, 'vip');
  assert.match(calls[0].sql, /ROW_NUMBER\(\) OVER/);
  assert.match(calls[0].sql, /event_type IN \('tag_added','tag_removed','segment_added','segment_removed'\)/);
  assert.match(calls[0].sql, /event_type IN \('tag_added','segment_added'\)/);
  assert.deepEqual(calls[0].params, ['tenant-a', '10', 'loc-1']);
});

test('invalid event types and pagination fail before SQL', async () => {
  let calls = 0;
  const repo = createCustomerMetadataRepository({
    query: async () => {
      calls += 1;
      return { rows: [] };
    }
  });

  await assert.rejects(
    repo.appendEvent({
      tenantId: 'tenant-a',
      customerId: '10',
      actorId: '20',
      eventType: 'delete_everything',
      value: 'x',
      reason: 'x',
      requestKey: 'req-x'
    }),
    /Unsupported eventType/
  );
  await assert.rejects(
    repo.listEvents({ tenantId: 'tenant-a', customerId: '10', limit: 101 }),
    /limit must be an integer between 1 and 100/
  );
  assert.equal(calls, 0);
});
