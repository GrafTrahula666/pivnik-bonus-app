import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomerWalletAdjustmentGuard as createGuard } from '../customer-wallet-adjustment-guard.js';

const command = () => ({ tenantId: 'tenant-a', locationId: 'location-a', customerId: '20', actorId: '10',
  amount: 25, reason: 'Fixture correction', requestKey: 'original-key' });
function fixture(overrides = {}) {
  const calls = [], transaction = { query() {} };
  const options = { walletBindingEnabled: true,
    runInTransaction: async action => { calls.push('begin'); try { const result = await action(transaction); calls.push('commit'); return result; } catch (e) { calls.push('rollback'); throw e; } },
    assertWalletOwned: async (tx, value) => { assert.equal(tx, transaction); assert.ok(Object.isFrozen(value)); calls.push('ownership'); return true; },
    executeAdjustment: async (tx, value) => { assert.equal(tx, transaction); calls.push('execute'); return { key: value.requestKey }; }, ...overrides };
  return { calls, transaction, adjust: createGuard(options) };
}
test('wallet guard defaults disabled without calling any transaction or authority', async () => {
  const h = fixture({ walletBindingEnabled: false }); await assert.rejects(h.adjust(command()), { code: 'WALLET_BINDING_UNAVAILABLE' });
  assert.deepEqual(h.calls, []);
  assert.throws(() => fixture({ walletBindingEnabled: 'true' }), TypeError);
  for (const name of ['runInTransaction', 'assertWalletOwned', 'executeAdjustment']) assert.throws(() => fixture({ [name]: null }), TypeError);
});
test('wallet guard validates command before opening transaction', async () => {
  const h = fixture();
  for (const patch of [{ customerId: '20 OR 1=1' }, { actorId: 10 }, { customerId: '9223372036854775808' },
    { tenantId: ' ' }, { locationId: null }, { amount: 0 }, { amount: 1.5 }, { reason: '' }, { requestKey: 'bad key' }]) {
    await assert.rejects(h.adjust({ ...command(), ...patch }), TypeError);
  }
  assert.deepEqual(h.calls, []);
});
test('wallet guard proves ownership before execution in same transaction on every replay', async () => {
  const h = fixture(); for (let n = 0; n < 2; n++) assert.deepEqual(await h.adjust(command()), { key: 'original-key' });
  assert.deepEqual(h.calls, ['begin','ownership','execute','commit','begin','ownership','execute','commit']);
  assert.deepEqual(await h.adjust({ ...command(), requestKey: 'scope:key.v1_123' }), { key: 'scope:key.v1_123' });
});
test('wallet guard denies absent/ambiguous proof and propagates authority failure', async () => {
  for (const owned of [false, null, undefined, 1, 'true', { owned: true }]) {
    const h = fixture({ assertWalletOwned: async () => owned });
    await assert.rejects(h.adjust(command()), { code: 'WALLET_SCOPE_DENIED' }); assert.deepEqual(h.calls, ['begin','rollback']);
  }
  const error = Error('authority outage'), h = fixture({ assertWalletOwned: async () => { throw error; } });
  await assert.rejects(h.adjust(command()), e => e === error); assert.deepEqual(h.calls, ['begin','rollback']);
});
test('wallet guard snapshots allowlisted original command before awaited callbacks', async () => {
  const raw = { ...command(), audit: { actorId: 'spoof' }, owned: true };
  const h = fixture({ assertWalletOwned: async (tx, value) => { raw.actorId = '99'; raw.amount = 500;
    assert.equal(value.actorId, '10'); assert.equal(value.owned, undefined); assert.equal(value.audit.actorId, '10'); return true; },
    executeAdjustment: async (tx, value) => { assert.equal(value.amount, 25); assert.ok(Object.isFrozen(value.audit)); return true; } });
  assert.equal(await h.adjust(raw), true);
});
test('wallet guard propagates executor/transaction failure without returning success', async () => {
  const error = Error('journal unavailable'), h = fixture({ executeAdjustment: async () => { throw error; } });
  await assert.rejects(h.adjust(command()), e => e === error); assert.deepEqual(h.calls, ['begin','ownership','rollback']);
  const failed = fixture({ runInTransaction: async () => { throw error; } });
  await assert.rejects(failed.adjust(command()), e => e === error); assert.deepEqual(failed.calls, []);
});
