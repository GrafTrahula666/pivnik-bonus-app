import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPosDeviceService } from '../pos/devices.js';
import { applyEvotorMigrations, setupEvotorStore } from '../pos/setup.js';

const config = { enabled: true, token: 'fixture-provider-only', storeId: 'store-1' };
const failsWith = (code) => (error) => error.code === code;

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,telegram_id BIGINT,first_name TEXT,role TEXT DEFAULT 'client',
      qr_token TEXT,qr_short_code TEXT,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
    CREATE TABLE qr_aliases(qr_token TEXT,qr_short_code TEXT,user_id BIGINT,source_user_id BIGINT);
    CREATE TABLE transactions(id BIGSERIAL PRIMARY KEY);
    INSERT INTO users(id,telegram_id,first_name,role,qr_short_code) VALUES
      (1,101,'Client','client','PVK-AAAA-2222'),(3,303,'Owner','admin',NULL);`);
  const pool = { query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) };
  const resolve = (token) => createPosDeviceService(pool, config).resolve('Device ' + token, { payload: 'PVK-AAAA-2222' });
  return { db, pool, resolve, migrate: () => applyEvotorMigrations((sql) => db.exec(sql)), close: () => db.close() };
}

test('setup refuses to run before migrations 012-014 and they can be applied twice', async () => {
  const f = await fixture();
  try {
    await assert.rejects(setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '3' }), failsWith('schema_required'));
    await f.migrate();
    await f.migrate();
    const plan = await setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '3' });
    assert.deepEqual(plan, { storeId: 'store-1', tenantId: 'pivnik', locationId: 'store-1', externalDeviceId: 'kassa-1',
      adminUserId: '3', bindingExists: false, activeKeys: 0, apply: false });
    assert.equal((await f.db.query('SELECT * FROM pos_store_bindings')).rows.length, 0, 'check-only writes nothing');
  } finally { await f.close(); }
});

test('apply connects the store and issues a working till key once', async () => {
  const f = await fixture();
  try {
    await f.migrate();
    const result = await setupEvotorStore(f.pool, { storeId: 'store-1', adminTelegramId: '303', apply: true });
    assert.match(result.deviceToken, /^pvpos_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual((await f.resolve(result.deviceToken)).client, { id: '1', firstName: 'Client' });
    assert.deepEqual((await f.db.query('SELECT enabled FROM pos_store_bindings')).rows, [{ enabled: true }]);
    assert.deepEqual((await f.db.query('SELECT user_id,can_manage FROM pos_operator_access')).rows, [{ user_id: 3, can_manage: true }]);
    assert.equal((await f.db.query('SELECT token_hash FROM pos_devices')).rows[0].token_hash.includes(result.deviceToken), false);

    await assert.rejects(setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '3', apply: true }), failsWith('pos_already_issued'));
    const again = await setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '3', apply: true, reissue: true });
    assert.equal(again.revokedKeys, 1);
    await assert.rejects(f.resolve(result.deviceToken), (error) => error.statusCode === 401);
    assert.equal((await f.resolve(again.deviceToken)).client.id, '1');
    assert.deepEqual((await f.db.query('SELECT action FROM pos_device_audit ORDER BY id')).rows.map((row) => row.action),
      ['issued', 'revoked', 'issued']);
  } finally { await f.close(); }
});

test('only one active admin can run setup, and an existing mapping is kept', async () => {
  const f = await fixture();
  try {
    await f.migrate();
    await assert.rejects(setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '1', apply: true }), failsWith('admin_required'));
    await assert.rejects(setupEvotorStore(f.pool, { storeId: 'store-1', apply: true }), failsWith('admin_required'));
    await f.db.exec("INSERT INTO pos_store_bindings VALUES('store-1','tenant-a','venue-a',FALSE)");
    const result = await setupEvotorStore(f.pool, { storeId: 'store-1', adminUserId: '3', tenantId: 'other', apply: true });
    assert.equal(result.tenantId, 'tenant-a');
    assert.deepEqual((await f.db.query('SELECT tenant_id,location_id,enabled FROM pos_store_bindings')).rows,
      [{ tenant_id: 'tenant-a', location_id: 'venue-a', enabled: true }]);
  } finally { await f.close(); }
});
