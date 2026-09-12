import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  resolveTransactionAttribution,
  transactionAttributionContract
} from '../transaction-attribution.js';

test('owner can attribute a new transaction only inside the owned tenant', () => {
  const context = createAuthorizationContext({
    membershipRole: 'owner',
    tenantId: 'tenant-a'
  });

  const scope = resolveTransactionAttribution({
    authorizationContext: context,
    tenantId: ' tenant-a ',
    locationId: ' location-1 '
  });

  assert.deepEqual(scope.columns, {
    tenant_id: 'tenant-a',
    location_id: 'location-1'
  });
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.columns), true);

  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: context,
      tenantId: 'tenant-b',
      locationId: 'location-1'
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_FORBIDDEN'
  );
});

test('staff can attribute only its exact tenant and location', () => {
  const context = createAuthorizationContext({
    membershipRole: 'staff',
    tenantId: 'tenant-a',
    locationId: 'location-1'
  });

  assert.deepEqual(
    resolveTransactionAttribution({
      authorizationContext: context,
      tenantId: 'tenant-a',
      locationId: 'location-1'
    }).columns,
    { tenant_id: 'tenant-a', location_id: 'location-1' }
  );

  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: context,
      tenantId: 'tenant-a',
      locationId: 'location-2'
    }),
    /not authorized/
  );
  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: context,
      tenantId: 'tenant-b',
      locationId: 'location-1'
    }),
    /not authorized/
  );
});

test('platform admin still requires an explicit target scope', () => {
  const context = createAuthorizationContext({ platformRole: 'platform_admin' });

  assert.deepEqual(
    resolveTransactionAttribution({
      authorizationContext: context,
      tenantId: 'tenant-b',
      locationId: 'location-9'
    }).columns,
    { tenant_id: 'tenant-b', location_id: 'location-9' }
  );

  assert.throws(
    () => resolveTransactionAttribution({ authorizationContext: context, locationId: 'location-9' }),
    /tenantId is required/
  );
  assert.throws(
    () => resolveTransactionAttribution({ authorizationContext: context, tenantId: 'tenant-b' }),
    /locationId is required/
  );
});

test('legacy roles never become transaction tenant attribution', () => {
  const legacyOnly = createAuthorizationContext();

  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: legacyOnly,
      tenantId: 'tenant-a',
      locationId: 'location-1'
    }),
    (error) => error?.code === 'TRANSACTION_SCOPE_FORBIDDEN'
  );
});

test('missing or malformed write scope fails closed before persistence', () => {
  assert.throws(
    () => resolveTransactionAttribution({
      tenantId: 'tenant-a',
      locationId: 'location-1'
    }),
    /authorizationContext is required/
  );
  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: {},
      tenantId: '   ',
      locationId: 'location-1'
    }),
    /tenantId must be a non-empty identifier/
  );
  assert.throws(
    () => resolveTransactionAttribution({
      authorizationContext: {},
      tenantId: 'tenant-a',
      locationId: '   '
    }),
    /locationId must be a non-empty identifier/
  );
});

test('transaction attribution contract forbids inferred historical backfill', () => {
  assert.equal(transactionAttributionContract.appliesTo, 'new-transactions-only');
  assert.deepEqual(transactionAttributionContract.requiredColumns, ['tenant_id', 'location_id']);
  assert.equal(transactionAttributionContract.historicalBackfill, false);
  assert.equal(transactionAttributionContract.requiresExplicitTenant, true);
  assert.equal(transactionAttributionContract.requiresExplicitLocation, true);
  assert.equal(transactionAttributionContract.derivesFromLegacyRole, false);
});
