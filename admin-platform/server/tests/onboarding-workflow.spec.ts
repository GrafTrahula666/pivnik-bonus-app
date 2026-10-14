// @vitest-environment node
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
const state=vi.hoisted(()=>({db:null as PGlite|null,failAudit:false}))
vi.mock('../db.js',()=>{
 const query=async(sql:string,params?:unknown[])=>{
  if(state.failAudit&&sql.startsWith('INSERT INTO admin_audit_log'))throw new Error('Synthetic audit failure')
  const r=await state.db!.query(sql,params);return {...r,rowCount:r.rows.length||r.affectedRows||0}
 }
 const pool={query,connect:async()=>({query,release(){}})}
 return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})
describe('server-owned resumable workflow on canonical scope',()=>{
 let server:http.Server,origin='',password=''
 const sessions=new Map<string,{cookie:string;csrf:string}>()
 const drafts:string[]=[]
 async function call(actor:string|null,method:string,path:string,body?:unknown,csrf=true){
  const s=actor?sessions.get(actor):null
  return fetch(origin+path,{method,headers:{origin:'https://workflow.fixture.invalid','content-type':'application/json',...(s?{cookie:s.cookie,...(csrf?{'x-csrf-token':s.csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})})
 }
 const path=(id=drafts[0])=>'/api/admin/onboarding/drafts/'+id+'/progress'
 const command=(revision=0)=>({revision,progress:{currentStep:'terminal',terminal:{id:'synthetic-terminal',label:'Основная касса'},cashReports:true}})
 beforeAll(async()=>{
  process.env.ADMIN_ENABLE_WRITES='true';process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS='true'
  process.env.ADMIN_ENABLE_ONBOARDING_INVITATIONS='true';process.env.ADMIN_ENABLE_ONBOARDING_WORKFLOW='true'
  process.env.ADMIN_CSRF_SECRET='synthetic-workflow-csrf-secret-2026-123456789'
  process.env.ADMIN_ENABLE_ONBOARDING_INTEGRATIONS='true'
  process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID='workflow-fixture'
  process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'workflow-fixture':Buffer.alloc(32,6).toString('base64')})
  process.env.ADMIN_PUBLIC_ORIGIN='https://workflow.fixture.invalid'
  const fixture=await import('./onboarding-fixture.js');password=fixture.fixturePassword;state.db=await fixture.onboardingFixture()
  const {handleApi,sendApiError}=await import('../router.js')
  server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(e=>sendApiError(res,e,req))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port
  for(const actor of ['root','owner','trusted']){
   const response=await call(null,'POST','/api/admin/auth/login',{email:actor+'@fixture.invalid',password});expect(response.status).toBe(200)
   sessions.set(actor,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:(await response.json()).csrfToken})
  }
  for(const [companyId,venueName] of [['10','Первая'],['10','Вторая'],['20','Чужая']]){
   const data={companyId,companyName:'',venueName,address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''}
   const created=await call('root','POST','/api/admin/onboarding/drafts',{requestKey:crypto.randomUUID(),data});expect(created.status).toBe(200)
   const draft=await created.json();drafts.push(draft.id)
   const app=await call('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/application`,{revision:0,config:{displayName:venueName,theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}});expect(app.status).toBe(200)
   const saved=await app.json()
   expect((await call('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/scope`,{draftRevision:draft.revision,applicationRevision:saved.revision})).status).toBe(200)
  }
 },30_000)
 afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await state.db!.close()})
 it('migration is manual, repeatable and does not alter wallet data',async()=>{
  const before=await state.db!.query('SELECT * FROM wallets')
  await state.db!.exec(await fs.readFile(new URL('../../admin-migrations/012_onboarding_progress.sql',import.meta.url),'utf8'))
  expect((await state.db!.query('SELECT * FROM wallets')).rows).toEqual(before.rows)
 })
 it('derives provisioning progress from binding, schema and runtime bundle ledgers',async()=>{
  const source=(await state.db!.query<{tenant_key:string;application_revision:number;company_id:string;venue_id:string}>(`SELECT
    app.tenant_key,app.revision AS application_revision,scope.company_id::text,scope.venue_id::text
    FROM admin_onboarding_app_configs app JOIN admin_onboarding_scopes scope ON scope.draft_id=app.draft_id
    WHERE app.draft_id=$1::uuid`,[drafts[0]])).rows[0]!
  const common=[drafts[0],source.tenant_key,'a'.repeat(64),source.application_revision,source.company_id,source.venue_id]
  await state.db!.query(`INSERT INTO admin_onboarding_provisioning_steps(
    draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,status,attempt_count,result)
    VALUES($1::uuid,'runtime_database_binding',$2,$3,$4,$5::bigint,$6::bigint,'succeeded',1,$7::jsonb)`,[
    ...common,JSON.stringify({binding:'created'}),
  ])
  const waiting=await (await call('owner','GET',path())).json()
  expect(waiting.steps.find((step:{id:string})=>step.id==='provisioning')).toMatchObject({
    status:'pending',code:'schema_readiness_pending',
  })
  await state.db!.query(`INSERT INTO admin_onboarding_provisioning_steps(
    draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,status,attempt_count,last_error_code)
    VALUES($1::uuid,'tenant_schema_readiness',$2,$3,$4,$5::bigint,$6::bigint,'action_required',1,'TARGET_TENANT_DATA_OWNERSHIP_REQUIRED')`,common)
  const blocked=await (await call('owner','GET',path())).json()
  expect(blocked.steps.find((step:{id:string})=>step.id==='provisioning')).toMatchObject({
    status:'failed',code:'TARGET_TENANT_DATA_OWNERSHIP_REQUIRED',
  })
  await state.db!.query(`UPDATE admin_onboarding_provisioning_steps SET
    status='succeeded',last_error_code=NULL,result=$2::jsonb,updated_at=NOW()
    WHERE draft_id=$1::uuid AND step='tenant_schema_readiness'`,[
    drafts[0],JSON.stringify({schema:'verified',migrationSet:'009,017-020',ownershipBoundary:'verified'}),
  ])
  const ready=await (await call('owner','GET',path())).json()
  expect(ready.steps.find((step:{id:string})=>step.id==='provisioning')).toMatchObject({
    status:'pending',code:'runtime_bundle_pending',
  })
  expect(ready).toMatchObject({runtimeStatus:'not_provisioned',published:false})
  await state.db!.query(`INSERT INTO admin_onboarding_provisioning_steps(
    draft_id,step,runtime_key,manifest_sha256,application_revision,company_id,venue_id,status,attempt_count,result)
    VALUES($1::uuid,'runtime_bundle_verification',$2,$3,$4,$5::bigint,$6::bigint,'succeeded',1,$7::jsonb)`,[
    ...common,JSON.stringify({bundle:'verified',artifact:'pivnik-bonus-app',artifactContract:'tenant-runtime-v1',
      bundleSha256:'b'.repeat(64),manifestSchemaVersion:2,runtimeStatus:'not_provisioned',published:false}),
  ])
  const bundled=await (await call('owner','GET',path())).json()
  expect(bundled.steps.find((step:{id:string})=>step.id==='provisioning')).toMatchObject({
    status:'pending',code:'runtime_bundle_ready_launch_pending',
  })
  expect(bundled).toMatchObject({runtimeStatus:'not_provisioned',published:false,requiresAttention:true})
 })
 it('saved terminal/modules/checkpoint never imply a provisioned app or a zero report',async()=>{
  const before=await call('owner','GET',path());expect(before.status).toBe(200)
  expect(await before.json()).toMatchObject({revision:0,runtimeStatus:'not_provisioned',published:false,report:{state:'unavailable',netCents:null,receiptCount:null},lastDeviceActivityAt:null})
  const saved=await call('owner','PUT',path(),command());expect(saved.status).toBe(200)
  const body=await saved.json();expect(body).toMatchObject({revision:1,progress:command().progress,status:'pending',modules:{loyalty:true,shop:false,cashReports:true}})
  expect(body.steps.find((s:{id:string})=>s.id==='terminal')).toMatchObject({status:'pending',code:'terminal_saved_unbound'})
  expect(body.steps.find((s:{id:string})=>s.id==='verification')).toMatchObject({status:'pending',code:'terminal_event_not_verified'})
  expect((await call('owner','GET',path())).status).toBe(200)
  expect(await (await call('owner','PUT',path(),command())).json()).toEqual(body)
  expect((await call('owner','PUT',path(),{...command(),progress:{...command().progress,currentStep:'verification'}})).status).toBe(409)
 })
 it('server rejects scope/status/key spoofing, foreign organization, viewer writes and missing CSRF',async()=>{
  expect((await call('owner','GET',path(drafts[2]))).status).toBe(404)
  expect((await call('owner','PUT',path(),{...command(1),status:'active'})).status).toBe(400)
  expect((await call('owner','PUT',path(),{...command(1),companyId:'20'})).status).toBe(400)
  expect((await call('owner','PUT',path(),{...command(1),progress:{...command().progress,terminal:{id:'pvpos_'+ 'a'.repeat(43),label:''}}})).status).toBe(400)
  expect((await call('owner','PUT',path(),command(1),false)).status).toBe(403)
  const scope=await (await call('owner','GET',`/api/admin/onboarding/drafts/${drafts[0]}/scope`)).json()
  const issued=await call('owner','POST','/api/admin/onboarding/invitations',{requestKey:crypto.randomUUID(),companyId:'10',venueId:scope.scope.venue.id,role:'viewer',expiresInHours:24});expect(issued.status).toBe(200)
  const invite=await issued.json()
  expect((await call('trusted','POST','/api/admin/onboarding/invitations/accept',{token:invite.token})).status).toBe(200)
  expect((await call('trusted','GET',path())).status).toBe(200)
  expect((await call('trusted','PUT',path(),command(1))).status).toBe(403)
  expect((await call('trusted','GET',path(drafts[1]))).status).toBe(404)
  expect((await call('owner','POST',`/api/admin/onboarding/invitations/${invite.invitation.id}/revoke`,{})).status).toBe(200)
  expect((await call('trusted','GET',path())).status).toBe(403)
 })
 it('failed audit rolls back checkpoint/modules and cannot manufacture a successful step',async()=>{
  state.failAudit=true
  try{expect((await call('owner','PUT',path(drafts[1]),command())).status).toBe(503)}finally{state.failAudit=false}
  expect(await (await call('owner','GET',path(drafts[1]))).json()).toMatchObject({revision:0,progress:{currentStep:'organization',terminal:{id:'',label:''},cashReports:false}})
  const active=(await state.db!.query('SELECT active FROM venues WHERE id IN (SELECT venue_id FROM admin_onboarding_scopes)')).rows
  expect(active.every(row=>row.active===false)).toBe(true)
 })
 it('fresh provider verification, stale evidence and failed access have distinct server statuses',async()=>{
  const provider='/api/admin/onboarding/drafts/'+drafts[1]+'/integrations/evotor'
  const configured=await call('owner','PUT',provider,{requestKey:crypto.randomUUID(),revision:0,storeId:'synthetic-store',token:'synthetic-provider-token'})
  expect(configured.status).toBe(200)
  await state.db!.query("UPDATE admin_onboarding_integrations SET status='verified',last_checked_at=NOW(),verified_at=NOW() WHERE draft_id=$1::uuid",[drafts[1]])
  const fresh=await (await call('owner','GET',path(drafts[1]))).json()
  expect(fresh.steps.find((s:{id:string})=>s.id==='provider')).toMatchObject({status:'active',code:'documents_readable'})
  expect(fresh.report).toMatchObject({state:'unavailable',netCents:null})
  await state.db!.query("UPDATE admin_onboarding_integrations SET last_checked_at=NOW()-INTERVAL '16 minutes' WHERE draft_id=$1::uuid",[drafts[1]])
  const stale=await (await call('owner','GET',path(drafts[1]))).json()
  expect(stale).toMatchObject({status:'degraded'})
  expect(stale.steps.find((s:{id:string})=>s.id==='provider')).toMatchObject({status:'degraded',code:'provider_check_stale'})
  await state.db!.query("UPDATE admin_onboarding_integrations SET status='action_required',last_error_code='forbidden',last_checked_at=NOW() WHERE draft_id=$1::uuid",[drafts[1]])
  const denied=await (await call('owner','GET',path(drafts[1]))).json()
  expect(denied.steps.find((s:{id:string})=>s.id==='provider')).toMatchObject({status:'degraded',code:'forbidden',nextAction:'Проверьте права токена на документы указанного магазина.'})
  await state.db!.query('UPDATE admin_onboarding_integrations SET verified_at=NULL WHERE draft_id=$1::uuid',[drafts[1]])
  const failed=await (await call('owner','GET',path(drafts[1]))).json()
  expect(failed.steps.find((s:{id:string})=>s.id==='provider')).toMatchObject({status:'failed',code:'forbidden'})
 })
 it('missing progress schema is an explicit failure and leaves existing draft reads available',async()=>{
  await state.db!.exec('ALTER TABLE admin_onboarding_progress RENAME TO fixture_saved_progress')
  try{
   const response=await call('owner','GET',path());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'ONBOARDING_PROGRESS_NOT_CONFIGURED'})
   expect((await call('owner','GET','/api/admin/onboarding/drafts/'+drafts[0])).status).toBe(200)
  }finally{await state.db!.exec('ALTER TABLE fixture_saved_progress RENAME TO admin_onboarding_progress')}
 })
 it('owner list unifies canonical prepared venues and existing points without inventing connectivity, activity or zero revenue',async()=>{
  const response=await call('owner','GET','/api/admin/onboarding/venues');expect(response.status).toBe(200)
  const list=await response.json()
  expect(list).toMatchObject({total:4,offset:0,nextOffset:null})
  expect(list.venues.filter((venue:{kind:string})=>venue.kind==='draft')).toHaveLength(2)
  expect(list.venues.some((venue:{companyId:string})=>venue.companyId==='20')).toBe(false)
  const legacy=list.venues.find((venue:{kind:string})=>venue.kind==='existing')
  expect(legacy).toMatchObject({status:'pending',attentionCode:'connection_not_verified',requiresAttention:true,lastDeviceActivityAt:null,runtimeStatus:'unknown',published:null,report:{state:'unavailable',netCents:null,receiptCount:null}})
  const prepared=list.venues.find((venue:{id:string})=>venue.id===drafts[0])
  expect(prepared).toMatchObject({status:'pending',runtimeStatus:'not_provisioned',published:false,requiresAttention:true,lastDeviceActivityAt:null})
  expect(prepared.lastOperatorActivityAt).toBeTruthy()
  expect((await call('owner','GET','/api/admin/onboarding/venues?companyId=20')).status).toBe(400)
  expect((await call('owner','GET','/api/admin/onboarding/venues?offset=-1')).status).toBe(400)
  expect((await call('owner','GET','/api/admin/onboarding/venues?offset=0&offset=25')).status).toBe(400)
  expect((await call('owner','PUT','/api/admin/onboarding/venues',{status:'active'})).status).toBe(405)
 })
 it('a newly invited point viewer sees only its point in owner list, with revoke closing list access',async()=>{
  const scope=await (await call('owner','GET',`/api/admin/onboarding/drafts/${drafts[0]}/scope`)).json()
  const invite=await (await call('owner','POST','/api/admin/onboarding/invitations',{requestKey:crypto.randomUUID(),companyId:'10',venueId:scope.scope.venue.id,role:'viewer',expiresInHours:24})).json()
  const accepted=await call(null,'POST','/api/admin/onboarding/invitations/accept',{token:invite.token,email:'new-viewer@fixture.invalid',displayName:'Просмотрщик',password:'Synthetic-Viewer-Only-2026!'})
  expect(accepted.status).toBe(200);sessions.set('new-viewer',{cookie:accepted.headers.get('set-cookie')!.split(';')[0]!,csrf:(await accepted.json()).csrfToken})
  const own=await (await call('new-viewer','GET','/api/admin/onboarding/venues')).json()
  expect(own.total).toBe(1);expect(own.venues.map((venue:{id:string})=>venue.id)).toEqual([drafts[0]])
  expect((await call('owner','POST',`/api/admin/onboarding/invitations/${invite.invitation.id}/revoke`,{})).status).toBe(200)
  expect((await call('new-viewer','GET','/api/admin/onboarding/venues')).status).toBe(403)
 })
 it('pagination returns every accessible point once and never mixes another company into later pages',async()=>{
  for(let n=0;n<30;n++){
   const created=await call('root','POST','/api/admin/onboarding/drafts',{requestKey:crypto.randomUUID(),data:{companyId:'10',companyName:'',venueName:'Пагинация '+String(n).padStart(2,'0'),address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''}})
   expect(created.status).toBe(200)
  }
  const ids:string[]=[];let offset:number|null=0
  while(offset!==null){
   const response=await call('owner','GET','/api/admin/onboarding/venues?offset='+offset);expect(response.status).toBe(200)
   const page=await response.json();expect(page.total).toBe(34);expect(page.venues.length).toBeLessThanOrEqual(25)
   for(const venue of page.venues){expect(venue.companyId).toBe('10');ids.push(venue.kind+':'+venue.id)}
   offset=page.nextOffset
  }
  expect(ids.length).toBe(34);expect(new Set(ids).size).toBe(34)
 })
})
