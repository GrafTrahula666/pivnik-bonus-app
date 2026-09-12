import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorizationContext } from '../authorization-context.js';
import {
  buildTransactionReadPredicate,
  createMigrationGatedTransactionReadScope,
  resolveTransactionReadScope,
  transactionReadScopeContract
} from '../transaction-read-scope.js';

const platformAdmin = createAuthorizationContext({ platformRole: 'platform_admin' });
const owner = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'loc-1' });

test('legacy transaction reads stay global only while scoped reads are disabled', () => {
  const resolve = createMigrationGatedTransactionReadScope();
  assert.deepEqual(resolve(), { level: 'legacy', tenantId: null, locationId: null });
  assert.throws(
    () => resolve({ authorizationContext: owner }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );
});

test('scoped mode never falls back to a global legacy read', () => {
  const resolve = createMigrationGatedTransactionReadScope({ scopedReadsEnabled: true });
  assert.throws(() => resolve(), /authorizationContext is required/);
});

test('platform admin may read globally or deliberately narrow the scope', () => {
  assert.deepEqual(resolveTransactionReadScope({ authorizationContext: platformAdmin }), {
    level: 'platform', tenantId: null, locationId: null
  });
  assert.deepEqual(resolveTransactionReadScope({ authorizationContext: platformAdmin, tenantId: 'tenant-b' }), {
    level: 'tenant', tenantId: 'tenant-b', locationId: null
  });
  assert.deepEqual(resolveTransactionReadScope({
    authorizationContext: platformAdmin,
    tenantId: 'tenant-b',
    locationId: 'loc-9'
  }), {
    level: 'location', tenantId: 'tenant-b', locationId: 'loc-9'
  });
});

test('owner defaults to its tenant and cannot cross tenant boundaries', () => {
  assert.deepEqual(resolveTransactionReadScope({ authorizationContext: owner }), {
    level: 'tenant', tenantId: 'tenant-a', locationId: null
  });
  assert.deepEqual(resolveTransactionReadScope({
    authorizationContext: owner,
    tenantId: 'tenant-a',
    locationId: 'loc-2'
  }), {
    level: 'location', tenantId: 'tenant-a', locationId: 'loc-2'
  });
  assert.throws(
    () => resolveTransactionReadScope({ authorizationContext: owner, tenantId: 'tenant-b' }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
});

test('staff defaults to its exact location and cannot widen or switch location', () => {
  assert.deepEqual(resolveTransactionReadScope({ authorizationContext: staff }), {
    level: 'location', tenantId: 'tenant-a', locationId: 'loc-1'
  });
  assert.throws(
    () => resolveTransactionReadScope({ authorizationContext: staff, tenantId: 'tenant-a', locationId: 'loc-2' }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
  assert.throws(
    () => resolveTransactionReadScope({ authorizationContext: staff, tenantId: 'tenant-b', locationId: 'loc-1' }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
});

test('location target always requires an explicit tenant target', () => {
  assert.throws(
    () => resolveTransactionReadScope({ authorizationContext: platformAdmin, locationId: 'loc-1' }),
    /locationId requires tenantId/
  );
});

test('legacy roles are not treated as tenant membership', () => {
  assert.throws(
    () => resolveTransactionReadScope({ authorizationContext: { role: 'admin' } }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_FORBIDDEN'
  );
});

test('predicate builder emits parameterized tenant and location constraints', () => {
  assert.deepEqual(buildTransactionReadPredicate({ level: 'tenant', tenantId: 'tenant-a', locationId: null }), {
    sql: 't.tenant_id = $1',
    params: ['tenant-a']
  });
  assert.deepEqual(buildTransactionReadPredicate(
    { level: 'location', tenantId: 'tenant-a', locationId: 'loc-1' },
    { alias: 'tx', firstParameter: 3 }
  ), {
    sql: 'tx.tenant_id = $3 AND tx.location_id = $4',
    params: ['tenant-a', 'loc-1']
  });
});

test('platform and legacy scopes deliberately produce no SQL predicate', () => {
  assert.deepEqual(buildTransactionReadPredicate({ level: 'platform' }), { sql: '', params: [] });
  assert.deepEqual(buildTransactionReadPredicate({ level: 'legacy' }), { sql: '', params: [] });
});

test('predicate builder rejects unsafe aliases and invalid parameter positions', () => {
  assert.throws(() => buildTransactionReadPredicate({ level: 'tenant', tenantId: 'tenant-a' }, { alias: 't; DROP TABLE' }), /alias is invalid/);
  assert.throws(() => buildTransactionReadPredicate({ level: 'tenant', tenantId: 'tenant-a' }, { firstParameter: 0 }), /firstParameter/);
});

test('read scope contract documents fail-closed SaaS semantics', () => {
  assert.equal(transactionReadScopeContract.scopedReadsEnabledByDefault, false);
  assert.equal(transactionReadScopeContract.platformAdminMayReadGlobally, true);
  assert.equal(transactionReadScopeContract.ownerDefaultScope, 'tenant');
  assert.equal(transactionReadScopeContract.staffDefaultScope, 'location');
  assert.equal(transactionReadScopeContract.legacyRoleInference, false);
  assert.equal(transactionReadScopeContract.scopedFallbackToGlobal, false);
});
