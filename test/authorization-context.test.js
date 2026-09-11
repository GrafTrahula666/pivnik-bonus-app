import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canAccessLocation,
  canAccessTenant,
  canManageTenant,
  canWriteLocation,
  createAuthorizationContext,
  getLegacyRoleCapabilities
} from '../authorization-context.js';

test('authorization context rejects ambiguous or incomplete scope', () => {
  assert.throws(
    () => createAuthorizationContext({ membershipRole: 'owner' }),
    /owner membership requires tenantId/
  );
  assert.throws(
    () => createAuthorizationContext({ membershipRole: 'staff', tenantId: 1 }),
    /staff membership requires locationId/
  );
  assert.throws(
    () => createAuthorizationContext({ locationId: 10 }),
    /locationId requires tenantId/
  );
  assert.throws(
    () => createAuthorizationContext({ membershipRole: 'admin', tenantId: 1 }),
    /Unknown membership role/
  );
});

test('platform admin can cross tenant and location boundaries explicitly', () => {
  const context = createAuthorizationContext({ platformRole: 'platform_admin' });

  assert.equal(canAccessTenant(context, 100), true);
  assert.equal(canAccessLocation(context, 100, 1001), true);
  assert.equal(canManageTenant(context, 200), true);
  assert.equal(canWriteLocation(context, 200, 2001), true);
});

test('owner is constrained to its tenant but can operate across its locations', () => {
  const context = createAuthorizationContext({ membershipRole: 'owner', tenantId: 100 });

  assert.equal(canAccessTenant(context, 100), true);
  assert.equal(canAccessTenant(context, 200), false);
  assert.equal(canAccessLocation(context, 100, 1001), true);
  assert.equal(canAccessLocation(context, 100, 1002), true);
  assert.equal(canAccessLocation(context, 200, 2001), false);
  assert.equal(canManageTenant(context, 100), true);
  assert.equal(canManageTenant(context, 200), false);
});

test('staff is constrained to one explicit tenant/location scope', () => {
  const context = createAuthorizationContext({
    membershipRole: 'staff',
    tenantId: '100',
    locationId: '1001'
  });

  assert.equal(canAccessTenant(context, 100), true);
  assert.equal(canAccessTenant(context, 200), false);
  assert.equal(canAccessLocation(context, 100, 1001), true);
  assert.equal(canAccessLocation(context, 100, 1002), false);
  assert.equal(canAccessLocation(context, 200, 1001), false);
  assert.equal(canManageTenant(context, 100), false);
  assert.equal(canWriteLocation(context, 100, 1001), true);
  assert.equal(canWriteLocation(context, 100, 1002), false);
});

test('missing identity is deny-by-default', () => {
  const context = createAuthorizationContext();

  assert.equal(canAccessTenant(context, 100), false);
  assert.equal(canAccessLocation(context, 100, 1001), false);
  assert.equal(canManageTenant(context, 100), false);
  assert.equal(canWriteLocation(context, 100, 1001), false);
});

test('legacy role adapter documents current behavior without inventing SaaS scope', () => {
  assert.deepEqual(getLegacyRoleCapabilities('client'), {
    staff: false,
    adminRead: false,
    adminWrite: false
  });
  assert.deepEqual(getLegacyRoleCapabilities('staff'), {
    staff: true,
    adminRead: false,
    adminWrite: false
  });
  assert.deepEqual(getLegacyRoleCapabilities('viewer'), {
    staff: false,
    adminRead: true,
    adminWrite: false
  });
  assert.deepEqual(getLegacyRoleCapabilities('admin'), {
    staff: true,
    adminRead: true,
    adminWrite: true
  });
  assert.deepEqual(getLegacyRoleCapabilities(null), {
    staff: false,
    adminRead: false,
    adminWrite: false
  });
  assert.throws(() => getLegacyRoleCapabilities('owner'), /Unknown legacy role/);
});
