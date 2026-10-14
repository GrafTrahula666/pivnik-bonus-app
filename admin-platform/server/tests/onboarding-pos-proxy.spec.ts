// @vitest-environment node
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import type {PGlite} from '@electric-sql/pglite'
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {nativePosFixture} from './native-pos-fixture.mjs'
const state=vi.hoisted(()=>({db:null as PGlite|null,failAudit:false,loseCommit:false}))
vi.mock('../db.js',()=>{
 const query=async(sql:string,params?:unknown[])=>{
  if(state.failAudit&&sql.startsWith('INSERT INTO admin_audit_log'))throw new Error('Synthetic audit failure')
  const r=await state.db!.query(sql,params)
  if(sql==='COMMIT'&&state.loseCommit){state.loseCommit=false;throw new Error('Synthetic lost COMMIT response')}
  return {...r,rowCount:r.rows.length||r.affectedRows||0}
 }
 const pool={query,connect:async()=>({query,release(){}})}
 return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
describe('signed Admin → native POS proxy v2, real device evidence and canonical scope',()=>{
 let server:http.Server,origin=''
 const sessions=new Map<string,{cookie:string;csrf:string}>(),drafts:string[]=[],devices:Awaited<ReturnType<typeof nativePosFixture>>[]=[]
 let mode='native',requests=0,block:Promise<void>|null=null,release:(()=>void)|null=null
 const nativeFetch=globalThis.fetch
 async function call(actor:string|null,method:string,path:string,body?:unknown,csrf=true){
  const s=actor?sessions.get(actor):null
  return nativeFetch(origin+path,{method,headers:{origin:'https://pos.fixture.invalid','content-type':'application/json',...(s?{cookie:s.cookie,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})})
 }
 const path=(n=0)=>'/api/admin/onboarding/drafts/'+drafts[n]+'/integrations/pos-proxy'
 const command=(n=0,revision=0)=>({requestKey:crypto.randomUUID(),revision,storeId:devices[n]!.storeId,deviceKey:devices[n]!.deviceKey})
 beforeAll(async()=>{
  Object.assign(process.env,{ADMIN_ENABLE_WRITES:'true',ADMIN_ENABLE_ONBOARDING_DRAFTS:'true',ADMIN_ENABLE_ONBOARDING_INVITATIONS:'true',ADMIN_ENABLE_ONBOARDING_WORKFLOW:'true',ADMIN_ENABLE_ONBOARDING_POS_PROXY:'true',ADMIN_PUBLIC_ORIGIN:'https://pos.fixture.invalid',ADMIN_CSRF_SECRET:'synthetic-proxy-csrf-secret-123456789-2026',ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID:'pos-fixture',ADMIN_ONBOARDING_SECRET_KEYRING:JSON.stringify({'pos-fixture':Buffer.alloc(32,8).toString('base64')})})
  const fixture=await import('./onboarding-fixture.js');state.db=await fixture.onboardingFixture()
  const {handleApi,sendApiError}=await import('../router.js')
  server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(e=>sendApiError(res,e,req))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port
  for(const actor of ['root','owner','trusted']){
   const response=await call(null,'POST','/api/admin/auth/login',{email:actor+'@fixture.invalid',password:fixture.fixturePassword});expect(response.status).toBe(200)
   sessions.set(actor,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:(await response.json()).csrfToken})
  }
  const registry:Record<string,string>={}
  for(const [n,companyId] of ['10','10','20'].entries()){
   const data={companyId,companyName:'',venueName:'Касса '+n,address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''}
   const draft=await (await call('root','POST','/api/admin/onboarding/drafts',{requestKey:crypto.randomUUID(),data})).json();drafts.push(draft.id)
   const app=await (await call('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/application`,{revision:0,config:{displayName:data.venueName,theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}})).json()
   const scope=await (await call('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/scope`,{draftRevision:draft.revision,applicationRevision:app.revision})).json()
   const terminalId='terminal-'+n,storeId='store-'+n
   expect((await call('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/progress`,{revision:0,progress:{currentStep:'verification',terminal:{id:terminalId,label:'Касса'},cashReports:true}})).status).toBe(200)
   devices.push(await nativePosFixture(scope.runtimeManifest,terminalId,storeId))
   const reference='SPACEVERSE_TENANT_PROXY_ORIGIN_TEST_'+n;registry[scope.runtimeManifest.runtimeKey]=reference
   process.env[reference]='https://proxy-'+n+'.fixture.invalid'
  }
  process.env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON=JSON.stringify(registry)
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
   if(url.hostname.startsWith('proxy-')&&url.hostname.endsWith('.fixture.invalid')){
    requests++;if(block)await block
    expect(init?.method).toBe('GET');expect(init?.redirect).toBe('error');expect(url.pathname).toBe('/api/device/pos/onboarding/status')
    const n=Number(url.hostname.split('-')[1]?.split('.')[0]),device=devices[n]!
    const response=await nativeFetch(device.origin+url.pathname+url.search,init)
    if(mode==='native')return response
    const raw=await response.json()
    if(mode==='tampered')raw.runtime.venueId='999'
    else if(mode==='nonce')raw.challenge=crypto.randomUUID()
    return new Response(JSON.stringify(raw),{status:200})
   }
   return nativeFetch(input,init)
  }) as typeof fetch
 },60_000)
 afterAll(async()=>{globalThis.fetch=nativeFetch;await new Promise<void>(resolve=>server.close(()=>resolve()));await Promise.all(devices.map(d=>d.close()));await state.db!.close()})
 it('manual migration repeats; encrypted save is idempotent even after a lost COMMIT response and audit failure rolls back',async()=>{
  await state.db!.exec(await fs.readFile(new URL('../../admin-migrations/015_onboarding_pos_proxy.sql',import.meta.url),'utf8'))
  const input=command();state.loseCommit=true
  expect((await call('owner','PUT',path(),input)).status).toBe(503)
  const retry=await call('owner','PUT',path(),input);expect(retry.status).toBe(200)
  expect(await retry.json()).toMatchObject({revision:1,status:'pending',credential:{present:true,masked:'••••••••'},runtimeStatus:'not_provisioned',report:{state:'unavailable',netCents:null}})
  const saved=(await state.db!.query('SELECT * FROM admin_onboarding_pos_proxy')).rows[0]!
  expect(JSON.stringify(saved)).not.toContain(devices[0]!.deviceKey)
  expect(await (await call('owner','GET',path())).text()).not.toContain(devices[0]!.deviceKey)
  expect((await call('owner','PUT',path(),{...input,storeId:'changed'})).status).toBe(409)
  state.failAudit=true
  try{expect((await call('owner','PUT',path(1),command(1))).status).toBe(503)}finally{state.failAudit=false}
  expect(await (await call('owner','GET',path(1))).json()).toMatchObject({revision:0,status:'not_configured'})
 })
 it('server rejects status/scope/destination spoofing, missing CSRF, a foreign company and a point viewer cannot mutate',async()=>{
  expect((await call('owner','GET',path(2))).status).toBe(404)
  for(const extra of [{status:'active'},{companyId:'20'},{origin:'https://attacker.invalid'}])expect((await call('owner','PUT',path(1),{...command(1),...extra})).status).toBe(400)
  expect((await call('owner','PUT',path(1),command(1),false)).status).toBe(403)
  const scope=await (await call('owner','GET',`/api/admin/onboarding/drafts/${drafts[0]}/scope`)).json()
  const invite=await (await call('owner','POST','/api/admin/onboarding/invitations',{requestKey:crypto.randomUUID(),companyId:'10',venueId:scope.scope.venue.id,role:'viewer',expiresInHours:24})).json()
  expect((await call('trusted','POST','/api/admin/onboarding/invitations/accept',{token:invite.token})).status).toBe(200)
  expect((await call('trusted','GET',path())).status).toBe(200)
  expect((await call('trusted','GET',path(1))).status).toBe(404)
  expect((await call('trusted','POST',path()+'/verify',{})).status).toBe(403)
 })
 it('native proxy missing event and incomplete sync remain pending; real event+complete empty report becomes verified 0 without launching app',async()=>{
  const verify=()=>call('owner','POST',path()+'/verify',{})
  expect(await (await verify()).json()).toMatchObject({status:'pending',code:'terminal_event_missing',report:{state:'unavailable',netCents:null}})
  expect((await devices[0]!.event()).status).toBe(200)
  expect(await (await verify()).json()).toMatchObject({status:'pending',code:'provider_data_pending'})
  await devices[0]!.completeSync()
  expect(await (await verify()).json()).toMatchObject({status:'active',code:'confirmed',runtimeStatus:'not_provisioned',published:false,report:{state:'available',empty:true,netCents:'0',receiptCount:0}})
  const workflow=await (await call('owner','GET',`/api/admin/onboarding/drafts/${drafts[0]}/progress`)).json()
  expect(workflow).toMatchObject({status:'pending',published:false,report:{state:'available',netCents:'0',receiptCount:0}})
  expect(workflow.lastDeviceActivityAt).toBeTruthy()
  expect(workflow.steps.find((s:{id:string})=>s.id==='verification')).toMatchObject({status:'active'})
  expect((await devices[0]!.db.query('SELECT * FROM wallets')).rows).toEqual([{user_id:1,balance:777}])
  expect((await state.db!.query('SELECT * FROM wallets')).rows).toEqual([{id:1,balance:100}])
  expect((await devices[0]!.db.query('SELECT COUNT(*)::int AS n FROM spaceverse_pos_test_events')).rows).toEqual([{n:1}])
 })
 it('bad MAC/nonce, another venue key, stale test event and revoked device cannot confirm connection',async()=>{
  for(const value of ['tampered','nonce']){mode=value;expect(await (await call('owner','POST',path()+'/verify',{})).json()).toMatchObject({status:'degraded',code:'proxy_response_invalid',report:{state:'unavailable'}})}
  mode='native'
  expect((await call('owner','PUT',path(1),{...command(1),deviceKey:devices[0]!.deviceKey})).status).toBe(200)
  expect(await (await call('owner','POST',path(1)+'/verify',{})).json()).toMatchObject({status:'failed',code:'device_key_rejected'})
  await devices[0]!.db.exec("UPDATE spaceverse_pos_test_events SET received_at=NOW()-INTERVAL '6 minutes'")
  expect(await (await call('owner','POST',path()+'/verify',{})).json()).toMatchObject({status:'degraded',code:'terminal_event_stale'})
  await devices[0]!.db.exec('UPDATE pos_devices SET revoked_at=NOW()')
  expect(await (await call('owner','POST',path()+'/verify',{})).json()).toMatchObject({status:'degraded',code:'device_key_rejected'})
 })
 it('network work releases SQL transaction; lease excludes duplicate request and terminal edit invalidates in-flight proof',async()=>{
  const saved=await (await call('owner','GET',path(1))).json()
  expect((await call('owner','PUT',path(1),command(1,saved.revision))).status).toBe(200)
  block=new Promise<void>(resolve=>{release=resolve});const before=requests
  const running=call('owner','POST',path(1)+'/verify',{})
  await vi.waitFor(()=>expect(requests).toBe(before+1))
  expect((await call('owner','POST',path(1)+'/verify',{})).status).toBe(409)
  expect((await call('owner','PUT',path(1),command(1,(await (await call('owner','GET',path(1))).json()).revision))).status).toBe(409)
  const progressPath=`/api/admin/onboarding/drafts/${drafts[1]}/progress`,progress=await (await call('owner','GET',progressPath)).json()
  expect((await call('owner','PUT',progressPath,{revision:progress.revision,progress:{...progress.progress,terminal:{id:'different-terminal',label:''}}})).status).toBe(200)
  release!();block=null
  expect((await running).status).toBe(409)
  expect(await (await call('owner','GET',path(1))).json()).toMatchObject({status:'pending',code:'configuration_changed',report:{state:'unavailable'}})
 })
 it('unregistered origin performs no network request, expiration degrades proof and audit contains no device key',async()=>{
  const registry=process.env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON;process.env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON='{}'
  const before=requests
  expect(await (await call('root','POST',path()+'/verify',{})).json()).toMatchObject({status:'pending',code:'proxy_not_registered'})
  expect(requests).toBe(before);process.env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON=registry
  // Test fixture evidence only: read must invalidate expired verification independently of browser state.
  await state.db!.query("UPDATE admin_onboarding_pos_proxy SET status='active',checked_at=NOW()-INTERVAL '6 minutes' WHERE draft_id=$1::uuid",[drafts[0]])
  expect(await (await call('owner','GET',path())).json()).toMatchObject({status:'degraded',code:'verification_stale',report:{state:'unavailable'}})
  const audit=JSON.stringify((await state.db!.query('SELECT * FROM admin_audit_log')).rows)
  for(const device of devices)expect(audit).not.toContain(device.deviceKey)
 })
 it('revoking a manager during a native HTTP probe prevents its result from being committed; an expired lease can be retried',async()=>{
  const progressPath=`/api/admin/onboarding/drafts/${drafts[1]}/progress`,progress=await (await call('root','GET',progressPath)).json()
  expect((await call('root','PUT',progressPath,{revision:progress.revision,progress:{...progress.progress,terminal:{id:devices[1]!.terminalId,label:''}}})).status).toBe(200)
  await state.db!.query("UPDATE admin_onboarding_pos_proxy SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1::uuid",[drafts[1]])
  const saved=await (await call('root','GET',path(1))).json()
  expect((await call('root','PUT',path(1),command(1,saved.revision))).status).toBe(200)
  const scope=await (await call('root','GET',`/api/admin/onboarding/drafts/${drafts[1]}/scope`)).json()
  const invite=await (await call('owner','POST','/api/admin/onboarding/invitations',{requestKey:crypto.randomUUID(),companyId:'10',venueId:scope.scope.venue.id,role:'manager',expiresInHours:24})).json()
  expect((await call('trusted','POST','/api/admin/onboarding/invitations/accept',{token:invite.token})).status).toBe(200)
  block=new Promise<void>(resolve=>{release=resolve});const before=requests
  const running=call('trusted','POST',path(1)+'/verify',{})
  await vi.waitFor(()=>expect(requests).toBe(before+1))
  expect((await call('owner','POST',`/api/admin/onboarding/invitations/${invite.invitation.id}/revoke`,{})).status).toBe(200)
  release!();block=null;expect((await running).status).toBe(403)
  expect(await (await call('root','GET',path(1))).json()).toMatchObject({status:'verifying',report:{state:'unavailable'}})
  await state.db!.query("UPDATE admin_onboarding_pos_proxy SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE draft_id=$1::uuid",[drafts[1]])
  expect(await (await call('root','GET',path(1))).json()).toMatchObject({status:'degraded',code:'verification_expired'})
  expect(await (await call('root','POST',path(1)+'/verify',{})).json()).toMatchObject({status:'pending',code:'terminal_event_missing'})
 })
})
