import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import { createCustomerBonusAdjustmentService } from '../customer-bonus-adjustment-service.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-1' });

function harness({ visible = true, assertCustomerVisible } = {}) {
  const calls = [];
  const visibilityCalls = [];
  return {
    calls,
    visibilityCalls,
    service: createCustomerBonusAdjustmentService({
      assertCustomerVisible: assertCustomerVisible || (async (command) => {
        visibilityCalls.push(command);
        return visible;
      }),
      executeAdjustment: async (command) => {
        calls.push(command);
        return command;
      }
    })
  };
}

test('service requires an explicit customer-scope proof dependency', () => {
  assert.throws(() => createCustomerBonusAdjustmentService({
    executeAdjustment: async () => null
  }), /assertCustomerVisible must be a function/);
});

test('owner may delegate a confirmed scoped adjustment with audit metadata', async () => {
  const { service, calls, visibilityCalls } = harness();
  await service.adjust({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    amount: 300,
    reason: 'Service correction',
    requestKey: 'crm-adjust-1',
    confirmed: true
  });

  assert.equal(visibilityCalls.length, 1);
  assert.equal(visibilityCalls[0].tenantId, 'tenant-a');
  assert.equal(visibilityCalls[0].locationId, 'location-1');
  assert.equal(visibilityCalls[0].customerId, '42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, 300);
  assert.equal(calls[0].audit.action, 'bonus.adjust');
  assert.equal(calls[0].audit.actorId, 'owner-7');
  assert.equal(calls[0].audit.tenantId, 'tenant-a');
  assert.equal(calls[0].audit.locationId, 'location-1');
  assert.equal(calls[0].audit.customerId, '42');
  assert.equal(calls[0].audit.requestKey, 'crm-adjust-1');
});

test('customer outside the authorized scope is denied before financial delegation', async () => {
  const { service, calls, visibilityCalls } = harness({ visible: false });
  await assert.rejects(service.adjust({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '777',
    amount: 50,
    reason: 'Manual correction',
    requestKey: 'crm-adjust-outside-scope',
    confirmed: true
  }), (error) => error?.code === 'customer_scope_denied');

  assert.equal(visibilityCalls.length, 1);
  assert.equal(calls.length, 0);
});

test('staff is denied before customer lookup and financial delegation', async () => {
  const { service, calls, visibilityCalls } = harness();
  await assert.rejects(service.adjust({
    context: staff,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'staff-9',
    customerId: '42',
    amount: 50,
    reason: 'Manual correction',
    requestKey: 'crm-adjust-2',
    confirmed: true
  }), (error) => error?.code === 'manager_required');
  assert.equal(visibilityCalls.length, 0);
  assert.equal(calls.length, 0);
});

test('cross-tenant request is denied before customer lookup and delegation', async () => {
  const { service, calls, visibilityCalls } = harness();
  await assert.rejects(service.adjust({
    context: owner,
    tenantId: 'tenant-b',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    amount: 50,
    reason: 'Manual correction',
    requestKey: 'crm-adjust-3',
    confirmed: true
  }), (error) => error?.code === 'scope_denied');
  assert.equal(visibilityCalls.length, 0);
  assert.equal(calls.length, 0);
});

test('reason, confirmation and idempotency key are mandatory before customer lookup', async () => {
  const missingReason = harness();
  await assert.rejects(missingReason.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, requestKey: 'crm-adjust-4', confirmed: true
  }), (error) => error?.code === 'reason_required');
  assert.equal(missingReason.visibilityCalls.length, 0);
  assert.equal(missingReason.calls.length, 0);

  const missingConfirmation = harness();
  await assert.rejects(missingConfirmation.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, reason: 'Manual correction', requestKey: 'crm-adjust-5'
  }), (error) => error?.code === 'confirmation_required');
  assert.equal(missingConfirmation.visibilityCalls.length, 0);
  assert.equal(missingConfirmation.calls.length, 0);

  const missingKey = harness();
  await assert.rejects(missingKey.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, reason: 'Manual correction', confirmed: true
  }), /requestKey is required/);
  assert.equal(missingKey.visibilityCalls.length, 0);
  assert.equal(missingKey.calls.length, 0);
});

test('invalid amounts are rejected before customer lookup and delegation', async () => {
  for (const amount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { service, calls, visibilityCalls } = harness();
    await assert.rejects(service.adjust({
      context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
      customerId: '42', amount, reason: 'Manual correction', requestKey: `crm-${amount}`, confirmed: true
    }), /amount must be a non-zero safe integer/);
    assert.equal(visibilityCalls.length, 0);
    assert.equal(calls.length, 0);
  }
});

test('customer visibility lookup errors fail closed and never reach the financial executor', async () => {
  const { service, calls } = harness({
    assertCustomerVisible: async () => {
      throw Object.assign(new Error('read boundary unavailable'), { code: 'scope_read_failed' });
    }
  });

  await assert.rejects(service.adjust({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    amount: 50,
    reason: 'Manual correction',
    requestKey: 'crm-adjust-read-failure',
    confirmed: true
  }), (error) => error?.code === 'scope_read_failed');

  assert.equal(calls.length, 0);
});
