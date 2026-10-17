import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPosHttp } from '../pos/http.js';
import { createPosDeviceService } from '../pos/devices.js';

test('only a live QR plus an active till key exposes a read-only wallet snapshot', async t => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,first_name TEXT,telegram_id BIGINT,
      role TEXT,unlimited_bonus BOOLEAN DEFAULT FALSE,qr_token TEXT,qr_short_code TEXT,
      deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
      CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
      CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT);
      CREATE TABLE transactions(id BIGINT,bonus_spent BIGINT);
      INSERT INTO users(id,first_name,telegram_id,role,qr_token,qr_short_code) VALUES
        (1,'Guest',11,'client','fixture-customer-secret','PVK-AAAA-2222'),
        (2,'Other',22,'client',NULL,'PVK-BBBB-3333'),(3,'Owner',33,'admin',NULL,NULL);
      INSERT INTO qr_aliases(qr_short_code,user_id,source_user_id) VALUES('PVK-CCCC-4444',1,1);
      INSERT INTO wallets VALUES(1,123),(2,900); INSERT INTO transactions VALUES(1,9);`);
    for (const file of ['012_evotor_sales.sql', '013_evotor_pos_scope_devices.sql']) {
      await db.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    }
    await db.exec(`INSERT INTO pos_store_bindings VALUES('bar','tenant-a','location-a',TRUE);
      INSERT INTO pos_operator_access VALUES(3,'bar',TRUE,NULL);`);
    const pool = { query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) };
    const config = { enabled: true, storeId: 'bar' };
    const owner = { id: '3', role: 'admin', termsAccepted: true };
    const policy = { isUnlimited: user => user.unlimited_bonus || user.role === 'viewer', unlimitedBalance: 9_999_999_999_999 };
    const devices = createPosDeviceService(pool, config, policy);
    const issued = await devices.issue(owner, { storeId: 'bar', externalDeviceId: 'till', label: 'Till' });
    const http = createPosHttp(pool, config, Date.now, policy);
    const request = (body = {}, deviceKey = issued.deviceToken) => http.device({
      method: 'POST', pathname: '/api/device/pos/qr/resolve',
      authorization: 'Bearer fixture-evotor-cloud-token', deviceKey,
      body: { payload: 'PVK-AAAA-2222', includeWallet: true, ...body }, address: 'till'
    });
    const financial = async () => ({ wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
      transactions: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
    const before = await financial();
    await t.test('balance comes from the live QR owner, never supplied IDs, balances or another customer', async () => {
      assert.deepEqual(await request({ clientId: '2', balance: 999999 }), {
        client: { id: '1', firstName: 'Guest' }, wallet: { balance: 123, unlimited: false, pointsPerRuble: 1, maxSpendPercent: 30 }
      });
      const response = JSON.stringify(await request());
      for (const secret of ['fixture-customer-secret', 'telegram_id', 'unlimited_bonus', 'fixture-evotor-cloud-token', issued.deviceToken]) {
        assert.ok(!response.includes(secret));
      }
      await assert.rejects(request({}, 'pvpos_' + 'X'.repeat(43)), error => error.statusCode === 401);
      for (const payload of ['PVK-CCCC-4444', 'PVK-DDDD-5555']) {
        await assert.rejects(request({ payload }), error => error.statusCode === 404);
      }
    });
    await t.test('old callers keep the exact small response and the wallet opt-in must be boolean', async () => {
      assert.deepEqual(await request({ includeWallet: false }), { client: { id: '1', firstName: 'Guest' } });
      await assert.rejects(request({ includeWallet: 'true' }), error => error.statusCode === 400);
      const old = createPosDeviceService(pool, config);
      assert.deepEqual(await old.resolve('Device ' + issued.deviceToken, { payload: 'PVK-AAAA-2222' }), {
        client: { id: '1', firstName: 'Guest' }
      });
      await assert.rejects(old.resolve('Device ' + issued.deviceToken, { payload: 'PVK-AAAA-2222', includeWallet: true }),
        error => error.statusCode === 503 && error.code === 'pos_wallet_unavailable');
    });
    await t.test('the serving app supplies its existing unlimited policy', async () => {
      await db.query('UPDATE users SET unlimited_bonus=TRUE WHERE id=1');
      assert.equal((await request()).wallet.balance, policy.unlimitedBalance);
      assert.equal((await request()).wallet.unlimited, true);
      await db.query('UPDATE users SET unlimited_bonus=FALSE WHERE id=1');
    });
    await t.test('missing or invalid balances are unavailable instead of a fabricated zero', async () => {
      for (const amount of [-1, '9007199254740992']) {
        await db.query('UPDATE wallets SET balance=$1 WHERE user_id=1', [amount]);
        await assert.rejects(request(), error => error.statusCode === 503);
      }
      await db.query('DELETE FROM wallets WHERE user_id=1');
      await assert.rejects(request(), error => error.statusCode === 503);
      await db.query('INSERT INTO wallets VALUES(1,123)');
    });
    await t.test('revocation and disabled-store checks still precede wallet reads', async () => {
      await db.query("UPDATE pos_store_bindings SET enabled=FALSE WHERE store_id='bar'");
      await assert.rejects(request(), error => error.statusCode === 401);
      await db.query("UPDATE pos_store_bindings SET enabled=TRUE WHERE store_id='bar'");
      await devices.revoke(owner, { id: issued.id, storeId: 'bar' });
      await assert.rejects(request(), error => error.statusCode === 401);
    });
    assert.deepEqual(await financial(), before, 'wallet reads never reserve, spend, accrue or change a transaction');
  } finally { await db.close(); }
});
