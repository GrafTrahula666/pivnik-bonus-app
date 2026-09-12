import test from 'node:test';
import assert from 'node:assert/strict';

import { createMembershipAuthorizationResolver } from '../authorization-membership.js';
import { canAccessLocation, canAccessTenant, canManageTenant } from '../authorization-context.js';

function resolverFor(rowsByUser) {
  const calls = [];
  const resolveAuthorization = createMembershipAuthorizationResolver({
    async loadMemberships(userId) {
      calls.push(userId);
      return rowsByUser[userId] || [];
    }
  });
  return { resolveAuthorization, calls };
}

test('platform admin bypasses membership lookup but remains explicit', async () => {
  const { resolveAuthorization, calls } = resolverFor({});
  const result = await resolveAuthorization({
    userId: 1,
    platformRole: 'platform_admin',
    tenantId: 900,
    locationId: 901,
    legacyRole: 'viewer'
  });

  assert.equal(result.mode, 'scoped');
  assert.equal(result.context.platformRole, 'platform_admin');
  assert.equal(canAccessLocation(result.context, 900, 901), true);
  assert.equal(result.legacyCapabilities.adminRead, true);
  assert.deepEqual(calls, []);
});

test('owner membership is selected only for the requested tenant', async () => {
  const { resolveAuthorization } = resolverFor({
    '7': [
      { role: 'owner', tenant_id: 100 },
      { role: 'staff', tenant_id: 200, location_id: 201 }
    ]
  });

  const ownTenant = await resolveAuthorization({ userId: 7, tenantId: 100, locationId: 101 });
  assert.equal(ownTenant.mode, 'scoped');
  assert.equal(ownTenant.membership.role, 'owner');
  assert.equal(canAccessTenant(ownTenant.context, 100), true);
  assert.equal(canManageTenant(ownTenant.context, 100), true);
  assert.equal(canAccessTenant(ownTenant.context, 200), false);

  const foreignTenant = await resolveAuthorization({ userId: 7, tenantId: 300, legacyRole: 'admin' });
  assert.equal(foreignTenant.mode, 'legacy');
  assert.equal(canAccessTenant(foreignTenant.context, 300), false);
  assert.equal(foreignTenant.legacyCapabilities.adminWrite, true);
});

test('staff membership requires an exact tenant and location match', async () => {
  const { resolveAuthorization } = resolverFor({
    '8': [{ membership_role: 'staff', tenant_id: '100', location_id: '101' }]
  });

  const exact = await resolveAuthorization({ userId: 8, tenantId: 100, locationId: 101 });
  assert.equal(exact.mode, 'scoped');
  assert.equal(canAccessLocation(exact.context, 100, 101), true);
  assert.equal(canAccessLocation(exact.context, 100, 102), false);

  const otherLocation = await resolveAuthorization({
    userId: 8,
    tenantId: 100,
    locationId: 102,
    legacyRole: 'staff'
  });
  assert.equal(otherLocation.mode, 'legacy');
  assert.equal(canAccessLocation(otherLocation.context, 100, 102), false);
  assert.equal(otherLocation.legacyCapabilities.staff, true);
});

test('legacy fallback never invents tenant scope', async () => {
  const { resolveAuthorization } = resolverFor({ '9': [] });
  const result = await resolveAuthorization({
    userId: 9,
    tenantId: 100,
    locationId: 101,
    legacyRole: 'admin'
  });

  assert.equal(result.mode, 'legacy');
  assert.equal(result.legacyCapabilities.adminWrite, true);
  assert.equal(canAccessTenant(result.context, 100), false);
  assert.equal(canAccessLocation(result.context, 100, 101), false);
});

test('invalid membership rows fail closed instead of being ignored', async () => {
  const { resolveAuthorization } = resolverFor({
    '10': [{ role: 'staff', tenant_id: 100 }]
  });

  await assert.rejects(
    resolveAuthorization({ userId: 10, tenantId: 100, locationId: 101 }),
    /staff membership requires locationId/
  );
});

test('resolver requires a read-only loader contract', () => {
  assert.throws(() => createMembershipAuthorizationResolver({}), /loadMemberships must be a function/);
});
