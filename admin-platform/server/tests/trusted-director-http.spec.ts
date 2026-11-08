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
    const foreignWrite=await request('trusted','POST','/api/admin/venues/202/app/promotions',{title:'Foreign tenant injection'})
    expect(foreignWrite.status).toBe(404)
    expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Foreign tenant injection'")).rows[0].count).toBe(0)
    // A company owner must also fail closed for another company's direct venue ID.
    expect((await request('owner','GET','/api/admin/venues/202/app/promotions')).status).toBe(404)
    expect((await request('owner','POST','/api/admin/venues/202/app/promotions',{title:'Foreign owner injection'})).status).toBe(404)
    expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Foreign owner injection'")).rows[0].count).toBe(0)
    // Direct foreign venue IDs must not permit updates to an existing promotion.
    const seeded=await state.db!.query("INSERT INTO promotions(code,title,active) VALUES('foreign-scope-fixture','Original foreign title',TRUE) RETURNING id")
    const promotionId=String((seeded.rows[0] as {id:string|number}).id)
    try{
      for(const who of ['trusted','owner']){
        expect((await request(who,'PUT','/api/admin/venues/202/app/promotions/'+promotionId,{title:'Foreign mutation attempt'})).status).toBe(404)
        expect((await request(who,'DELETE','/api/admin/venues/202/app/promotions/'+promotionId)).status).toBe(404)
      }
      expect((await state.db!.query('SELECT title FROM promotions WHERE id=$1',[promotionId])).rows[0]).toMatchObject({title:'Original foreign title'})
    }finally{
      await state.db!.query('DELETE FROM promotions WHERE id=$1',[promotionId])
    }
    for(const path of ['platform','developer','audit'])expect((await request('trusted','GET','/api/admin/'+path)).status).toBe(403)
  })

  it('requires CSRF even on permitted marketing operations',async()=>{
    expect((await request('trusted','POST','/api/admin/venues/101/app/promotions',{title:'Fixture'},false)).status).toBe(403)
  })

  it('rejects a nonempty forged CSRF token on an otherwise permitted director write',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    const title='Forged director CSRF must not persist'
    const session=sessions.get('trusted')!
    expect((await request('trusted','GET',path)).status).toBe(200)
    const response=await fetch(origin+path,{
      method:'POST',
      headers:{cookie:session.cookie,origin:'https://director.fixture.invalid',
        'content-type':'application/json','x-csrf-token':'forged-nonempty-csrf-token'},
      body:JSON.stringify({title,active:false}),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({code:'CSRF_REJECTED'})
    expect((await state.db!.query('SELECT COUNT(*)::int AS count FROM promotions WHERE title=$1',[title])).rows[0].count).toBe(0)
    expect((await request('trusted','GET',path)).status).toBe(200)
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

  it('fails closed for an inactive venue in existing owner and director sessions',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    expect((await request('owner','GET',path)).status).toBe(200)
    await state.db!.query('UPDATE venues SET active=FALSE WHERE id=101')
    try{
      for(const who of ['trusted','owner']){
        expect((await request(who,'GET',path)).status).toBe(404)
        expect((await request(who,'POST',path,{title:'Inactive venue write'})).status).toBe(404)
      }
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Inactive venue write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query('UPDATE venues SET active=TRUE WHERE id=101')
    }
    expect((await request('owner','GET',path)).status).toBe(200)
  })

  it('fails closed when the owning company is deactivated during active sessions',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    expect((await request('owner','GET',path)).status).toBe(200)
    await state.db!.query('UPDATE companies SET active=FALSE WHERE id=10')
    try{
      for(const who of ['trusted','owner']){
        expect((await request(who,'GET',path)).status).toBe(404)
        expect((await request(who,'POST',path,{title:'Inactive company injection'})).status).toBe(404)
      }
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Inactive company injection'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query('UPDATE companies SET active=TRUE WHERE id=10')
    }
    expect((await request('owner','GET',path)).status).toBe(200)
  })

  it('revokes an existing trusted session immediately when its company grant is removed',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    await state.db!.query('DELETE FROM admin_company_access WHERE admin_id=11 AND company_id=10')
    try{
      expect((await request('trusted','GET',path)).status).toBe(404)
      const revokedList=await request('trusted','GET','/api/admin/venues')
      expect(revokedList.status).toBe(200)
      expect((await revokedList.json() as {venues:{id:string}[]}).venues).not.toContainEqual(expect.objectContaining({id:'101'}))
      expect((await request('trusted','POST',path,{title:'Must not persist'})).status).toBe(404)
      expect((await request('owner','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Must not persist'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(11,10,'trusted')")
    }
  })

  it('revokes an existing owner session immediately after its company grant is removed',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('owner','GET',path)).status).toBe(200)
    await state.db!.query('DELETE FROM admin_company_access WHERE admin_id=12 AND company_id=10')
    try{
      expect((await request('owner','GET',path)).status).toBe(404)
      expect((await request('owner','POST',path,{title:'Revoked owner grant write'})).status).toBe(404)
      expect((await request('trusted','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Revoked owner grant write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query("INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES(12,10,'owner')")
    }
    expect((await request('owner','GET',path)).status).toBe(200)
  })

  it('downgrades an existing owner session to trusted permissions without re-login',async()=>{
    const allowed='/api/admin/venues/101/app/promotions'
    const restricted='/api/admin/venues/101/app/design'
    expect((await request('owner','GET',restricted)).status).toBe(200)
    await state.db!.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=12 AND company_id=10")
    try{
      const denied=await request('owner','GET',restricted)
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({code:'DIRECTOR_READ_FORBIDDEN'})
      const deniedWrite=await request('owner','PUT',restricted,{})
      expect(deniedWrite.status).toBe(403)
      expect(await deniedWrite.json()).toMatchObject({code:'DIRECTOR_WRITE_FORBIDDEN'})
      expect((await request('owner','GET',allowed)).status).toBe(200)
    }finally{
      await state.db!.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=12 AND company_id=10")
    }
    expect((await request('owner','GET',restricted)).status).toBe(200)
  })

  it('fails closed for an unrecognized company access kind in an existing owner session',async()=>{
    const allowed='/api/admin/venues/101/app/promotions'
    const restricted='/api/admin/venues/101/app/design'
    expect((await request('owner','GET',restricted)).status).toBe(200)
    await state.db!.query("UPDATE admin_company_access SET access_kind='unexpected' WHERE admin_id=12 AND company_id=10")
    try{
      const read=await request('owner','GET',restricted)
      expect(read.status).toBe(404)
      expect(await read.json()).toMatchObject({code:'VENUE_NOT_FOUND'})
      const title='Unknown grant must not write'
      const write=await request('owner','POST',allowed,{title})
      expect(write.status).toBe(404)
      expect(await write.json()).toMatchObject({code:'VENUE_NOT_FOUND'})
      expect((await state.db!.query('SELECT COUNT(*)::int AS count FROM promotions WHERE title=$1',[title])).rows[0].count).toBe(0)
      expect((await request('trusted','GET',allowed)).status).toBe(200)
      const venueList=await request('owner','GET','/api/admin/venues')
      expect(venueList.status).toBe(200)
      expect((await venueList.json() as {venues:{id:string}[]}).venues).not.toContainEqual(expect.objectContaining({id:'101'}))
    }finally{
      await state.db!.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=12 AND company_id=10")
    }
    expect((await request('owner','GET',restricted)).status).toBe(200)
  })

  it('rejects an existing trusted session after its account is deactivated',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    await state.db!.query('UPDATE admin_accounts SET active=FALSE WHERE id=11')
    try{
      expect((await request('trusted','GET',path)).status).toBe(401)
      expect((await request('trusted','POST',path,{title:'Inactive director write'})).status).toBe(401)
      expect((await request('owner','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Inactive director write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query('UPDATE admin_accounts SET active=TRUE WHERE id=11')
    }
  })

  it('rejects an existing owner session after its account is deactivated',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('owner','GET',path)).status).toBe(200)
    await state.db!.query('UPDATE admin_accounts SET active=FALSE WHERE id=12')
    try{
      expect((await request('owner','GET',path)).status).toBe(401)
      expect((await request('owner','POST',path,{title:'Inactive owner write'})).status).toBe(401)
      expect((await request('trusted','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Inactive owner write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query('UPDATE admin_accounts SET active=TRUE WHERE id=12')
    }
  })

  it('loses platform privileges immediately after role downgrade in an existing session',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('root','GET',path)).status).toBe(200)
    await state.db!.query("UPDATE admin_accounts SET role='VENUE_ADMIN' WHERE id=1")
    try{
      expect((await request('root','GET',path)).status).toBe(404)
      expect((await request('root','POST',path,{title:'Downgraded root write'})).status).toBe(404)
      expect((await request('owner','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Downgraded root write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query("UPDATE admin_accounts SET role='SUPER_ADMIN' WHERE id=1")
    }
    expect((await request('root','GET',path)).status).toBe(200)
  })

  it('allows changing only the signed-in directors password and keeps owner credentials',async()=>{
    const before=(await state.db!.query('SELECT password_hash FROM admin_accounts WHERE id=12')).rows
    const r=await request('trusted','POST','/api/admin/auth/password',{currentPassword:password,newPassword:'New-Fixture-Password-2026!'})
    expect(r.status).toBe(200)
    expect((await state.db!.query('SELECT password_hash FROM admin_accounts WHERE id=12')).rows).toEqual(before)
    expect((await request('trusted','GET','/api/admin/auth/session')).status).toBe(200)
  })

  it('rejects an expired trusted session with its original cookie and CSRF token',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    await state.db!.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE admin_id=11")
    try{
      expect((await request('trusted','GET',path)).status).toBe(401)
      expect((await request('trusted','POST',path,{title:'Expired session write'})).status).toBe(401)
      expect((await request('owner','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Expired session write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE admin_id=11")
    }
  })

  it('rejects an expired owner session without affecting a trusted director session',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('owner','GET',path)).status).toBe(200)
    await state.db!.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE admin_id=12")
    try{
      expect((await request('owner','GET',path)).status).toBe(401)
      expect((await request('owner','POST',path,{title:'Expired owner session write'})).status).toBe(401)
      expect((await request('trusted','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Expired owner session write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 day' WHERE admin_id=12")
    }
    expect((await request('owner','GET',path)).status).toBe(200)
  })

  it('rejects a revoked trusted session even when its old cookie and CSRF token are reused',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    await state.db!.query('DELETE FROM admin_sessions WHERE admin_id=11')
    expect((await request('trusted','GET',path)).status).toBe(401)
    expect((await request('trusted','POST',path,{title:'Revoked session write'})).status).toBe(401)
    expect((await request('owner','GET',path)).status).toBe(200)
    expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Revoked session write'")).rows[0].count).toBe(0)
    // Restore an independent director login for subsequent isolation tests.
    // The director password was rotated in an earlier test.
    const login=await fetch(origin+'/api/admin/auth/login',{
      method:'POST',
      headers:{origin:'https://director.fixture.invalid','content-type':'application/json'},
      body:JSON.stringify({email:'trusted@fixture.invalid',password:'New-Fixture-Password-2026!'}),
    })
    expect(login.status).toBe(200)
    const body=await login.json() as {csrfToken:string}
    sessions.set('trusted',{cookie:login.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrfToken})
    expect((await request('trusted','GET',path)).status).toBe(200)
  })


  it('rejects a revoked owner session while preserving the trusted director session',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('owner','GET',path)).status).toBe(200)
    const prior=sessions.get('owner')!
    await state.db!.query('DELETE FROM admin_sessions WHERE admin_id=12')
    try{
      expect((await request('owner','GET',path)).status).toBe(401)
      expect((await request('owner','POST',path,{title:'Revoked owner session write'})).status).toBe(401)
      expect((await request('trusted','GET',path)).status).toBe(200)
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Revoked owner session write'")).rows[0].count).toBe(0)
    }finally{
      const login=await fetch(origin+'/api/admin/auth/login',{
        method:'POST',
        headers:{origin:'https://director.fixture.invalid','content-type':'application/json'},
        body:JSON.stringify({email:'owner@fixture.invalid',password}),
      })
      expect(login.status).toBe(200)
      const body=await login.json() as {csrfToken:string}
      sessions.set('owner',{cookie:login.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrfToken})
    }
    expect((await request('owner','GET',path)).status).toBe(200)
    expect(prior.cookie).not.toBe(sessions.get('owner')!.cookie)
  })

  it('revokes a second existing owner session after a password change without revoking the current session',async()=>{
    const loginResponse=await fetch(origin+'/api/admin/auth/login',{
      method:'POST',
      headers:{origin:'https://director.fixture.invalid','content-type':'application/json'},
      body:JSON.stringify({email:'owner@fixture.invalid',password}),
    })
    expect(loginResponse.status).toBe(200)
    const otherCookie=loginResponse.headers.get('set-cookie')!.split(';')[0]!
    const {csrfToken:otherCsrf}=await loginResponse.json() as {csrfToken:string}
    const path='/api/admin/venues/101/app/promotions'
    const otherRequest=(method:string,body?:unknown)=>fetch(origin+path,{
      method,
      headers:{cookie:otherCookie,origin:'https://director.fixture.invalid','content-type':'application/json','x-csrf-token':otherCsrf},
      ...(method==='GET'?{}:{body:JSON.stringify(body)}),
    })
    expect((await otherRequest('GET')).status).toBe(200)
    const changed=await request('owner','POST','/api/admin/auth/password',{
      currentPassword:password,newPassword:'Owner-Rotated-Fixture-2026!',
    })
    expect(changed.status).toBe(200)
    const loginWith=(candidate:string)=>fetch(origin+'/api/admin/auth/login',{
      method:'POST',
      headers:{origin:'https://director.fixture.invalid','content-type':'application/json'},
      body:JSON.stringify({email:'owner@fixture.invalid',password:candidate}),
    })
    const staleLogin=await loginWith(password)
    expect(staleLogin.status).toBe(401)
    expect(await staleLogin.json()).toMatchObject({code:'INVALID_CREDENTIALS'})
    expect((await loginWith('Owner-Rotated-Fixture-2026!')).status).toBe(200)
    expect((await otherRequest('GET')).status).toBe(401)
    expect((await otherRequest('POST',{title:'Stale owner session write'})).status).toBe(401)
    expect((await request('owner','GET',path)).status).toBe(200)
    expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Stale owner session write'")).rows[0].count).toBe(0)
  })

  it('rejects out-of-range BIGINT venue IDs before SQL for existing sessions',async()=>{
    const invalidId='9223372036854775808'
    const title='Overflow venue must not persist'
    for(const who of ['trusted','owner','root']){
      const path='/api/admin/venues/'+invalidId+'/app/promotions'
      for(const method of ['GET','POST']){
        const response=await request(who,method,path,{title})
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({code:'INVALID_ID'})
      }
    }
    expect((await state.db!.query('SELECT COUNT(*)::int AS count FROM promotions WHERE title=$1',[title])).rows[0].count).toBe(0)
    expect((await request('owner','GET','/api/admin/venues/101/app/promotions')).status).toBe(200)
  })


  it('denies a deactivated venue in existing sessions and venue discovery',async()=>{
    const path='/api/admin/venues/101/app/promotions'
    expect((await request('trusted','GET',path)).status).toBe(200)
    await state.db!.query('UPDATE venues SET active=FALSE WHERE id=101')
    try{
      for(const who of ['trusted','owner','root']){
        expect((await request(who,'GET',path)).status).toBe(404)
        expect((await request(who,'POST',path,{title:'Disabled venue write'})).status).toBe(404)
        const listing=await request(who,'GET','/api/admin/venues')
        expect(listing.status).toBe(200)
        expect((await listing.json() as {venues:{id:string}[]}).venues).not.toContainEqual(expect.objectContaining({id:'101'}))
      }
      expect((await state.db!.query("SELECT COUNT(*)::int AS count FROM promotions WHERE title='Disabled venue write'")).rows[0].count).toBe(0)
    }finally{
      await state.db!.query('UPDATE venues SET active=TRUE WHERE id=101')
    }
    expect((await request('trusted','GET',path)).status).toBe(200)
  })
})
