import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import { createCustomerAchievementActionService } from '../customer-achievement-action-service.js';

const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-1' });

function harness({ withRevoke = false } = {}) {
  const grants = [];
  const revokes = [];
  return {
    grants,
    revokes,
    service: createCustomerAchievementActionService({
      grantAchievement: async (command) => {
        grants.push(command);
        return command;
      },
      revokeAchievement: withRevoke ? async (command) => {
        revokes.push(command);
        return command;
      } : null
    })
  };
}

function base(overrides = {}) {
  return {
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    actorId: 'owner-7',
    customerId: '42',
    achievementCode: 'raise-shields',
    reason: 'Manual support correction',
    requestKey: 'crm-achievement-1',
    confirmed: true,
    ...overrides
  };
}

test('owner may delegate confirmed achievement grant with audit metadata', async () => {
  const { service, grants } = harness();
  await service.grant(base());

  assert.equal(grants.length, 1);
  assert.equal(grants[0].action, 'achievement.grant');
  assert.equal(grants[0].achievementCode, 'raise-shields');
  assert.equal(grants[0].audit.actorId, 'owner-7');
  assert.equal(grants[0].audit.tenantId, 'tenant-a');
  assert.equal(grants[0].audit.locationId, 'location-1');
  assert.equal(grants[0].audit.requestKey, 'crm-achievement-1');
});

test('staff and cross-tenant achievement mutations are denied before delegation', async () => {
  const staffAttempt = harness();
  await assert.rejects(staffAttempt.service.grant(base({ context: staff, actorId: 'staff-9' })),
    (error) => error?.code === 'manager_required');
  assert.equal(staffAttempt.grants.length, 0);

  const crossTenant = harness();
  await assert.rejects(crossTenant.service.grant(base({ tenantId: 'tenant-b' })),
    (error) => error?.code === 'scope_denied');
  assert.equal(crossTenant.grants.length, 0);
});

test('grant requires reason, confirmation and idempotency key', async () => {
  const missingReason = harness();
  await assert.rejects(missingReason.service.grant(base({ reason: undefined })),
    (error) => error?.code === 'reason_required');
  assert.equal(missingReason.grants.length, 0);

  const missingConfirmation = harness();
  await assert.rejects(missingConfirmation.service.grant(base({ confirmed: false })),
    (error) => error?.code === 'confirmation_required');
  assert.equal(missingConfirmation.grants.length, 0);

  const missingKey = harness();
  await assert.rejects(missingKey.service.grant(base({ requestKey: undefined })), /requestKey is required/);
  assert.equal(missingKey.grants.length, 0);
});

test('revocation fails closed unless an audited revoke executor is explicitly supplied', async () => {
  const unsupported = harness();
  await assert.rejects(unsupported.service.revoke(base({ requestKey: 'crm-revoke-1' })),
    (error) => error?.code === 'achievement_revoke_unsupported');
  assert.equal(unsupported.revokes.length, 0);

  const supported = harness({ withRevoke: true });
  await supported.service.revoke(base({ requestKey: 'crm-revoke-2' }));
  assert.equal(supported.revokes.length, 1);
  assert.equal(supported.revokes[0].action, 'achievement.revoke');
  assert.equal(supported.revokes[0].audit.requestKey, 'crm-revoke-2');
});

test('identifiers are normalized and required before delegation', async () => {
  const { service, grants } = harness();
  await service.grant(base({ customerId: ' 42 ', achievementCode: ' raise-shields ', requestKey: ' key-1 ' }));
  assert.equal(grants[0].customerId, '42');
  assert.equal(grants[0].achievementCode, 'raise-shields');
  assert.equal(grants[0].requestKey, 'key-1');

  for (const override of [
    { customerId: '' },
    { achievementCode: '' },
    { requestKey: '' }
  ]) {
    const attempt = harness();
    await assert.rejects(attempt.service.grant(base(override)), /is required/);
    assert.equal(attempt.grants.length, 0);
  }
});
