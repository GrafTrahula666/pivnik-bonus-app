import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthorizationContext } from '../authorization-context.js';
import {
  createCustomerBonusAdjustmentRuntime,
  customerBonusAdjustmentRuntimeContract
} from '../customer-bonus-adjustment-runtime.js';

const owner = createAuthorizationContext({
  membershipRole: 'owner',
  tenantId: 'tenant-a'
});

function queuedDb(rowsByQuery) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const rows = rowsByQuery.shift();
      if (rows === undefined) throw new Error('Unexpected query');
      return { rows };
    }
  };
}

test('runtime uses Customer 360 tenant visibility before executing adjustment', async () => {
  const db = queuedDb([[{ ok: 1 }]]);
  const executions = [];
  const runtime = createCustomerBonusAdjustmentRuntime({
    db,
    scopedReadsEnabled: true,
    executeAdjustment: async (command) => {
      executions.push(command);
      return { ok: true };
    }
  });

  const result = await runtime.adjust({
    context: owner,
    tenantId: 'tenant-a',
    actorId: '7',
    customerId: '42',
    amount: 100,
    reason: 'Service recovery',
    requestKey: 'crm-adjust-42-1',
    confirmed: true
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM transactions t/);
  assert.match(db.calls[0].sql, /t\.tenant_id = \$2/);
  assert.deepEqual(db.calls[0].params, [42, 'tenant-a']);
  assert.equal(executions.length, 1);
  assert.equal(executions[0].customerId, '42');
  assert.equal(executions[0].tenantId, 'tenant-a');
  assert.equal(executions[0].audit.customerId, '42');
});

test('runtime fails closed when Customer 360 visibility proof is absent', async () => {
  const db = queuedDb([[]]);
  let executed = false;
  const runtime = createCustomerBonusAdjustmentRuntime({
    db,
    scopedReadsEnabled: true,
    executeAdjustment: async () => {
      executed = true;
    }
  });

  await assert.rejects(
    runtime.adjust({
      context: owner,
      tenantId: 'tenant-a',
      actorId: '7',
      customerId: '42',
      amount: -50,
      reason: 'Correction',
      requestKey: 'crm-adjust-42-2',
      confirmed: true
    }),
    (error) => error?.code === 'customer_scope_denied'
  );

  assert.equal(executed, false);
  assert.equal(db.calls.length, 1);
});

test('runtime keeps scoped bonus writes migration-gated until migration 009 is deliberately enabled', async () => {
  const db = queuedDb([]);
  let executed = false;
  const runtime = createCustomerBonusAdjustmentRuntime({
    db,
    executeAdjustment: async () => {
      executed = true;
    }
  });

  await assert.rejects(
    runtime.adjust({
      context: owner,
      tenantId: 'tenant-a',
      actorId: '7',
      customerId: '42',
      amount: 50,
      reason: 'Correction',
      requestKey: 'crm-adjust-42-3',
      confirmed: true
    }),
    (error) => error?.code === 'TRANSACTION_READ_SCOPE_MIGRATION_GATED'
  );

  assert.equal(executed, false);
  assert.equal(db.calls.length, 0);
});

test('runtime contract documents shared scope and financial boundaries', () => {
  assert.equal(customerBonusAdjustmentRuntimeContract.visibilityBoundary, 'customer-360-read-repository');
  assert.equal(customerBonusAdjustmentRuntimeContract.financialBoundary, 'admin-adjustment-executor-compatible');
  assert.equal(customerBonusAdjustmentRuntimeContract.scopedFallbackToGlobal, false);
  assert.equal(customerBonusAdjustmentRuntimeContract.duplicatesTenantOwnershipLogic, false);
  assert.equal(customerBonusAdjustmentRuntimeContract.productionRouteWired, false);
  assert.equal(customerBonusAdjustmentRuntimeContract.migrationApplied, false);
  assert.equal(customerBonusAdjustmentRuntimeContract.externalDependenciesAdded, false);
});
