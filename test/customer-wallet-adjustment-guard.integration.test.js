import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createCustomerWalletAdjustmentGuard } from '../customer-wallet-adjustment-guard.js';

test('wallet guard shares SQL transaction with fixture binding and rolls back denied/failed execution', async t => {
  const db = new PGlite(); t.after(() => db.close());
  // Proposed authority semantics only: this schema is NOT a production migration.
  await db.exec(`CREATE TABLE fixture_binding(customer_id TEXT, tenant_id TEXT, location_id TEXT, revoked BOOLEAN);
    CREATE TABLE fixture_wallet(customer_id TEXT PRIMARY KEY, balance INTEGER CHECK(balance>=0));
    CREATE TABLE fixture_journal(key TEXT PRIMARY KEY, amount INTEGER);
    INSERT INTO fixture_binding VALUES('20','tenant-a','location-a',FALSE);
    INSERT INTO fixture_wallet VALUES('20',100);`);
  const calls = [], snapshot = async () => ({ wallets: (await db.query('SELECT * FROM fixture_wallet')).rows,
    journal: (await db.query('SELECT * FROM fixture_journal ORDER BY key')).rows });
  const options = { walletBindingEnabled: true,
    runInTransaction: async action => { await db.exec('BEGIN'); try { const r = await action(db); await db.exec('COMMIT'); return r; }
      catch (e) { await db.exec('ROLLBACK'); throw e; } },
    assertWalletOwned: async (tx, command) => { assert.equal(tx, db); calls.push('proof');
      const r = await tx.query('SELECT * FROM fixture_binding WHERE customer_id=$1 AND tenant_id=$2 AND location_id=$3 AND revoked=FALSE FOR UPDATE',
        [command.customerId,command.tenantId,command.locationId]); return r.rows.length === 1; },
    executeAdjustment: async (tx, command) => { assert.equal(tx, db); calls.push('execute');
      await tx.query('UPDATE fixture_wallet SET balance=balance+$1 WHERE customer_id=$2', [command.amount, command.customerId]);
      await tx.query('INSERT INTO fixture_journal VALUES($1,$2)', [command.requestKey,command.amount]); return { saved: true }; } };
  const adjust = createCustomerWalletAdjustmentGuard(options);
  const command = { tenantId: 'tenant-a', locationId: 'location-a', customerId: '20', actorId: '10',
    amount: 25, reason: 'Isolated correction', requestKey: 'fixture-key' };
  assert.deepEqual(await adjust(command), { saved: true });
  assert.deepEqual(calls, ['proof','execute']);
  const saved = await snapshot(); assert.equal(saved.wallets[0].balance, 125);
  await assert.rejects(adjust(command), error => error.code === '23505');
  assert.deepEqual(await snapshot(), saved); // Duplicate journal failure rolls wallet update back.
  const count = calls.filter(c => c === 'execute').length;
  for (const patch of [{ tenantId: 'tenant-b' }, { locationId: 'location-b' }, { customerId: '21' }]) {
    await assert.rejects(adjust({ ...command, ...patch }), { code: 'WALLET_SCOPE_DENIED' });
  }
  assert.equal(calls.filter(c => c === 'execute').length, count); assert.deepEqual(await snapshot(), saved);
  assert.deepEqual(await adjust({ ...command, amount: -10, requestKey: 'fixture-debit' }), { saved: true });
  assert.equal((await snapshot()).wallets[0].balance, 115);
  await db.exec('UPDATE fixture_binding SET revoked=TRUE'); const revoked = await snapshot();
  await assert.rejects(adjust({ ...command, requestKey: 'after-revocation' }), { code: 'WALLET_SCOPE_DENIED' });
  assert.deepEqual(await snapshot(), revoked);
  const outage = Error('fixture binding SQL unavailable');
  const failed = createCustomerWalletAdjustmentGuard({ ...options, assertWalletOwned: async () => { throw outage; } });
  await assert.rejects(failed(command), e => e === outage); assert.deepEqual(await snapshot(), revoked);
});
