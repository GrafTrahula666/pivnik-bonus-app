import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Explicit diagnostic of existing unmerged code; never wired into startup/CI.
// Fetch the referenced branch/object first. No draft implementation is committed here.
const commit = 'e2c5e522bac74a4567f7cc47052c0f1b28abf320';
const root = new URL('../', import.meta.url);
function source(path) {
  return execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8' });
}
const temporary = await mkdtemp(join(tmpdir(), 'spaceverse-customer-scope-'));
const hashes = {}, loaded = new Set();
async function copyModule(path) {
  if (loaded.has(path)) return;
  assert.match(path, /^[a-z0-9-]+\.js$/);
  loaded.add(path);
  const code = source(path);
  hashes[path] = createHash('sha256').update(code).digest('hex');
  for (const match of code.matchAll(/from\s+['"]\.\/([a-z0-9-]+\.js)['"]/g)) await copyModule(match[1]);
  await writeFile(join(temporary, path), code);
}
let db;
try {
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
  await copyModule('customer-bonus-adjustment-runtime.js');
  const { createCustomerBonusAdjustmentRuntime } = await import(pathToFileURL(join(temporary, 'customer-bonus-adjustment-runtime.js')));
  const { createAuthorizationContext } = await import(pathToFileURL(join(temporary, 'authorization-context.js')));
  db = new PGlite();
  const server = source('server.js');
  for (const table of ['users', 'wallets', 'transactions']) {
    const ddl = server.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(ddl); await db.exec(ddl[0]);
  }
  await db.exec(source('migrations/009_spaceverse_tenant_attribution.sql'));
  await db.exec("INSERT INTO users(id,first_name,role) VALUES(10,'Owner A','admin'),(11,'Owner B','admin'),(20,'Shared client','client'); INSERT INTO wallets(user_id,balance) VALUES(20,999)");
  for (const tenant of ['tenant-a', 'tenant-b']) await db.query(
    `INSERT INTO transactions(request_key,client_id,staff_id,mode,status,bonus_earned,bonus_spent,balance_after,reason,tenant_id,location_id)
     VALUES($1,20,10,'accrue','completed',1,0,999,'Fixture history',$2,'location-a')`, [`history-${tenant}`, tenant]);
  const snapshot = async () => ({ users: (await db.query('SELECT * FROM users ORDER BY id')).rows,
    wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    journal: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
  const before = await snapshot(), commands = [], queries = [];
  const adapter = { query: async (sql, params) => { queries.push(sql); return db.query(sql, params); } };
  // Record delegation only: no financial executor, wallet mutation or provider send.
  const runtime = createCustomerBonusAdjustmentRuntime({ db: adapter, scopedReadsEnabled: true,
    executeAdjustment: async command => { commands.push(command); return { diagnosticDelegated: true }; } });
  const contextA = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
  const contextB = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-b' });
  const command = { context: contextA, tenantId: 'tenant-a', locationId: 'location-a',
    actorId: '10', customerId: '20', amount: 25, reason: 'Isolated proof', requestKey: 'diagnostic-key', confirmed: true };
  assert.equal(await runtime.readRepository.isCustomerVisible(adapter, 20, {
    authorizationContext: contextA, tenantId: 'tenant-a', locationId: 'location-a' }), true);
  assert.deepEqual(await runtime.adjust(command), { diagnosticDelegated: true });
  assert.deepEqual(await runtime.adjust({ ...command, context: contextB, tenantId: 'tenant-b', actorId: '11' }), { diagnosticDelegated: true });
  assert.equal(commands.length, 2); // Two tenants see history for the SAME global wallet.
  for (const status of ['pending', 'cancelled']) {
    await db.query('UPDATE transactions SET status=$1 WHERE tenant_id=$2', [status, 'tenant-a']);
    assert.deepEqual(await runtime.adjust(command), { diagnosticDelegated: true });
  }
  const delegated = commands.length;
  for (const patch of [{ customerId: '21' }, { locationId: 'foreign-location' }]) {
    await assert.rejects(runtime.adjust({ ...command, ...patch }), { code: 'customer_scope_denied' });
  }
  await assert.rejects(runtime.adjust({ ...command, context: contextB }), { code: 'scope_denied' });
  const staff = createAuthorizationContext({ membershipRole: 'staff', tenantId: 'tenant-a', locationId: 'location-a' });
  await assert.rejects(runtime.adjust({ ...command, context: staff }), { code: 'manager_required' });
  await assert.rejects(runtime.adjust({ ...command, amount: 0 }), TypeError);
  await assert.rejects(runtime.adjust({ ...command, confirmed: false }), { code: 'confirmation_required' });
  assert.equal(commands.length, delegated);
  const defaultDisabled = createCustomerBonusAdjustmentRuntime({ db: adapter,
    executeAdjustment: async () => { throw Error('must not delegate'); } });
  await assert.rejects(defaultDisabled.adjust(command), { code: 'TRANSACTION_READ_SCOPE_MIGRATION_GATED' });
  const outage = Error('isolated SQL outage');
  const failed = createCustomerBonusAdjustmentRuntime({ db: { query: async () => { throw outage; } },
    scopedReadsEnabled: true, executeAdjustment: async () => { throw Error('must not delegate'); } });
  await assert.rejects(failed.adjust(command), error => error === outage);
  // Restore only our deliberately changed fixture state before snapshot comparison.
  await db.exec("UPDATE transactions SET status='completed'");
  assert.deepEqual(await snapshot(), before);
  assert.ok(queries.every(sql => /^\s*SELECT\b/i.test(sql)));
  console.log(JSON.stringify({ commit, hashes, checks: 13, delegatedCommands: delegated,
    evidence: 'transaction visibility is not authoritative global wallet ownership',
    financialExecutionVerified: false, productionActivationApproved: false, snapshotsUnchanged: true }, null, 2));
} finally {
  if (db) await db.close();
  await rm(temporary, { recursive: true, force: true });
}
