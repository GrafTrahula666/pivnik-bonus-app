// @vitest-environment node
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'

const state=vi.hoisted(()=>({db:null as PGlite|null,failAudit:false}))
vi.mock('../db.js',()=>{
  const query=async(text:string,params?:unknown[])=>{
    if(state.failAudit&&text.startsWith('INSERT INTO admin_audit_log'))throw new Error('Synthetic sensitive store failure')
    const result=await state.db!.query(text,params)
    return {...result,rowCount:result.rows.length||result.affectedRows||0}
  }
  const pool={query,connect:async()=>({query,release(){}})}
  return {pool,readPool:pool,writePool:null,tableExists:async()=>false,productionTableExists:async()=>false}
})

describe('invitations: signed Admin sessions, actual HTTP router and canonical SQL',()=>{
  let server:http.Server,origin='',publicOrigin=''
  const sessions=new Map<string,{cookie:string;csrf:string}>()
  let password='',config:typeof import('../config.js').config
  const companyId='10'
  const base='/api/admin/onboarding/invitations'
  const key=()=>crypto.randomUUID()
  const command=(extra:Record<string,unknown>={})=>({requestKey:key(),companyId,venueId:null,role:'manager',expiresInHours:24,...extra})
  async function request(who:string|null,method:string,path:string,body?:unknown,csrf=true,requestOrigin?:string){
    const session=who?sessions.get(who):undefined
    return fetch(origin+path,{method,headers:{origin:requestOrigin??publicOrigin,'content-type':'application/json',
      ...(session?{cookie:session.cookie,...(csrf?{'x-csrf-token':session.csrf}:{})}:{}),
    },...(body===undefined?{}:{body:JSON.stringify(body)})})
  }
  async function invite(extra:Record<string,unknown>={}){
    const response=await request('owner','POST',base,command(extra))
    expect(response.status).toBe(200)
    return await response.json() as {invitation:{id:string};token:string;linkPath:string}
  }
  beforeAll(async()=>{
    process.env.ADMIN_ENABLE_WRITES='true';process.env.ADMIN_ENABLE_ONBOARDING_DRAFTS='true'
    process.env.ADMIN_ENABLE_ONBOARDING_INVITATIONS='true';process.env.ADMIN_CSRF_SECRET='synthetic-invitation-csrf-secret-1234567890'
    process.env.ADMIN_ENABLE_ONBOARDING_INTEGRATIONS='true'
    process.env.ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID='invitation-fixture'
    process.env.ADMIN_ONBOARDING_SECRET_KEYRING=JSON.stringify({'invitation-fixture':Buffer.alloc(32,8).toString('base64')})
    process.env.ADMIN_PUBLIC_ORIGIN='https://invitations.fixture.invalid'
    const fixture=await import('./onboarding-fixture.js');password=fixture.fixturePassword;state.db=await fixture.onboardingFixture()
    config=(await import('../config.js')).config;publicOrigin=config.publicOrigin
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for(const who of ['root','other-root','owner','trusted']){
      const response=await request(null,'POST','/api/admin/auth/login',{email:who+'@fixture.invalid',password})
      expect(response.status).toBe(200)
      const body=await response.json() as {csrfToken:string}
      sessions.set(who,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrfToken})
    }
  },30_000)
  afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await state.db?.close()})

  it('manual migration is additive and repeatable without touching PIVNIK rows',async()=>{
    const before=await state.db!.query('SELECT * FROM wallets UNION ALL SELECT id,amount FROM transactions')
    const sql=await fs.readFile(new URL('../../admin-migrations/011_onboarding_invitation_access.sql',import.meta.url),'utf8')
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i)
    expect(sql).not.toMatch(/ALTER TABLE\s+(?:users|wallets|purchases)/i)
    await state.db!.exec(sql)
    expect(await state.db!.query('SELECT * FROM wallets UNION ALL SELECT id,amount FROM transactions')).toEqual(before)
  })
  it('owner gets a stable replayable link; server rejects changed payload, foreign scope and missing CSRF',async()=>{
    const body=command()
    const created=await request('owner','POST',base,body)
    const first=await created.json() as {token:string;invitation:{id:string};linkPath:string}
    expect(created.status).toBe(200);expect(first.token).toMatch(/^SVI-/);expect(first.linkPath).toContain('#invite=')
    const repeat=await request('owner','POST',base,body)
    expect(repeat.status).toBe(200);expect(await repeat.json()).toEqual(first)
    expect((await request('owner','POST',base,{...body,role:'owner'})).status).toBe(409)
    expect((await request('owner','POST',base,command({companyId:'20'}))).status).toBe(403)
    expect((await request('trusted','POST',base,command())).status).toBe(403)
    expect((await request('owner','POST',base,command(),false)).status).toBe(403)
    expect((await request('owner','POST',base,command(),true,'https://foreign.invalid')).status).toBe(403)
    expect((await request('owner','POST',base,command({tenantId:'20'}))).status).toBe(400)
    expect((await request(null,'POST','/api/admin/onboarding/invite/claim',{token:first.token,email:'legacy@fixture.invalid',displayName:'Legacy',password})).status).toBe(410)
    const listed=await request('owner','GET',base);const list=await listed.json()
    expect(JSON.stringify(list)).not.toContain(first.token);expect(JSON.stringify(list)).not.toContain('token_hash')
    const logs=await state.db!.query<{metadata:unknown}>('SELECT metadata FROM admin_audit_log')
    expect(JSON.stringify(logs.rows)).not.toContain(first.token)
  })
  it('new recipient enters only invited organization; one use, exact signed retry and revoke are enforced',async()=>{
    const created=await invite()
    const beforePasswords=await state.db!.query('SELECT id,password_hash FROM admin_accounts ORDER BY id')
    const accepted=await request(null,'POST',base+'/accept',{token:created.token,email:'manager-one@fixture.invalid',displayName:'Управляющий',password})
    expect(accepted.status).toBe(200)
    const body=await accepted.json() as {admin:{id:string;role:string};csrfToken:string;companyId:string;capabilities:{onboardingAccess:boolean;onboardingWrite:boolean}}
    expect(body.admin.role).toBe('VENUE_ADMIN');expect(body.companyId).toBe('10')
    expect(body.capabilities).toMatchObject({onboardingAccess:true,onboardingWrite:true})
    sessions.set('manager',{cookie:accepted.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrfToken})
    const unchanged=await state.db!.query('SELECT id,password_hash FROM admin_accounts WHERE id IN(1,2,11,12) ORDER BY id')
    expect(unchanged.rows).toEqual(beforePasswords.rows)
    expect((await request('manager','POST',base+'/accept',{token:created.token})).status).toBe(200)
    expect((await request('trusted','POST',base+'/accept',{token:created.token})).status).toBe(409)
    const index=await request('manager','GET','/api/admin/onboarding/drafts')
    expect(index.status).toBe(200);expect((await index.json()).companies.map((row:{id:string})=>row.id)).toEqual(['10'])
    const data={companyId:'10',companyName:'',venueName:'Новое кафе',address:'Тестовый адрес',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''}
    const ownDraft=await request('manager','POST','/api/admin/onboarding/drafts',{requestKey:key(),data})
    expect(ownDraft.status).toBe(200);const draft=await ownDraft.json() as {id:string}
    expect((await request('manager','POST','/api/admin/onboarding/drafts',{requestKey:key(),data:{...data,companyId:'20'}})).status).toBe(403)
    expect((await request('manager','POST','/api/admin/onboarding/drafts',{requestKey:key(),data:{...data,companyId:null,companyName:'Чужая'}})).status).toBe(403)
    expect((await request('other-root','POST',base+'/'+created.invitation.id+'/revoke',{})).status).toBe(404)
    expect((await request('owner','POST',base+'/'+created.invitation.id+'/revoke',{})).status).toBe(200)
    expect((await request('manager','POST',base+'/accept',{token:created.token})).status).toBe(410)
    expect((await request('manager','GET','/api/admin/onboarding/drafts/'+draft.id)).status).toBe(403)
    const otherInvite=await request('other-root','POST',base,command({companyId:'20'}))
    expect(otherInvite.status).toBe(200)
    const other=await otherInvite.json() as {token:string}
    expect((await request('manager','POST',base+'/accept',{token:other.token})).status).toBe(200)
    expect((await request('manager','GET','/api/admin/onboarding/drafts/'+draft.id)).status).toBe(404)
    expect((await state.db!.query('SELECT balance FROM wallets WHERE id=1')).rows[0]).toEqual({balance:100})
  })
  it('expired and revoked invitations are honest failures; failures leave no new accounts or grants',async()=>{
    const expired=await invite();await state.db!.query("UPDATE admin_onboarding_invites SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid",[expired.invitation.id])
    const response=await request('trusted','POST',base+'/accept',{token:expired.token})
    expect(response.status).toBe(410);expect(await response.json()).toMatchObject({code:'INVITATION_EXPIRED'})
    const revoked=await invite();await request('owner','POST',base+'/'+revoked.invitation.id+'/revoke',{})
    expect((await request(null,'POST',base+'/accept',{token:revoked.token,email:'never@fixture.invalid',displayName:'Новый',password})).status).toBe(410)
    expect((await state.db!.query("SELECT id FROM admin_accounts WHERE email='never@fixture.invalid'")).rows).toEqual([])
    const failed=await invite();const before=await state.db!.query('SELECT count(*)::int AS n FROM admin_accounts')
    state.failAudit=true
    try{expect((await request(null,'POST',base+'/accept',{token:failed.token,email:'audit-fail@fixture.invalid',displayName:'Новый',password})).status).toBe(503)}finally{state.failAudit=false}
    expect((await state.db!.query('SELECT count(*)::int AS n FROM admin_accounts')).rows).toEqual(before.rows)
    expect((await state.db!.query('SELECT claimed_at AS accepted_at FROM admin_onboarding_invites WHERE id=$1::uuid',[failed.invitation.id])).rows[0]).toEqual({accepted_at:null})
  })
  it('a prepared new organization uses canonical scope for owner access and additional pending points',async()=>{
    const data={companyId:null,companyName:'Новая сеть',venueName:'Первое кафе',address:'',timeZone:'Europe/Moscow',venueType:'cafe',ownerEmail:''}
    const created=await request('root','POST','/api/admin/onboarding/drafts',{requestKey:key(),data})
    expect(created.status).toBe(200);const draft=await created.json() as {id:string;revision:number}
    const app=await request('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/application`,{revision:0,config:{displayName:'Новая сеть',theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}})
    expect(app.status).toBe(200);const application=await app.json() as {revision:number}
    const prepared=await request('root','PUT',`/api/admin/onboarding/drafts/${draft.id}/scope`,{draftRevision:draft.revision,applicationRevision:application.revision})
    expect(prepared.status).toBe(200);const scope=await prepared.json() as {company:{id:string};venue:{id:string}}
    const issued=await request('root','POST',base,command({companyId:scope.company.id,role:'owner'}))
    expect(issued.status).toBe(200);const invitation=await issued.json() as {token:string;invitation:{id:string}}
    const accepted=await request(null,'POST',base+'/accept',{token:invitation.token,email:'new-network-owner@fixture.invalid',displayName:'Владелец новой сети',password})
    expect(accepted.status).toBe(200);const session=await accepted.json() as {csrfToken:string}
    sessions.set('network-owner',{cookie:accepted.headers.get('set-cookie')!.split(';')[0]!,csrf:session.csrfToken})
    const opened=await request('network-owner','GET','/api/admin/onboarding/drafts/'+draft.id)
    expect(opened.status).toBe(200);expect(await opened.json()).toMatchObject({data:{companyId:null},permissions:{role:'owner',canWrite:true}})
    const targets=await request('network-owner','GET',base)
    expect(targets.status).toBe(200);expect((await targets.json()).companies).toContainEqual({id:scope.company.id,name:'Новая сеть'})
    const next=await request('network-owner','POST','/api/admin/onboarding/drafts',{requestKey:key(),data:{...data,companyId:scope.company.id,companyName:'',venueName:'Второе кафе'}})
    expect(next.status).toBe(200)
    const pointInvite=await request('network-owner','POST',base,command({companyId:scope.company.id,venueId:scope.venue.id}))
    expect(pointInvite.status).toBe(200)
    expect((await request('other-root','POST',base,command({companyId:scope.company.id}))).status).toBe(404)
    expect((await state.db!.query('SELECT active FROM companies WHERE id=$1::bigint',[scope.company.id])).rows[0]).toEqual({active:false})
    expect((await state.db!.query('SELECT active FROM venues WHERE id=$1::bigint',[scope.venue.id])).rows[0]).toEqual({active:false})
    await request('root','POST',base+'/'+invitation.invitation.id+'/revoke',{})
    expect((await request('network-owner','GET','/api/admin/onboarding/drafts/'+draft.id)).status).toBe(403)
  })
  it('viewer has read-only draft access; point invitation cannot reveal another point in the same company',async()=>{
    const data={companyId:'10',companyName:'',venueName:'Точка по приглашению',address:'',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:''}
    async function prepared(name:string){
      const draftResponse=await request('owner','POST','/api/admin/onboarding/drafts',{requestKey:key(),data:{...data,venueName:name}})
      expect(draftResponse.status).toBe(200);const draft=await draftResponse.json() as {id:string;revision:number}
      const app=await request('owner','PUT',`/api/admin/onboarding/drafts/${draft.id}/application`,{revision:0,config:{displayName:name,theme:'light',primaryColor:'#112233',secondaryColor:'#445566',shopEnabled:false,loyaltyEnabled:true}})
      expect(app.status).toBe(200);const application=await app.json() as {revision:number}
      const scope=await request('owner','PUT',`/api/admin/onboarding/drafts/${draft.id}/scope`,{draftRevision:draft.revision,applicationRevision:application.revision})
      expect(scope.status).toBe(200);return {draft,scope:await scope.json() as {venue:{id:string}}}
    }
    const a=await prepared('Точка A'),b=await prepared('Точка B')
    const created=await invite({venueId:a.scope.venue.id,role:'viewer'})
    expect((await request('trusted','POST',base+'/accept',{token:created.token})).status).toBe(200)
    expect((await request('trusted','GET','/api/admin/onboarding/drafts/'+a.draft.id)).status).toBe(200)
    expect((await request('trusted','GET','/api/admin/onboarding/drafts/'+b.draft.id)).status).toBe(404)
    const providerPath='/api/admin/onboarding/drafts/'+a.draft.id+'/integrations/evotor'
    expect((await request('trusted','GET',providerPath)).status).toBe(200)
    expect((await request('trusted','PUT',providerPath,{requestKey:key(),revision:0,storeId:'synthetic-store',token:'synthetic-provider-token'})).status).toBe(403)
    expect((await request('trusted','POST',providerPath+'/verify',{revision:1})).status).toBe(403)
    expect((await request('trusted','PUT','/api/admin/onboarding/drafts/'+a.draft.id,{revision:1,data})).status).toBe(403)
    const viewed=await request('trusted','GET','/api/admin/onboarding/drafts/'+a.draft.id)
    expect(await viewed.json()).toMatchObject({permissions:{canWrite:false,role:'viewer'}})
    const session=await request('trusted','GET','/api/admin/auth/session')
    expect(await session.json()).toMatchObject({capabilities:{onboardingAccess:true,onboardingWrite:false}})
  })
})
