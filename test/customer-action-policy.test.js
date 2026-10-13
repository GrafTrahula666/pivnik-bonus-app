import test from 'node:test';
import assert from 'node:assert/strict';

import {
  customerActionPolicyContract,
  evaluateCustomerAction
} from '../customer-action-policy.js';
import { createAuthorizationContext } from '../authorization-context.js';

const owner = createAuthorizationContext({
  membershipRole: 'owner',
  tenantId: 'tenant-a'
});
const staff = createAuthorizationContext({
  membershipRole: 'staff',
  tenantId: 'tenant-a',
  locationId: 'location-1'
});
const platformAdmin = createAuthorizationContext({ platformRole: 'platform_admin' });

function evaluate(overrides = {}) {
  return evaluateCustomerAction({
    context: owner,
    tenantId: 'tenant-a',
    locationId: 'location-1',
    action: 'customer.read',
    ...overrides
  });
}

test('owner can read a customer in its own tenant/location', () => {
  const result = evaluate();
  assert.equal(result.allowed, true);
  assert.equal(result.auditRequired, false);
});

test('staff can read and add metadata only inside its exact location', () => {
  assert.equal(evaluate({ context: staff, action: 'customer.read' }).allowed, true);
  assert.equal(evaluate({ context: staff, action: 'note.add', actorId: 'staff-1' }).allowed, true);
  assert.equal(evaluate({ context: staff, action: 'tag.add', actorId: 'staff-1' }).allowed, true);

  const crossLocation = evaluate({
    context: staff,
    locationId: 'location-2',
    action: 'note.add',
    actorId: 'staff-1'
  });
  assert.equal(crossLocation.allowed, false);
  assert.equal(crossLocation.code, 'scope_denied');
});

test('staff cannot perform balance or achievement mutations', () => {
  for (const action of ['bonus.adjust', 'achievement.grant', 'achievement.revoke']) {
    const result = evaluate({
      context: staff,
      action,
      actorId: 'staff-1',
      reason: 'Approved correction'
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'manager_required');
  }
});

test('owner high-impact action requires actor, reason and confirmation metadata', () => {
  assert.throws(
    () => evaluate({ action: 'bonus.adjust', reason: 'Correction' }),
    /actorId is required/
  );

  const missingReason = evaluate({ action: 'bonus.adjust', actorId: 'owner-1' });
  assert.equal(missingReason.allowed, false);
  assert.equal(missingReason.code, 'reason_required');

  const allowed = evaluate({
    action: 'bonus.adjust',
    actorId: 'owner-1',
    reason: 'Manual correction after receipt review'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.auditRequired, true);
  assert.equal(allowed.confirmationRequired, true);
  assert.equal(allowed.reasonRequired, true);
});

test('platform admin may manage a customer in any explicit tenant/location', () => {
  const result = evaluate({
    context: platformAdmin,
    tenantId: 'tenant-z',
    locationId: 'location-99',
    action: 'achievement.grant',
    actorId: 'platform-1',
    reason: 'Support-approved manual grant'
  });
  assert.equal(result.allowed, true);
});

test('owner cannot cross tenant boundaries', () => {
  const result = evaluate({
    tenantId: 'tenant-b',
    action: 'bonus.adjust',
    actorId: 'owner-1',
    reason: 'Attempted correction'
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'scope_denied');
});

test('all Customer 360 mutations require an actor', () => {
  for (const action of [
    'note.add',
    'tag.add',
    'tag.remove',
    'segment.add',
    'segment.remove'
  ]) {
    assert.throws(() => evaluate({ action }), /actorId is required/);
  }
});

test('unknown actions and invalid scope inputs fail closed', () => {
  assert.throws(() => evaluate({ action: 'customer.delete' }), /Unknown customer action/);
  assert.throws(() => evaluate({ tenantId: '' }), /tenantId is required/);
  assert.throws(() => evaluate({ locationId: '' }), /locationId is required/);
});

test('reason length is bounded for auditable actions', () => {
  assert.throws(
    () => evaluate({
      action: 'bonus.adjust',
      actorId: 'owner-1',
      reason: 'x'.repeat(501)
    }),
    /reason must not exceed 500 characters/
  );
});

test('policy contract documents conservative Customer 360 defaults', () => {
  assert.equal(customerActionPolicyContract.legacyRolesCreateScope, false);
  assert.equal(customerActionPolicyContract.highImpactActionsRequireTenantManager, true);
  assert.equal(customerActionPolicyContract.highImpactActionsRequireReason, true);
  assert.equal(customerActionPolicyContract.highImpactActionsRequireConfirmation, true);
  assert.equal(customerActionPolicyContract.mutationsRequireActor, true);
  assert.equal(customerActionPolicyContract.staffScope, 'exact-location');
  assert.equal(customerActionPolicyContract.auditAllMutations, true);
});
