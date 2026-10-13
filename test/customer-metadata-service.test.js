import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import { createCustomerMetadataService } from '../customer-metadata-service.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-1' });

function harness() {
  const calls = [];
  return {
    calls,
    service: createCustomerMetadataService({
      repository: {
        async appendEvent(command) {
          calls.push(command);
          return command;
        }
      }
    })
  };
}

test('owner may add an audited note inside own tenant/location', async () => {
  const { service, calls } = harness();
  await service.addNote({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-2',
    actorId: 'owner-7',
    customerId: '42',
    note: 'Предпочитает тихий стол у окна',
    reason: 'Комментарий после визита',
    requestKey: 'note-1'
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    tenantId: 'tenant-a',
    locationId: 'location-2',
    customerId: '42',
    actorId: 'owner-7',
    eventType: 'note_added',
    value: 'Предпочитает тихий стол у окна',
    reason: 'Комментарий после визита',
    requestKey: 'note-1'
  });
});

test('staff may mutate metadata only inside exact assigned location', async () => {
  const allowed = harness();
  await allowed.service.addTag({
    context: staff,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'staff-9',
    customerId: '42',
    tag: 'vip',
    reason: 'Подтверждено владельцем',
    requestKey: 'tag-1'
  });
  assert.equal(allowed.calls.length, 1);
  assert.equal(allowed.calls[0].eventType, 'tag_added');

  const denied = harness();
  await assert.rejects(denied.service.addTag({
    context: staff,
    tenantId: 'tenant-a',
    locationId: 'location-2',
    actorId: 'staff-9',
    customerId: '42',
    tag: 'vip',
    reason: 'Попытка изменить чужую точку',
    requestKey: 'tag-2'
  }), (error) => error?.code === 'scope_denied');
  assert.equal(denied.calls.length, 0);
});

test('cross-tenant metadata mutation fails before repository call', async () => {
  const { service, calls } = harness();
  await assert.rejects(service.addSegment({
    context: owner,
    tenantId: 'tenant-b',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    segment: 'at-risk',
    reason: 'Manual segmentation',
    requestKey: 'segment-1'
  }), (error) => error?.code === 'scope_denied');
  assert.equal(calls.length, 0);
});

test('tag and segment removals are append-only events rather than destructive deletes', async () => {
  const { service, calls } = harness();

  await service.removeTag({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    tag: 'vip',
    reason: 'Tag no longer applies',
    requestKey: 'tag-remove-1'
  });
  await service.removeSegment({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    segment: 'at-risk',
    reason: 'Customer returned',
    requestKey: 'segment-remove-1'
  });

  assert.equal(calls[0].eventType, 'tag_removed');
  assert.equal(calls[1].eventType, 'segment_removed');
});

test('actor, reason, request key and bounded value are mandatory before persistence', async () => {
  for (const [field, patch, pattern] of [
    ['actor', { actorId: '' }, /actorId is required/],
    ['reason', { reason: '' }, /reason is required/],
    ['request key', { requestKey: '' }, /requestKey is required/],
    ['value', { tag: '' }, /tag is required/]
  ]) {
    const { service, calls } = harness();
    await assert.rejects(service.addTag({
      context: owner,
      tenantId: 'tenant-a',
      locationId: 'location-1',
      actorId: 'owner-7',
      customerId: '42',
      tag: 'vip',
      reason: 'Manual metadata update',
      requestKey: `validation-${field}`,
      ...patch
    }), pattern);
    assert.equal(calls.length, 0);
  }

  const oversized = harness();
  await assert.rejects(oversized.service.addTag({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    tag: 'x'.repeat(81),
    reason: 'Manual metadata update',
    requestKey: 'oversized-tag'
  }), /tag must not exceed 80 characters/);
  assert.equal(oversized.calls.length, 0);
});
