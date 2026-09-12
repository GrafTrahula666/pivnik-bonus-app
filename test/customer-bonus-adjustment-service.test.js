import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import { createCustomerBonusAdjustmentService } from '../customer-bonus-adjustment-service.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-1' });

function harness() {
  const calls = [];
  return {
    calls,
    service: createCustomerBonusAdjustmentService({
      executeAdjustment: async (command) => {
        calls.push(command);
        return command;
      }
    })
  };
}

test('owner may delegate a confirmed scoped adjustment with audit metadata', async () => {
  const { service, calls } = harness();
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

  assert.equal(calls.length, 1);
  assert.equal(calls[0].amount, 300);
  assert.equal(calls[0].audit.action, 'bonus.adjust');
  assert.equal(calls[0].audit.actorId, 'owner-7');
  assert.equal(calls[0].audit.tenantId, 'tenant-a');
  assert.equal(calls[0].audit.locationId, 'location-1');
  assert.equal(calls[0].audit.requestKey, 'crm-adjust-1');
});

test('staff is denied before delegation', async () => {
  const { service, calls } = harness();
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
  assert.equal(calls.length, 0);
});

test('cross-tenant request is denied before delegation', async () => {
  const { service, calls } = harness();
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
  assert.equal(calls.length, 0);
});

test('reason, confirmation and idempotency key are mandatory', async () => {
  const missingReason = harness();
  await assert.rejects(missingReason.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, requestKey: 'crm-adjust-4', confirmed: true
  }), (error) => error?.code === 'reason_required');
  assert.equal(missingReason.calls.length, 0);

  const missingConfirmation = harness();
  await assert.rejects(missingConfirmation.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, reason: 'Manual correction', requestKey: 'crm-adjust-5'
  }), (error) => error?.code === 'confirmation_required');
  assert.equal(missingConfirmation.calls.length, 0);

  const missingKey = harness();
  await assert.rejects(missingKey.service.adjust({
    context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
    customerId: '42', amount: 50, reason: 'Manual correction', confirmed: true
  }), /requestKey is required/);
  assert.equal(missingKey.calls.length, 0);
});

test('invalid amounts are rejected before delegation', async () => {
  for (const amount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { service, calls } = harness();
    await assert.rejects(service.adjust({
      context: owner, tenantId: 'tenant-a', locationId: 'location-1', actorId: 'owner-7',
      customerId: '42', amount, reason: 'Manual correction', requestKey: `crm-${amount}`, confirmed: true
    }), /amount must be a non-zero safe integer/);
    assert.equal(calls.length, 0);
  }
});
