// Disposable proof only: no production server import, connection or route enablement.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { signSession, verifySession, effectiveRoleForAuthenticatedIdentity } from '../platform-core.js';
import { createMembershipAuthorizationResolver } from '../authorization-membership.js';
import { createSqlMembershipRepository } from '../authorization-membership-repository.js';

const MAIN = '18a0fa4e5d911952a7993c432a6e7fc50de9e8c5';
const DRAFT = 'e2c5e522bac74a4567f7cc47052c0f1b28abf320';
const root = new URL('../', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const temp = await mkdtemp(join(tmpdir(), 'customer360-proof-'));
const db = new PGlite();
const servers = [];
try {
  for (const file of ['platform-core.js','authorization-membership.js','authorization-membership-repository.js','authorization-context.js']) {
    assert.equal(await readFile(new URL(file,root),'utf8'),git('show',`${MAIN}:${file}`).toString(),`Main pin mismatch: ${file}`);
  }
  // Exact pinned draft archive; no patch scripts or foreign commits enter this branch.
  execFileSync('tar', ['-x', '-C', temp], { input: git('archive', DRAFT), maxBuffer: 32 * 1024 * 1024 });
  const { mountCustomer360ReadEndpoint } = await import(pathToFileURL(join(temp, 'customer-360-read-endpoint.js')));
  const source = git('show', `${MAIN}:server.js`).toString();
  const gateway = git('show', `${MAIN}:universal-server.js`).toString();
  function extract(text, start, end) {
    const a = text.indexOf(start), b = text.indexOf(end, a);
    assert.ok(a >= 0 && b > a, `Missing source anchors: ${start}`);
    return text.slice(a, b);
  }
  const fixture = await readFile(join(temp, 'test/spaceverse-read-boundaries.integration.test.js'), 'utf8');
  await db.exec(fixture.match(/await db.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(await readFile(join(temp, 'migrations/009_spaceverse_tenant_attribution.sql'), 'utf8'));
  await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,username TEXT,first_name TEXT,last_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),photo_url TEXT,profile_frame TEXT,deleted_at TIMESTAMPTZ,
    merged_into_user_id BIGINT,session_version INTEGER DEFAULT 1,role TEXT DEFAULT 'client',
    terms_accepted_at TIMESTAMPTZ DEFAULT NOW(),terms_version TEXT DEFAULT 'fixture');
    CREATE TABLE user_identities(user_id BIGINT,provider TEXT,provider_user_id TEXT);
    CREATE TABLE spaceverse_memberships(user_id BIGINT,tenant_id TEXT,location_id TEXT,role TEXT,revoked_at TIMESTAMPTZ);
    CREATE TABLE wallets(user_id BIGINT PRIMARY KEY,balance BIGINT);
    CREATE TABLE audit_log(id BIGINT PRIMARY KEY,actor_id BIGINT,reason TEXT);
    INSERT INTO users(id,username) VALUES(1,'customer'),(2,'foreign'),(101,'owner'),(102,'staff'),(103,'nonmember'),(104,'legacyadmin');
    UPDATE users SET role='admin' WHERE id=104;
    INSERT INTO user_identities SELECT id,p.provider,id::text FROM users CROSS JOIN (VALUES('telegram'),('vk')) p(provider);
    INSERT INTO spaceverse_memberships VALUES(101,'a',NULL,'owner',NULL),(102,'a','x','staff',NULL),(103,'a',NULL,'owner',NOW());
    INSERT INTO wallets VALUES(1,9999),(2,8888); INSERT INTO audit_log VALUES(1,101,'fixture');
    UPDATE transactions SET status='cancelled' WHERE request_key='ay';
    INSERT INTO transactions(client_id,tenant_id,location_id,request_key) VALUES(2,'b','x','foreign-only');`);
  const tables = ['users','user_identities','spaceverse_memberships','transactions','wallets','audit_log'];
  const snapshot = async () => JSON.stringify(await Promise.all(tables.map(async table =>
    (await db.query(`SELECT row_to_json(t)::text AS row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows)));
  await db.query('UPDATE users SET terms_accepted_at=$1 WHERE id=101',[new Date(0)]);
  const before = await snapshot();
  const cardQueries = [];
  const readOnly = async (sql, params) => {
    assert.match(sql, /^\s*SELECT/); assert.doesNotMatch(sql, /FOR UPDATE|\b(INSERT|UPDATE|DELETE)\b/);
    return db.query(sql, params);
  };
  let failCardDb = false;
  const cardDb = { query: async (sql, params) => {
    cardQueries.push(sql);
    if (failCardDb) throw new Error('fixture repository unavailable');
    return readOnly(sql, params);
  } };
  const pool = { query: async (sql, params) => {
    const result = await readOnly(sql, params);
    return { ...result, rowCount: result.rows.length };
  } };
  const secret = 'synthetic-local-proof-secret';
  const verify = token => verifySession(token, secret);
  const getProfile = async id => (await readOnly('SELECT id::text AS id,role FROM users WHERE id=$1', [id])).rows[0];
  const auth = Function('verifySession','pool','getProfile','effectiveRoleForAuthenticatedIdentity','ownerTelegramId','ownerVkId',
    extract(source, 'async function authRequired(', '\nfunction requireRole(') + ';return authRequired;')(
      verify,pool,getProfile,effectiveRoleForAuthenticatedIdentity,'no-owner-tg','no-owner-vk');
  const [canonicalize, requireUser] = Function('verifySession','pool','effectiveRoleForAuthenticatedIdentity','ownerTelegramId','ownerVkId','TERMS_VERSION',
    extract(gateway, 'async function canonicalizeSessionToken(', '\nasync function ensurePersonalQr(') + ';return [canonicalizeSessionToken,requireGatewayUser];')(
      verify,pool,effectiveRoleForAuthenticatedIdentity,'no-owner-tg','no-owner-vk','fixture');
  const sendJson = Function(extract(gateway, 'function sendJson(', '\nasync function proxyRequest(') + ';return sendJson;')();
  const resolver = createMembershipAuthorizationResolver({ loadMemberships: createSqlMembershipRepository({ query: readOnly }) });
  const app = express();
  app.use('/api/spaceverse', auth);
  assert.equal(mountCustomer360ReadEndpoint({ scopedModeEnabled: false }).mounted, false);
  mountCustomer360ReadEndpoint({ app, scopedModeEnabled: true, resolveAuthorization: resolver, db: cardDb });
  app.use((error,req,res,next) => res.status(500).json({ error: 'fixture unavailable' }));
  const child = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  servers.push(child);
  const proxy = Function('childReady','sendJson','readRequestBody','canonicalizeSessionToken','internalPort','http',
    extract(gateway, 'async function proxyRequest(', '\nexport async function renderAppIndex(') + ';return proxyRequest;')(
      true,sendJson,() => { throw new Error('GET-only proof'); },canonicalize,child.address().port,http);
  // The complete pinned gateway request callback, including original branch order.
  const mutationGuard = Function('mutationOriginAllowed', extract(gateway, 'function enforceMutationOrigin(', '\nfunction safeText(') + ';return enforceMutationOrigin;')(() => { throw new Error('Unexpected mutation'); });
  const documentSelector = Function('configuredDocumentPlatform','EXPECTED_VK_APP_ID','hasVkEmbedSource',extract(gateway, 'export function platformForDocumentRequest(', '\nasync function serveFile(').replace('export function','function') + ';return platformForDocumentRequest;')('telegram','fixture',() => { throw new Error('Unexpected document route'); });
  const consentExempt = Function(extract(gateway, 'function isConsentExempt(', '\nconst child =') + ';return isConsentExempt;')();
  const callback = extract(gateway, 'export const server = http.createServer(', '\nif (!isTestImport) {').slice('export const server = http.createServer('.length).trim().replace(/\);$/, '');
  let unavailable = false;
  const unavailableProxy = Function('childReady','sendJson','readRequestBody','canonicalizeSessionToken','internalPort','http',
    extract(gateway, 'async function proxyRequest(', '\nexport async function renderAppIndex(') + ';return proxyRequest;')(false,sendJson,() => {throw new Error('GET-only');},canonicalize,child.address().port,http);
  const router = Function('enforceMutationOrigin','platformForDocumentRequest','isConsentExempt','requireGatewayUser','proxyRequest','sendJson','console', 'return ('+callback+');')(
    mutationGuard, documentSelector, consentExempt, requireUser, (...args) => (unavailable?unavailableProxy:proxy)(...args),sendJson,{error:()=>{}});
  const front = http.createServer(router);
  await new Promise(resolve => front.listen(0,'127.0.0.1',resolve)); servers.push(front);
  const token = (id,platform='telegram',exp=Date.now()+60000) => signSession({uid:String(id),sv:1,pid:String(id),platform,exp},secret);
  const cases = [
    ['tg-own',101,'a',1,'',200],['vk-own',101,'a',1,'',200,'vk'],['repeat',101,'a',1,'',200],
    ['staff-location',102,'a',1,'?locationId=x',403],['owner-location',101,'a',1,'?locationId=x',200],['staff-foreign-location',102,'a',1,'?locationId=y',403],
    ['staff-tenant-wide',102,'a',1,'',403],['foreign-tenant',101,'b',1,'',403],
    ['revoked-membership',103,'a',1,'',403],['legacy-admin',104,'a',1,'',403],
    ['foreign-customer',101,'a',2,'',404],['invalid-id',101,'a','bad','',400],
    ['invalid-page',101,'a',1,'?limit=0',400],['page-one',101,'a',1,'?limit=1&offset=0',200],
    ['page-two',101,'a',1,'?limit=1&offset=1',200],['no-token',null,'a',1,'',401],
    ['invalid-signature',101,'a',1,'',401],['expired',101,'a',1,'',401],['db-error',101,'a',1,'',500],['terms-denied',101,'a',1,'',428],['child-unavailable',101,'a',1,'',503]
  ];
  const pageIds = [];
  for (const [name,id,tenant,customerId,query,expected,platform] of cases) {
    cardQueries.length=0; failCardDb=name==='db-error'; unavailable=name==='child-unavailable';
    await db.query('UPDATE users SET terms_accepted_at=$1 WHERE id=101',[name==='terms-denied'?null:new Date(0)]);
    let bearer=id===null?'':token(id,platform,name==='expired'?Date.now()-1:undefined);
    if(name==='invalid-signature') bearer+='x';
    const response=await fetch(`http://127.0.0.1:${front.address().port}/api/spaceverse/tenants/${tenant}/customers/${customerId}${query}`,
      {headers:bearer?{authorization:`Bearer ${bearer}`}:{}});
    const body=await response.json(); assert.equal(response.status,expected,name);
    if(expected===200) {
      assert.equal(body.customer.customerId,1); assert.equal(body.customer.financial.cashPaidCents,100);
      assert.equal(body.customer.identity.bonusBalance,null); assert.equal(body.customer.metadata,null);
      assert.equal(body.customer.timeline.rows.length,name==='owner-location'||name.startsWith('page-')?1:2);
      if(name.startsWith('page-')) pageIds.push(body.customer.timeline.rows[0].id);
    }
    if([401,403,428,503].includes(expected)||name==='invalid-id') assert.equal(cardQueries.length,0,name);
    if(name==='foreign-customer') { assert.equal(cardQueries.length,1); assert.doesNotMatch(cardQueries[0],/FROM users/); }
  }
  assert.notEqual(pageIds[0],pageIds[1]); assert.equal(await snapshot(),before);
  console.log(JSON.stringify({mainPin:MAIN,draftPin:DRAFT,httpCasesPassed:cases.length,allFixtureTablesUnchanged:true,
    engine:'PGlite',limits:'Complete extracted gateway request callback and its reachable original helpers; extracted auth/proxy, fixture Express endpoint and SQL repositories; synthetic tokens; minimal schema; injected SELECT profile; no complete internal Express app, process startup, provider, browser or production PostgreSQL proof.'},null,2));
} finally {
  for(const server of servers.reverse()) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await db.close(); await rm(temp,{recursive:true,force:true});
}
