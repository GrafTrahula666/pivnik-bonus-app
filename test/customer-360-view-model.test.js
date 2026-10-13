import assert from 'node:assert/strict';
import test from 'node:test';

import { createCustomer360ViewModel, customer360ViewModelContract } from '../customer-360-view-model.js';

function baseCustomer() {
  return {
    customerId: 42,
    identity: {
      id: 42,
      username: 'client42',
      firstName: 'Ada',
      lastName: 'Lovelace',
      createdAt: '2026-01-01T00:00:00.000Z',
      photoUrl: null,
      profileFrame: null,
      bonusBalance: null,
      paidMlTotal: null,
      giftMlBalance: null,
      internalOnlyField: 'omit-me'
    },
    financial: {
      cashPaidCents: 12345,
      bonusCredited: 50,
      bonusDebited: 10,
      completedOperations: 2,
      lastActivityAt: '2026-09-10T10:00:00.000Z',
      internalScore: 999
    },
    timeline: {
      rows: [{
        id: 9,
        clientId: 42,
        staffId: 7,
        mode: 'accrue',
        status: 'completed',
        checkAmountCents: 2500,
        cashPaidCents: null,
        bonusEarned: 20,
        bonusSpent: null,
        reason: null,
        rewardCode: null,
        createdAt: '2026-09-10T10:00:00.000Z',
        completedAt: '2026-09-10T10:00:01.000Z',
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        rawPayload: { hidden: true }
      }],
      hasMore: true,
      limit: 25,
      offset: 0
    },
    metadata: null,
    internalTopLevel: 'omit-me'
  };
}

test('Customer 360 view model exposes only presentation whitelist and keeps scoped unknown wallet explicit', () => {
  const view = createCustomer360ViewModel(baseCustomer());
  assert.equal(view.customerId, 42);
  assert.equal(view.identity.displayName, 'Ada Lovelace');
  assert.equal(view.identity.bonusBalance, null);
  assert.equal(view.identity.walletScoped, false);
  assert.equal(view.financial.cashPaid.cents, 12345);
  assert.equal(view.financial.cashPaid.rubles, 123.45);
  assert.equal(view.timeline.rows[0].cashPaid, null);
  assert.equal(view.timeline.rows[0].bonusSpent, null);
  assert.equal(view.timeline.rows[0].checkAmount.cents, 2500);
  assert.equal(view.timeline.hasMore, true);
  assert.equal(view.timeline.limit, 25);
  assert.equal(view.metadata.available, false);
  assert.equal('internalOnlyField' in view.identity, false);
  assert.equal('internalScore' in view.financial, false);
  assert.equal('rawPayload' in view.timeline.rows[0], false);
  assert.equal('internalTopLevel' in view, false);
});

test('Customer 360 view model normalizes enabled metadata without scope/internal fields', () => {
  const customer = baseCustomer();
  customer.metadata = {
    events: [{
      id: '9007199254740993', tenantId: 'tenant-a', locationId: 'loc-1', customerId: '42',
      actorId: 'owner-7', type: 'note_added', value: 'Prefers a quiet table', reason: 'service context',
      requestKey: 'request-1', createdAt: '2026-09-14T06:00:00.000Z'
    }],
    tags: [{ value: 'vip', actorId: 'owner-7', reason: 'manual review', createdAt: '2026-09-14T06:01:00.000Z' }],
    segments: [{ value: 'returning', actorId: 'owner-8', reason: 'manual review', createdAt: '2026-09-14T06:02:00.000Z' }]
  };
  const view = createCustomer360ViewModel(customer);
  assert.equal(view.metadata.available, true);
  assert.equal(view.metadata.events[0].id, '9007199254740993');
  assert.equal(view.metadata.events[0].value, 'Prefers a quiet table');
  assert.equal(view.metadata.tags[0].value, 'vip');
  assert.equal(view.metadata.segments[0].value, 'returning');
  assert.equal('requestKey' in view.metadata.events[0], false);
  assert.equal('tenantId' in view.metadata.events[0], false);
  assert.equal('locationId' in view.metadata.events[0], false);
});

test('Customer 360 view model fails closed on identity mismatch and unsafe integers', () => {
  const mismatch = baseCustomer();
  mismatch.identity.id = 43;
  assert.throws(() => createCustomer360ViewModel(mismatch), /does not match/);
  const unsafe = baseCustomer();
  unsafe.financial.cashPaidCents = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => createCustomer360ViewModel(unsafe), /safe integer/);
});

test('Customer 360 view model contract forbids synthetic values and raw backend exposure', () => {
  assert.equal(customer360ViewModelContract.whitelistOnly, true);
  assert.equal(customer360ViewModelContract.rawBackendObjectExposed, false);
  assert.equal(customer360ViewModelContract.unsafeIntegersFailClosed, true);
  assert.equal(customer360ViewModelContract.unknownFinancialValuesRemainNull, true);
  assert.equal(customer360ViewModelContract.scopedUnknownWalletDisplayedAsZero, false);
  assert.equal(customer360ViewModelContract.dependenciesAdded, false);
});
