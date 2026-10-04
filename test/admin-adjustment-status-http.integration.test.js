import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';
import { createSqlMembershipRepository } from '../authorization-membership-repository.js';
import { createMembershipAuthorizationResolver } from '../authorization-membership.js';
import { createAdminAdjustmentStatusReader } from '../admin-adjustment-status.js';
import { createAdminAdjustmentStatusHandler } from '../admin-adjustment-status-handler.js';

const command = { amount: 25, reason: 'HTTP fixture', requestKey: 'http-status-key' };
const secret = 'isolated-test-secret-never-production';
async function fixture(t, { enabled = true } = {}) {
  const db = new PGlite(); t.after(() => db.close());
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const table of ['users', 'wallets', 'transactions']) {
    const schema = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n      \\)`));
    assert.ok(schema); await db.exec(schema[0]);
  }
  for (const sql of source.match(/ALTER TABLE users ADD COLUMN IF NOT EXISTS (?:merged_into_user_id|session_version|deleted_at)[^'\n]*/g)) await db.exec(sql);
  await db.exec(await readFile(new URL('../migrations/009_spaceverse_tenant_attribution.sql', import.meta.url), 'utf8'));
  // Membership storage has a repository contract but no approved production
  // migration. This table is explicitly fixture DDL, not a shipped migration.
  await db.exec(`CREATE TABLE spaceverse_memberships(user_id BIGINT REFERENCES users(id), tenant_id TEXT NOT NULL,
    location_id TEXT, role TEXT NOT NULL, revoked_at TIMESTAMPTZ);
    INSERT INTO users(id,first_name,role) VALUES (10,'Owner','admin'),(11,'Foreign owner','admin'),
      (12,'Staff','staff'),(13,'Legacy admin','admin'),(14,'Platform fixture','admin'),(15,'Revoked owner','admin'),(20,'Client','client');
    INSERT INTO wallets(user_id,balance) VALUES(20,999);
    INSERT INTO spaceverse_memberships VALUES (10,'tenant-a',NULL,'owner',NULL),(11,'tenant-b',NULL,'owner',NULL),
      (12,'tenant-a','loc-a','staff',NULL),(15,'tenant-a',NULL,'owner',NOW());
    INSERT INTO transactions(request_key,client_id,staff_id,mode,status,bonus_earned,balance_after,reason,tenant_id,location_id)
    VALUES('http-status-key',20,10,'adjustment','completed',25,125,'HTTP fixture','tenant-a','loc-a');`);
  const calls = []; let outage = false;
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (outage && /FROM spaceverse_memberships/.test(sql)) throw Error('Fixture SQL outage');
    const r = await db.query(sql, params); return { ...r, rowCount: r.rows.length };
  };
  const resolver = createMembershipAuthorizationResolver({ loadMemberships: createSqlMembershipRepository({ query }) });
  const app = express(); app.use(express.json());
  const start = source.indexOf('async function authRequired('), end = source.indexOf('async function resolveActingStaff(', start);
  assert.ok(start >= 0 && end > start);
  const auth = new Function('pool','verifySession','getProfile','effectiveRoleForAuthenticatedIdentity','ownerTelegramId','ownerVkId',
    source.slice(start,end) + '\nreturn authRequired;')({ query }, token => verifySession(token,secret),
    async id => {
      const r = await db.query('SELECT id,role FROM users WHERE id=$1', [id]);
      return r.rows[0] ? { ...r.rows[0], id: String(r.rows[0].id), platformRole: String(id) === '14' ? 'platform_admin' : null } : null;
    }, effectiveRoleForAuthenticatedIdentity, null, null);
  app.post('/fixtures/tenants/:tenantId/locations/:locationId/clients/:clientId/status', auth,
    createAdminAdjustmentStatusHandler({ resolveAuthorization: resolver,
      readStatus: createAdminAdjustmentStatusReader({ query, scopedReadsEnabled: true }), scopedStatusEnabled: enabled }));
  app.use((error,req,res,next) => res.status(503).set('Cache-Control','private, no-store').json({ error: 'Fixture service unavailable' }));
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { db, calls, set outage(value) { outage = value; },
    async snapshot() { return { wallets:(await db.query('SELECT * FROM wallets')).rows,
      journal:(await db.query('SELECT * FROM transactions')).rows, memberships:(await db.query('SELECT * FROM spaceverse_memberships ORDER BY user_id')).rows }; },
    async check({ user='10', token, body=command, tenant='tenant-a', location='loc-a', client='20', headers={}, suffix='' }={}) {
      token ??= signSession({ uid:user, sv:1, platform:'telegram', exp:Date.now()+60_000 }, secret);
      const r = await fetch(`http://127.0.0.1:${server.address().port}/fixtures/tenants/${tenant}/locations/${location}/clients/${client}/status${suffix}`,
        { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${token}`, ...headers }, body:JSON.stringify(body) });
      return { status:r.status, body:await r.json(), cache:r.headers.get('cache-control') };
    }
  };
}

test('HTTP signed session + membership SQL + status SQL confirms repeat reads without writes', async t => {
  const h = await fixture(t), before = await h.snapshot();
  for (let n=0;n<2;n++) {
    const r = await h.check(); assert.equal(r.status,200); assert.equal(r.body.state,'confirmed');
    assert.equal(r.body.balanceAfter,125); assert.equal(r.body.canClearPending,true); assert.equal(r.cache,'private, no-store');
  }
  assert.deepEqual(await h.snapshot(),before);
  const membership = h.calls.filter(c => /FROM spaceverse_memberships/.test(c.sql));
  assert.equal(membership.length,2); for (const c of membership) assert.deepEqual(c.params,['10']);
  const status = h.calls.filter(c => /LIMIT 2/.test(c.sql));
  assert.equal(status.length,2); for (const c of status) assert.deepEqual(c.params,['tenant-a','loc-a','10','20','http-status-key']);
});

test('HTTP body/query/header claims cannot impersonate owner or tenant membership', async t => {
  const h = await fixture(t), before = await h.snapshot();
  const claims = { ...command, authenticatedActorId:'10', userId:'10', staffId:'10', tenantId:'tenant-a', platformRole:'platform_admin',
    authorizationContext:{ membershipRole:'owner', tenantId:'tenant-a' } };
  for (const user of ['11','12','13','15']) {
    const r = await h.check({ user,body:claims,suffix:'?userId=10&platformRole=platform_admin&tenantId=tenant-a',
      headers:{ 'x-user-id':'10','x-platform-role':'platform_admin','x-tenant-id':'tenant-a' } });
    assert.equal(r.status,403); assert.equal(r.body.canClearPending,undefined);
  }
  assert.equal(h.calls.filter(c=>/LIMIT 2/.test(c.sql)).length,0);
  assert.deepEqual(await h.snapshot(),before);
});

test('HTTP owner forged scope and platform admin forged actor cannot expose evidence', async t => {
  const h = await fixture(t), before = await h.snapshot();
  assert.equal((await h.check({ tenant:'tenant-b' })).status,403);
  const location = await h.check({ location:'loc-b' }); assert.equal(location.body.state,'unknown'); assert.equal(location.body.canClearPending,false);
  const platform = await h.check({ user:'14',body:{ ...command,authenticatedActorId:'10' } });
  assert.equal(platform.status,200); assert.equal(platform.body.state,'unknown'); assert.equal(platform.body.canClearPending,false);
  const target = await h.check({ client:'21',body:{...command,clientId:'20'} });
  assert.equal(target.body.state,'unknown'); assert.equal(target.body.canClearPending,false);
  assert.deepEqual(await h.snapshot(),before);
});

test('HTTP unsigned, tampered and stale sessions are rejected before membership/status SQL', async t => {
  const h = await fixture(t);
  for (const token of ['',signSession({ uid:'10',sv:1,exp:Date.now()+60_000 },'wrong-secret'),signSession({ uid:'10',sv:0,exp:Date.now()+60_000 },secret),signSession({ uid:'10',sv:1,exp:1 },secret)]) {
    h.calls.length=0; assert.equal((await h.check({ token })).status,401);
    assert.equal(h.calls.filter(c=>/FROM spaceverse_memberships|LIMIT 2/.test(c.sql)).length,0);
  }
});

test('HTTP invalid commands, semantic conflicts and membership outages never confirm', async t => {
  const h = await fixture(t), before = await h.snapshot();
  assert.equal((await h.check({ body:{...command,amount:0} })).status,400);
  assert.equal(h.calls.filter(c=>/LIMIT 2/.test(c.sql)).length,0);
  h.calls.length=0; assert.equal((await h.check({ tenant:'x'.repeat(161) })).status,400);
  assert.equal(h.calls.filter(c=>/FROM spaceverse_memberships|LIMIT 2/.test(c.sql)).length,0);
  const conflict=await h.check({ body:{...command,reason:'Different'} }); assert.equal(conflict.status,200); assert.equal(conflict.body.state,'conflict'); assert.equal(conflict.body.canClearPending,false);
  h.outage=true; const failure=await h.check(); assert.equal(failure.status,503); assert.equal(failure.body.canClearPending,undefined);
  assert.deepEqual(await h.snapshot(),before);
});

test('HTTP revocation is loaded afresh and cannot use a previously successful authorization', async t => {
  const h = await fixture(t); assert.equal((await h.check()).body.state,'confirmed');
  await h.db.exec('UPDATE spaceverse_memberships SET revoked_at=NOW() WHERE user_id=10');
  const before=await h.snapshot(); assert.equal((await h.check()).status,403);
  assert.deepEqual(await h.snapshot(),before);
});

test('HTTP adapter stays unavailable by default without querying memberships or journal', async t => {
  const h = await fixture(t,{enabled:false}); const r=await h.check();
  assert.equal(r.status,503); assert.equal(r.cache,'private, no-store');
  assert.equal(h.calls.filter(c=>/FROM spaceverse_memberships|LIMIT 2/.test(c.sql)).length,0);
});

test('HTTP missing membership storage fails closed without legacy-admin fallback', async t => {
  const h=await fixture(t), before=await h.snapshot();
  await h.db.exec('DROP TABLE spaceverse_memberships');
  const r=await h.check(); assert.equal(r.status,503); assert.equal(r.body.canClearPending,undefined);
  assert.equal(h.calls.filter(c=>/LIMIT 2/.test(c.sql)).length,0);
  assert.deepEqual((await h.db.query('SELECT * FROM wallets')).rows,before.wallets);
  assert.deepEqual((await h.db.query('SELECT * FROM transactions')).rows,before.journal);
});
