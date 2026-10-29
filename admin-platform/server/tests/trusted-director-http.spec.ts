// @vitest-environment node
import http from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'

const state=vi.hoisted(()=>({db:null as PGlite|null}))
vi.mock('../db.js',()=>{
  const query=async(text:string,params?:unknown[])=>{
    const r=await state.db!.query(text,params)
    return {...r,rowCount:r.rows.length||r.affectedRows||0}
  }
  const adapter={query,connect:async()=>({query,release(){}})}
  return {pool:adapter,readPool:adapter,writePool:adapter,
    productionTableExists:async()=>false,tableExists:async()=>false}
})

describe('trusted director through actual HTTP router and disposable PostgreSQL',()=>{
  let server:http.Server,origin=''
  const sessions=new Map<string,{cookie:string;csrf:string}>()
  const password='Fixture-Director-Only-2026!'

  beforeAll(async()=>{
    process.env.ADMIN_ENABLE_WRITES='true'
    process.env.ADMIN_PRODUCTION_WRITE_DATABASE_URL='postgres://fixture.invalid/unused'
    process.env.ADMIN_PUBLIC_ORIGIN='https://director.fixture.invalid'
    process.env.ADMIN_CSRF_SECRET='fixture-only-director-secret-1234567890'
    process.env.PIVNIK_APP_URL='https://guest.fixture.invalid'
    process.env.BUSINESS_INTERNAL_TOKEN='fixture-only-business-token-1234567890'
    state.db=new PGlite()
    await state.db.exec(`
      CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,email TEXT,display_name TEXT,role TEXT,password_hash TEXT,active BOOLEAN DEFAULT TRUE,last_login_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);
      CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY,admin_id BIGINT,expires_at TIMESTAMPTZ,user_agent TEXT,ip_hash TEXT,last_seen_at TIMESTAMPTZ);
      CREATE TABLE companies(id BIGINT PRIMARY KEY,code TEXT,name TEXT,active BOOLEAN);
      CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT,code TEXT,name TEXT,address TEXT,legacy_bar_id BIGINT,active BOOLEAN);
      CREATE TABLE admin_company_access(admin_id BIGINT,company_id BIGINT,access_kind TEXT);
      CREATE TABLE admin_audit_log(admin_id BIGINT,admin_role TEXT,company_id BIGINT,venue_id BIGINT,action TEXT,entity_type TEXT,entity_id TEXT,before_value JSONB,after_value JSONB,reason TEXT,metadata JSONB);
      CREATE TABLE app_settings(id INT PRIMARY KEY,draft JSONB,published JSONB,updated_at TIMESTAMPTZ);
      CREATE TABLE promotions(id BIGSERIAL PRIMARY KEY,code TEXT,title TEXT,description TEXT,badge TEXT,image_src TEXT,active BOOLEAN,sort_order INT,updated_at TIMESTAMPTZ DEFAULT NOW(),updated_by BIGINT);
      INSERT INTO companies VALUES(10,'pivnik','ПИВНИК',TRUE),(20,'foreign','Foreign',TRUE);
      INSERT INTO venues VALUES(101,10,'pivnik','ПИВНИК',NULL,1,TRUE),(202,20,'foreign','Foreign',NULL,2,TRUE);
      INSERT INTO admin_company_access VALUES(11,10,'trusted'),(12,10,'owner');
      INSERT INTO app_settings VALUES(1,'{}','{"texts":{"brand":"ПИВНИК"}}',NOW());
    `)
    const {hashPassword}=await import('../security.js')
    for(const [id,email,role] of [[11,'trusted@fixture.invalid','VENUE_ADMIN'],[12,'owner@fixture.invalid','VENUE_ADMIN'],[1,'root@fixture.invalid','SUPER_ADMIN']] as const)
      await state.db.query('INSERT INTO admin_accounts(id,email,display_name,role,password_hash) VALUES($1,$2,$2,$3,$4)',[id,email,role,hashPassword(password)])
    const {handleApi,sendApiError}=await import('../router.js')
    server=http.createServer((req,res)=>{void handleApi(req,res,new URL(req.url!,origin)).catch(error=>sendApiError(res,error,req))})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
    for(const who of ['trusted','owner','root']){
      const r=await fetch(origin+'/api/admin/auth/login',{method:'POST',headers:{origin:'https://director.fixture.invalid','content-type':'application/json'},body:JSON.stringify({email:who+'@fixture.invalid',password})})
      expect(r.status).toBe(200)
      const body=await r.json() as {csrfToken:string}
      sessions.set(who,{cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrfToken})
    }
  },30_000)

  afterAll(async()=>{
    if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))
    await state.db?.close()
  })

  async function request(who:string,method:string,path:string,body:unknown={},csrf=true){
    const session=sessions.get(who)!
    return fetch(origin+path,{method,headers:{cookie:session.cookie,origin:'https://director.fixture.invalid','content-type':'application/json',...(csrf?{'x-csrf-token':session.csrf}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})})
  }

  it('lists only the assigned company with trusted access kind',async()=>{
    const r=await request('trusted','GET','/api/admin/venues')
    expect(r.status).toBe(200)
    expect((await r.json() as {venues:unknown[]}).venues).toMatchObject([{id:'101',companyCode:'pivnik',accessKind:'trusted'}])
  })

  it.each([
    ['GET','beer-intake'],['POST','beer-intake'],
    ['GET','beer-inventory'],['POST','beer-inventory'],
    ['GET','app/design'],['GET','app/loyalty'],['GET','app/wheel'],['GET','app/rewards'],
    ['GET','features/manage'],['GET','branding/manage'],['GET','loyalty/manage'],['GET','wheel/manage'],
    ['GET','achievements/manage'],['GET','shop/manage'],['GET','design'],
    ['PUT','app/design'],['PUT','app/loyalty'],['PUT','app/wheel'],['PUT','app/rewards/achievements'],
    ['PUT','features/manage'],['PUT','branding/manage'],['PUT','shop/manage'],
    ['POST','clients/1/bonus-adjustments'],['POST','clients/1/entitlements'],['POST','clients/1/frames'],
    ['DELETE','clients/1/frames/gold'],['POST','clients/1/app-achievements'],['PUT','clients/1/cashback'],
    ['POST','clients/1/achievements/grant'],['DELETE','app/promotions/1'],['PUT','pos'],['POST','integrations'],
  ])('denies %s %s before reading a body or executing changes',async(method,path)=>{
    const before=(await state.db!.query('SELECT * FROM promotions')).rows
    const r=await request('trusted',method,'/api/admin/venues/101/'+path)
    expect(r.status).toBe(403)
    expect(await r.json()).toMatchObject({code:method==='GET'?'DIRECTOR_READ_FORBIDDEN':'DIRECTOR_WRITE_FORBIDDEN'})
    expect((await state.db!.query('SELECT * FROM promotions')).rows).toEqual(before)
  })

  it('denies foreign venues and platform APIs',async()=>{
    expect((await request('trusted','GET','/api/admin/venues/202/app/promotions')).status).toBe(404)
    for(const path of ['platform','developer','audit'])expect((await request('trusted','GET','/api/admin/'+path)).status).toBe(403)
  })

  it('requires CSRF even on permitted marketing operations',async()=>{
    expect((await request('trusted','POST','/api/admin/venues/101/app/promotions',{title:'Fixture'},false)).status).toBe(403)
  })

  it('allows creating, publishing and hiding promotions but keeps owner deletion',async()=>{
    const created=await request('trusted','POST','/api/admin/venues/101/app/promotions',{title:'Fixture',active:false})
    expect(created.status).toBe(200)
    const {id}=await created.json() as {id:string}
    for(const active of [true,false]){
      const edited=await request('trusted','PUT','/api/admin/venues/101/app/promotions/'+id,{title:'Fixture',active})
      expect(edited.status).toBe(200)
      expect(await edited.json()).toMatchObject({active})
    }
    expect((await request('trusted','DELETE','/api/admin/venues/101/app/promotions/'+id)).status).toBe(403)
    expect((await request('owner','DELETE','/api/admin/venues/101/app/promotions/'+id)).status).toBe(200)
  })

  it('preserves both owner and SUPER_ADMIN settings access',async()=>{
    for(const who of ['owner','root'])expect((await request(who,'GET','/api/admin/venues/101/app/design')).status).toBe(200)
  })

  it('allows broadcasts through the existing app link, with no real recipients in the fixture',async()=>{
    const {setBroadcastFetchForTests}=await import('../pivnik-broadcast.js')
    const appFetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,campaignId:'fixture',deduplicated:false,totalUsers:0,telegram:{attempted:0,delivered:0,failed:0},vk:{attempted:0,delivered:0,failed:0}}),{status:200}))
    setBroadcastFetchForTests(appFetch)
    try{
      const r=await request('trusted','POST','/api/admin/venues/101/broadcast',{channel:'telegram',message:'Fixture only'})
      expect(r.status).toBe(200)
      expect(appFetch).toHaveBeenCalledOnce()
    }finally{setBroadcastFetchForTests(null)}
  })

  it('allows changing only the signed-in directors password and keeps owner credentials',async()=>{
    const before=(await state.db!.query('SELECT password_hash FROM admin_accounts WHERE id=12')).rows
    const r=await request('trusted','POST','/api/admin/auth/password',{currentPassword:password,newPassword:'New-Fixture-Password-2026!'})
    expect(r.status).toBe(200)
    expect((await state.db!.query('SELECT password_hash FROM admin_accounts WHERE id=12')).rows).toEqual(before)
    expect((await request('trusted','GET','/api/admin/auth/session')).status).toBe(200)
  })
})
