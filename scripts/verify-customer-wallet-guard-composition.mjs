import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createCustomerWalletAdjustmentGuard } from '../customer-wallet-adjustment-guard.js';
import { PGlite } from '@electric-sql/pglite';

// Explicit diagnostic of existing unmerged code; never wired into startup/CI.
// Fetch the referenced branch/object first. No draft implementation is committed here.
const commit = 'e2c5e522bac74a4567f7cc47052c0f1b28abf320';
const root = new URL('../', import.meta.url);
function source(path) {
  return execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8' });
}
const temporary = await mkdtemp(join(tmpdir(), 'spaceverse-wallet-composition-'));
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
const checks = [];
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
  // Diagnostic fixture only; not a proposed production ownership schema.
  await db.exec(`CREATE TABLE fixture_wallet_binding(customer_id BIGINT, tenant_id TEXT, location_id TEXT, revoked BOOLEAN NOT NULL DEFAULT false);
    INSERT INTO fixture_wallet_binding VALUES(20,'tenant-a','location-a',false)`);
  for (const tenant of ['tenant-a', 'tenant-b']) await db.query(
    `INSERT INTO transactions(request_key,client_id,staff_id,mode,status,bonus_earned,bonus_spent,balance_after,reason,tenant_id,location_id)
     VALUES($1,20,10,'accrue','completed',1,0,999,'Fixture history',$2,'location-a')`, [`history-${tenant}`, tenant]);
  const adapter = { query: (sql, params) => db.query(sql, params) };
  const snapshot = async () => ({ wallets: (await db.query('SELECT * FROM wallets ORDER BY user_id')).rows,
    journal: (await db.query('SELECT * FROM transactions ORDER BY id')).rows });
  let transactions = 0, executions = 0, authorityOutage = false, journalOutage = false;
  const runInTransaction = async callback => {
    transactions++; await db.exec('BEGIN');
    try { const result = await callback(adapter); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  const assertWalletOwned = async (tx, c) => {
    if (authorityOutage) throw Error('fixture authority outage');
    const result = await tx.query(`SELECT 1 FROM fixture_wallet_binding WHERE customer_id=$1 AND tenant_id=$2
      AND location_id=$3 AND revoked=false FOR UPDATE`, [c.customerId, c.tenantId, c.locationId]);
    return result.rows.length === 1;
  };
  // Deliberately simple fixture executor, NOT the main HTTP financial executor.
  // Duplicate journal keys fail and roll back; this is not successful replay.
  const executeAdjustment = async (tx, c) => {
    executions++;
    const result = await tx.query('UPDATE wallets SET balance=balance+$1 WHERE user_id=$2 RETURNING balance', [c.amount,c.customerId]);
    assert.equal(result.rows.length, 1);
    if (journalOutage) await tx.query('INSERT INTO fixture_missing_journal VALUES(1)');
    await tx.query(`INSERT INTO transactions(request_key,client_id,staff_id,mode,status,bonus_earned,bonus_spent,
      balance_after,reason,tenant_id,location_id) VALUES($1,$2,$3,'adjustment','completed',$4,$5,$6,$7,$8,$9)`,
      [c.requestKey,c.customerId,c.actorId,Math.max(c.amount,0),Math.max(-c.amount,0),result.rows[0].balance,c.reason,c.tenantId,c.locationId]);
    return { balance: result.rows[0].balance, requestKey: c.requestKey };
  };
  const makeRuntime = (enabled = false) => createCustomerBonusAdjustmentRuntime({ db: adapter, scopedReadsEnabled: true,
    executeAdjustment: createCustomerWalletAdjustmentGuard({ runInTransaction, assertWalletOwned, executeAdjustment, walletBindingEnabled: enabled }) });
  const contextA = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-a' });
  const contextB = createAuthorizationContext({ membershipRole: 'owner', tenantId: 'tenant-b' });
  const command = { context: contextA, tenantId: 'tenant-a', locationId: 'location-a', actorId: '10',
    customerId: '20', amount: 25, reason: 'Isolated composition', requestKey: 'composition-credit', confirmed: true };
  const runtime = makeRuntime(true);
  for (const [context,tenantId] of [[contextA,'tenant-a'],[contextB,'tenant-b']]) {
    assert.equal(await runtime.readRepository.isCustomerVisible(adapter, 20, { authorizationContext: context, tenantId, locationId: 'location-a' }), true);
  }
  checks.push('both tenants see the same customer history');
  const rejectedWithoutChange = async (input, error, target = runtime) => {
    const before = await snapshot(); await assert.rejects(target.adjust(input), error); assert.deepEqual(await snapshot(), before);
  };
  await rejectedWithoutChange(command, { code: 'WALLET_BINDING_UNAVAILABLE' }, makeRuntime());
  assert.equal(transactions,0); checks.push('default gate denies visible customer before transaction');
  await rejectedWithoutChange({ ...command, context: contextB, tenantId: 'tenant-b', actorId: '11' }, { code: 'WALLET_SCOPE_DENIED' });
  assert.equal(executions,0); checks.push('visible customer in other tenant does not authorize wallet');
  for (const [patch,error,label] of [
    [{ customerId:'21' },{code:'customer_scope_denied'},'foreign customer'],
    [{ locationId:'foreign-location' },{code:'customer_scope_denied'},'foreign location'],
    [{ context:contextB },{code:'scope_denied'},'mismatched owner scope'],
    [{ context:createAuthorizationContext({membershipRole:'staff',tenantId:'tenant-a',locationId:'location-a'}) },{code:'manager_required'},'staff rights'],
    [{ amount:0 },TypeError,'zero amount'],
    [{ confirmed:false },{code:'confirmation_required'},'missing confirmation'],
    [{ requestKey:'bad' },TypeError,'invalid original key'],
    [{ reason:' ' },{code:'reason_required'},'missing reason']
  ]) {
    const count = transactions;
    await rejectedWithoutChange({...command,...patch},error); assert.equal(transactions,count); checks.push(label+' denied before transaction');
  }
  assert.deepEqual(await runtime.adjust(command),{balance:1024,requestKey:command.requestKey}); checks.push('owned fixture credit commits');
  await rejectedWithoutChange(command,{code:'23505'}); checks.push('repeated original key rolls back wallet and journal');
  assert.deepEqual(await runtime.adjust({...command,amount:-10,requestKey:'composition-debit'}),{balance:1014,requestKey:'composition-debit'}); checks.push('owned fixture debit commits');
  await db.exec('UPDATE fixture_wallet_binding SET revoked=true');
  for (const requestKey of [command.requestKey,'composition-revoked']) {
    const count=executions; await rejectedWithoutChange({...command,requestKey},{code:'WALLET_SCOPE_DENIED'}); assert.equal(executions,count);
  }
  checks.push('revocation denies both repeated and new keys despite history');
  await db.exec('UPDATE fixture_wallet_binding SET revoked=false');
  authorityOutage=true;
  await rejectedWithoutChange({...command,requestKey:'composition-authority-outage'},/fixture authority outage/);
  authorityOutage=false; checks.push('authority outage leaves wallet and journal unchanged');
  journalOutage=true;
  await rejectedWithoutChange({...command,requestKey:'composition-journal-outage'},{code:'42P01'});
  journalOutage=false; checks.push('journal SQL failure rolls back wallet update');
  for (const status of ['pending','cancelled']) {
    await db.query('UPDATE transactions SET status=$1 WHERE request_key=$2',[status,'history-tenant-b']);
    await rejectedWithoutChange({...command,context:contextB,tenantId:'tenant-b',actorId:'11'},{code:'WALLET_SCOPE_DENIED'});
  }
  checks.push('pending or cancelled history cannot substitute wallet authority');
  console.log(JSON.stringify({ commit, hashes, checks, checkCount:checks.length, fixtureBalance:1014,
    customer360CompositionVerified:true, fixtureFinancialExecutionVerified:true, mainFinancialExecutorVerified:false,
    authenticatedActorVerified:false, productionActivationApproved:false, independentConcurrentPostgresVerified:false },null,2));
} finally {
  if (db) await db.close();
  await rm(temporary,{recursive:true,force:true});
}
