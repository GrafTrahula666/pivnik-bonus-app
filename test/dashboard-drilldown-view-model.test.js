import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDashboardDrilldownViewModel,
  dashboardDrilldownViewModelContract
} from '../dashboard-drilldown-view-model.js';

function fieldMap(row) {
  return Object.fromEntries(row.fields.map((field) => [field.key, field]));
}

test('unwraps endpoint envelope and renders only whitelisted transaction fields', () => {
  const viewModel = createDashboardDrilldownViewModel({
    ok: true,
    drilldown: {
      rowKind: 'transaction',
      rows: [{
        id: 'tx-1',
        client_id: 'client-7',
        location_id: 'location-a',
        mode: 'purchase',
        check_amount_cents: '12345',
        cash_paid_cents: 10000,
        bonus_earned: 17,
        bonus_spent: 3,
        reason: 'Покупка',
        reward_code: null,
        created_at: '2026-09-13T12:34:00.000Z',
        completed_at: '2026-09-13T12:35:00.000Z',
        secret_internal_field: 'must-never-render'
      }],
      hasMore: false,
      limit: 50,
      offset: 0
    }
  });

  assert.equal(viewModel.rowKind, 'transaction');
  assert.equal(viewModel.rows.length, 1);
  assert.equal(viewModel.empty, false);
  assert.equal(viewModel.hasMore, false);

  const fields = fieldMap(viewModel.rows[0]);
  assert.equal(fields.clientId.text, 'client-7');
  assert.equal(fields.check.value, 12345);
  assert.match(fields.check.text, /123,45 ₽$/u);
  assert.equal(fields.bonusEarned.text, '17');
  assert.equal(fields.createdAt.text, '13.09.2026, 12:34 UTC');
  assert.equal(fields.rewardCode.text, '—');
  assert.equal(viewModel.displayedFieldKeys.includes('secret_internal_field'), false);
  assert.equal(JSON.stringify(viewModel).includes('must-never-render'), false);
});

test('builds active-client rows with bounded presentation fields', () => {
  const viewModel = createDashboardDrilldownViewModel({
    rowKind: 'client',
    rows: [{
      client_id: 'client-9',
      completed_ops: 4,
      check_cents: 509900,
      bonus_issued: '240',
      bonus_spent: 80,
      last_activity_at: '2026-09-13T17:00:00Z',
      email: 'hidden@example.test'
    }],
    hasMore: true,
    limit: 25,
    offset: 50
  });

  const fields = fieldMap(viewModel.rows[0]);
  assert.deepEqual(viewModel.displayedFieldKeys, [
    'clientId',
    'completedOps',
    'check',
    'bonusIssued',
    'bonusSpent',
    'lastActivityAt'
  ]);
  assert.equal(fields.clientId.text, 'client-9');
  assert.equal(fields.completedOps.text, '4');
  assert.match(fields.check.text, /5.?099 ₽$/u);
  assert.equal(viewModel.nextOffset, 75);
  assert.equal(JSON.stringify(viewModel).includes('hidden@example.test'), false);
});

test('represents an empty backend page honestly', () => {
  const viewModel = createDashboardDrilldownViewModel({
    rowKind: 'transaction',
    rows: [],
    hasMore: false,
    limit: 50,
    offset: 0
  });

  assert.equal(viewModel.empty, true);
  assert.deepEqual(viewModel.rows, []);
  assert.deepEqual(viewModel.displayedFieldKeys, []);
  assert.equal(viewModel.nextOffset, null);
});

test('fails closed for unsafe numeric values', () => {
  assert.throws(() => createDashboardDrilldownViewModel({
    rowKind: 'client',
    rows: [{
      client_id: 'client-1',
      completed_ops: 1,
      check_cents: '9007199254740992',
      bonus_issued: 0,
      bonus_spent: 0,
      last_activity_at: '2026-09-13T17:00:00Z'
    }],
    limit: 50,
    offset: 0
  }), /safe integer/u);
});

test('fails closed for unsupported row kinds and malformed response', () => {
  assert.throws(() => createDashboardDrilldownViewModel({ rowKind: 'raw_sql', rows: [] }), /not supported/u);
  assert.throws(() => createDashboardDrilldownViewModel({ rowKind: 'transaction' }), /rows must be an array/u);
});

test('contract forbids raw JSON and unknown-field display', () => {
  assert.equal(dashboardDrilldownViewModelContract.rawJsonRendering, false);
  assert.equal(dashboardDrilldownViewModelContract.unknownFieldsDisplayed, false);
  assert.equal(dashboardDrilldownViewModelContract.dependenciesAdded, false);
  assert.equal(dashboardDrilldownViewModelContract.productionWiringEnabled, false);
});
