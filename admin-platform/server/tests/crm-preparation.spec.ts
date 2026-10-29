// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest'
import {config} from '../config.js'
import {seedOnboardingFixture,fixturePassword} from './onboarding-fixture.js'
import {tenantCrmFixtureDatabase,type TenantCrmFixtureDatabase} from './tenant-crm-database-fixture.js'

const state=vi.hoisted(()=>({db:null as TenantCrmFixtureDatabase|null,failAudit:'',tail:Promise.resolve()}))
vi.mock('../db.js',()=>{
 const execute=async(db:Pick<TenantCrmFixtureDatabase,'query'>,sql:string,params?:unknown[])=>{
  if(state.failAudit&&params?.[4]===state.failAudit&&sql.startsWith('INSERT INTO admin_audit_log'))throw new Error('Synthetic audit failure')
  const r=await db.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}
 }
 const query=(sql:string,params?:unknown[])=>execute(state.db!,sql,params)
 const pool={query,connect:async()=>{
  if(state.db!.connect){const c=await state.db!.connect();return {query:(sql:string,p?:unknown[])=>execute(c,sql,p),release:()=>c.release()}}
  // PGlite is one connection; native PG above exercises actual row locks.
  const before=state.tail;let release!:()=>void;state.tail=new Promise<void>(resolve=>{release=resolve});await before
  return {query,release}
 }}
 return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})

describe('standalone CRM metadata preparation through signed HTTP and canonical SQL',()=>{
 let server:http.Server,origin=''
 const sessions=new Map<string,{cookie:string;csrf:string}>()
 const data=(name='Новое кафе',companyId='10')=>({companyId,companyName:'',venueName:name,address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''})
 async function call(who:string|null,method:string,path:string,body?:unknown,headers:Record<string,string>={}){
  const session=who?sessions.get(who):null
  return fetch(origin+path,{method,headers:{origin:config.publicOrigin,'content-type':'application/json',
   ...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})})
 }
 async function draft(who='owner',name='Новое кафе',companyId='10'){
  const response=await call(who,'POST','/api/admin/onboarding/drafts',{requestKey:crypto.randomUUID(),data:data(name,companyId)})
  expect(response.status).toBe(200);return response.json()
 }
 const path=(id:string)=>'/api/admin/onboarding/drafts/'+id+'/crm/prepare'
 const prepare=(id:string,who='owner',revision=1)=>call(who,'POST',path(id),{draftRevision:revision})
 const count=async(table:string,id:string)=>Number((await state.db!.query<{n:string}>(`SELECT COUNT(*)::text AS n FROM ${table} WHERE draft_id=$1`,[id])).rows[0]!.n)
 beforeAll(async()=>{
  expect(config.enableCrmOnboarding).toBe(false)
  config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=config.enableCrmOnboarding=true
  config.publicOrigin='https://crm-preparation.fixture.invalid';config.csrfSecret='fixture-only-crm-preparation-secret-123456789'
  state.db=await seedOnboardingFixture(await tenantCrmFixtureDatabase())
  const password=(await state.db.query<{password_hash:string}>('SELECT password_hash FROM admin_accounts WHERE id=11')).rows[0]!.password_hash
  await state.db.query("INSERT INTO admin_accounts(id,email,display_name,role,password_hash) VALUES(31,'network-owner@fixture.invalid','Network owner','VENUE_ADMIN',$1)",[password])
  await state.db.exec("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(31,10,'owner'),(31,20,'owner'); SELECT setval('admin_accounts_id_seq',31)")
  const {handleApi,sendApiError}=await import('../router.js')
  server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port
  for(const who of ['root','owner','network-owner','trusted']){
   const response=await call(null,'POST','/api/admin/auth/login',{email:who+'@fixture.invalid',password:fixturePassword});expect(response.status).toBe(200)
   sessions.set(who,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:(await response.json()).csrfToken})
  }
 },30_000)
 afterEach(async()=>{
  state.failAudit='';config.enableWrites=config.enableOnboardingDrafts=config.enableCrmOnboarding=true
  const {__resetRateLimitBucketsForTests}=await import('../security.js');__resetRateLimitBucketsForTests()
 })
 afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await state.db!.close()})

 it('is default-off and requires all write gates before changing metadata',async()=>{
  const d=await draft()
  for(const flag of ['enableWrites','enableOnboardingDrafts','enableCrmOnboarding'] as const){
   config[flag]=false;expect((await prepare(d.id)).status).toBe(403);config[flag]=true
  }
  expect(await count('admin_onboarding_app_configs',d.id)).toBe(0);expect(await count('admin_onboarding_scopes',d.id)).toBe(0)
 })
 it('prepares CRM without browser app settings, using the same tenant key and an inactive canonical venue',async()=>{
  const d=await draft(),wallets=(await state.db!.query('SELECT * FROM wallets')).rows
  const response=await prepare(d.id);expect(response.status).toBe(200);const result=await response.json()
  expect(result).toMatchObject({draftId:d.id,company:{id:'10'},venue:{active:false},source:{draftRevision:1,applicationRevision:1},
   contract:{status:'prepared',runtimeStatus:'not_provisioned',venueActive:false,providerConnectionsCreated:false,staffAccessGranted:false}})
  const app=(await state.db!.query<{tenant_key:string;config:unknown}>('SELECT tenant_key,config FROM admin_onboarding_app_configs WHERE draft_id=$1',[d.id])).rows[0]!
  expect(app).toMatchObject({tenant_key:'sv-'+d.id.replaceAll('-',''),config:{displayName:'Новое кафе',shopEnabled:false,loyaltyEnabled:true}})
  expect(result.runtimeManifest.scope).toEqual({companyId:'10',venueId:result.venue.id})
  expect((await state.db!.query('SELECT * FROM wallets')).rows).toEqual(wallets)
  expect(await count('admin_onboarding_integrations',d.id)).toBe(0);expect(await count('admin_onboarding_provisioning_steps',d.id)).toBe(0)
 })
 it('replays a lost response and concurrent identical commands without another venue or audit',async()=>{
  const d=await draft(),responses=await Promise.all([prepare(d.id),prepare(d.id)])
  expect(responses.map(row=>row.status)).toEqual([200,200]);const first=await responses[0]!.json();expect(await responses[1]!.json()).toEqual(first)
  expect(await (await prepare(d.id)).json()).toEqual(first)
  expect(await count('admin_onboarding_app_configs',d.id)).toBe(1);expect(await count('admin_onboarding_scopes',d.id)).toBe(1)
  const audit=await state.db!.query<{action:string}>('SELECT action FROM admin_audit_log WHERE entity_id=$1 ORDER BY id',[d.id])
  expect(audit.rows.map(row=>row.action)).toEqual(['onboarding.draft_create','onboarding.app_config_create','onboarding.scope_prepare'])
 })
 it('lets a regular network owner prepare two stores of one company and a store of another owned company',async()=>{
  const ids:string[]=[]
  for(const company of ['10','10','20']){
   const d=await draft('network-owner','Сеть '+company,company),response=await prepare(d.id,'network-owner');expect(response.status).toBe(200)
   const scope=await response.json();expect(scope.company.id).toBe(company);ids.push(scope.venue.id)
  }
  expect(new Set(ids).size).toBe(3)
  const forbidden=await draft('root','Чужое заведение','20');expect((await prepare(forbidden.id)).status).toBe(404)
 })
 it('denies missing authentication, invalid CSRF/origin, unsupported methods and scope-bearing URL/body',async()=>{
  const d=await draft()
  expect((await call(null,'POST',path(d.id),{draftRevision:1})).status).toBe(401)
  expect((await call('owner','POST',path(d.id),{draftRevision:1},{'x-csrf-token':''})).status).toBe(403)
  expect((await call('owner','POST',path(d.id),{draftRevision:1},{origin:'https://other.invalid'})).status).toBe(403)
  expect((await call('owner','GET',path(d.id))).status).toBe(405)
  expect((await call('owner','POST',path(d.id)+'?companyId=20',{draftRevision:1})).status).toBe(400)
  for(const body of [{},{draftRevision:0},{draftRevision:1.5},{draftRevision:1,companyId:'20'},{draftRevision:1,config:{}},{draftRevision:1,applicationRevision:1},[]])
   expect((await call('owner','POST',path(d.id),body)).status).toBe(400)
  expect(await count('admin_onboarding_app_configs',d.id)).toBe(0)
 })
 it('does not overwrite an existing canonical application configuration',async()=>{
  const d=await draft(),config={displayName:'Сохранённая настройка',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:true,loyaltyEnabled:false}
  expect((await call('owner','PUT','/api/admin/onboarding/drafts/'+d.id+'/application',{revision:0,config})).status).toBe(200)
  const before=(await state.db!.query('SELECT * FROM admin_onboarding_app_configs WHERE draft_id=$1',[d.id])).rows
  expect((await prepare(d.id)).status).toBe(200)
  expect((await state.db!.query('SELECT * FROM admin_onboarding_app_configs WHERE draft_id=$1',[d.id])).rows).toEqual(before)
 })
 it('rejects stale draft revisions and rolls back both configuration and scope when auditing fails',async()=>{
  const d=await draft()
  expect((await prepare(d.id,'owner',2)).status).toBe(409);expect(await count('admin_onboarding_app_configs',d.id)).toBe(0)
  const before=(await state.db!.query('SELECT COUNT(*)::text AS n FROM venues')).rows
  for(const action of ['onboarding.app_config_create','onboarding.scope_prepare']){
   state.failAudit=action;expect((await prepare(d.id)).status).toBe(503);state.failAudit=''
   expect(await count('admin_onboarding_app_configs',d.id)).toBe(0);expect(await count('admin_onboarding_scopes',d.id)).toBe(0)
   expect((await state.db!.query('SELECT COUNT(*)::text AS n FROM venues')).rows).toEqual(before)
  }
  expect((await prepare(d.id)).status).toBe(200)
 })
 it('keeps viewer invitations read-only and prevents revoked invitations from preparing CRM',async()=>{
  const d=await draft(),id=crypto.randomUUID()
  await state.db!.query(`INSERT INTO admin_onboarding_invites(id,draft_id,token_hash,created_by_admin_id,expires_at) VALUES($1,$2,$3,11,NOW()+INTERVAL '1 day')`,[id,d.id,'c'.repeat(64)])
  await state.db!.query(`INSERT INTO admin_onboarding_access(invitation_id,admin_id,company_id,draft_id,role) VALUES($1,12,10,$2,'viewer')`,[id,d.id])
  expect((await prepare(d.id,'trusted')).status).toBe(403)
  await state.db!.query("UPDATE admin_onboarding_access SET role='manager' WHERE invitation_id=$1",[id])
  expect((await prepare(d.id,'trusted')).status).toBe(200)
  const other=await draft();expect((await prepare(other.id,'trusted')).status).toBe(404)
  await state.db!.query('UPDATE admin_onboarding_access SET revoked_at=NOW() WHERE invitation_id=$1',[id])
  expect((await prepare(d.id,'trusted')).status).toBe(403)
  expect(await count('admin_onboarding_scopes',d.id)).toBe(1)
 })
 it('rolls back a new inactive company as well as its venue and profile on scope audit failure',async()=>{
  const response=await call('root','POST','/api/admin/onboarding/drafts',{requestKey:crypto.randomUUID(),data:{...data(),companyId:null,companyName:'Новая организация'}})
  expect(response.status).toBe(200);const d=await response.json()
  const before=(await state.db!.query('SELECT COUNT(*)::text AS n FROM companies')).rows
  state.failAudit='onboarding.scope_prepare';expect((await prepare(d.id,'root')).status).toBe(503);state.failAudit=''
  expect((await state.db!.query('SELECT COUNT(*)::text AS n FROM companies')).rows).toEqual(before)
  expect(await count('admin_onboarding_app_configs',d.id)).toBe(0);expect(await count('admin_onboarding_scopes',d.id)).toBe(0)
  const saved=await prepare(d.id,'root');expect(saved.status).toBe(200)
  expect(await saved.json()).toMatchObject({company:{active:false,createdByOnboarding:true},venue:{active:false}})
 })
})
