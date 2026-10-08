// @vitest-environment node

import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import type { AdminPrincipal } from '../types.js'

const url=String(process.env.ADMIN_INTEGRATION_TEST_DATABASE_URL||'')
let safe=false
try{safe=/^codex_admin_test(?:_|$)/.test(new URL(url).pathname.replace(/^\/+/,''))}catch{safe=false}
const suite=url&&safe?describe:describe.skip
const {Pool}=pg
const setup=url?new Pool({connectionString:url,ssl:false}):null

suite('Phase C PostgreSQL tenant + financial integration',()=>{
  let pivnikAdmin:AdminPrincipal,northAdmin:AdminPrincipal,superAdmin:AdminPrincipal
  let pivnikVenue='',northVenue='',pivnikUser='',northUser=''

  beforeAll(async()=>{
    if(!setup)throw new Error('Missing integration DB.')
    process.env.ADMIN_DATABASE_URL=url
    process.env.ADMIN_READ_DATABASE_URL=url
    process.env.ADMIN_PRODUCTION_WRITE_DATABASE_URL=url
    process.env.ADMIN_ENABLE_WRITES='true'
    process.env.ADMIN_ENABLE_PRODUCTION_BONUS_WRITES='true'
    process.env.ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES='true'
    process.env.ADMIN_CSRF_SECRET='integration-only-csrf-secret-1234567890'
    await setup.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;

      CREATE TABLE bars(id BIGSERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,address TEXT,active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE users(id BIGSERIAL PRIMARY KEY,first_name TEXT NOT NULL,last_name TEXT,username TEXT,photo_url TEXT,role TEXT NOT NULL DEFAULT 'client',created_at TIMESTAMPTZ DEFAULT NOW(),merged_into_user_id BIGINT,deleted_at TIMESTAMPTZ);
      CREATE TABLE bar_customers(bar_id BIGINT REFERENCES bars(id),user_id BIGINT REFERENCES users(id),status TEXT NOT NULL DEFAULT 'active',joined_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(bar_id,user_id));
      CREATE TABLE user_identities(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),provider TEXT NOT NULL,provider_user_id TEXT NOT NULL,provider_username TEXT,profile_url TEXT,UNIQUE(provider,provider_user_id));
      CREATE TABLE wallets(user_id BIGINT PRIMARY KEY REFERENCES users(id),balance BIGINT NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
      CREATE TABLE beer_loyalty(user_id BIGINT PRIMARY KEY REFERENCES users(id),paid_ml_total BIGINT DEFAULT 0,gift_ml_balance INTEGER DEFAULT 0);
      CREATE TABLE transactions(
        id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,client_id BIGINT REFERENCES users(id),staff_id BIGINT,
        mode TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'completed',check_amount_cents BIGINT DEFAULT 0,
        discount_cents BIGINT DEFAULT 0,bonus_spent BIGINT DEFAULT 0,bonus_earned BIGINT DEFAULT 0,cash_paid_cents BIGINT DEFAULT 0,
        balance_after BIGINT,reason TEXT,reward_code TEXT,is_suspicious BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),completed_at TIMESTAMPTZ
      );
      CREATE TABLE reward_grants(
        code TEXT NOT NULL,user_id BIGINT REFERENCES users(id),amount BIGINT NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'system',created_at TIMESTAMPTZ DEFAULT NOW(),
        achievement_code TEXT,achievement_period TEXT,reward_beer_ml BIGINT NOT NULL DEFAULT 0,announced_at TIMESTAMPTZ,
        PRIMARY KEY(code,user_id)
      );
      CREATE TABLE user_achievements_v2(
        id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),achievement_code TEXT NOT NULL,is_granted BOOLEAN DEFAULT FALSE,
        granted_at TIMESTAMPTZ,current_progress NUMERIC DEFAULT 0,required_progress NUMERIC DEFAULT 1,last_progress_check_at TIMESTAMPTZ,
        UNIQUE(user_id,achievement_code)
      );
      CREATE TABLE user_frames(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),frame_id TEXT NOT NULL,acquired_source TEXT,UNIQUE(user_id,frame_id));
      CREATE TABLE wheel_spins(id BIGSERIAL PRIMARY KEY,user_id BIGINT REFERENCES users(id),kind TEXT DEFAULT 'free',prize_code TEXT,charged_bonus_cost BIGINT DEFAULT 0,bonus_awarded BIGINT DEFAULT 0,beer_awarded_ml INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE shop_items(id BIGSERIAL PRIMARY KEY,code TEXT UNIQUE,title TEXT,subtitle TEXT,category TEXT,price_type TEXT,bonus_price BIGINT DEFAULT 0,cash_price BIGINT DEFAULT 0,image_src TEXT,active BOOLEAN DEFAULT TRUE,sort_order INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE shop_purchases(id BIGSERIAL PRIMARY KEY,request_key TEXT UNIQUE,user_id BIGINT REFERENCES users(id),item_code TEXT,bonus_price BIGINT DEFAULT 0,transaction_id BIGINT UNIQUE,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE promotions(id BIGSERIAL PRIMARY KEY,code TEXT UNIQUE,title TEXT,description TEXT,badge TEXT,image_src TEXT,active BOOLEAN DEFAULT TRUE,sort_order INTEGER DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE app_settings(id INTEGER PRIMARY KEY,published JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());
    `)
    const b1=await setup.query<{id:string}>(`INSERT INTO bars(code,name,address) VALUES('pivnik','ПИВНИК','Pivnik Test') RETURNING id::text`)
    const b2=await setup.query<{id:string}>(`INSERT INTO bars(code,name,address) VALUES('north-test','NORTH BAR · TEST','North Test') RETURNING id::text`)
    const u1=await setup.query<{id:string}>(`INSERT INTO users(first_name,last_name,username,created_at) VALUES('Анна','PIVNIK','anna',NOW()-INTERVAL '20 days') RETURNING id::text`)
    const u2=await setup.query<{id:string}>(`INSERT INTO users(first_name,last_name,username,created_at) VALUES('Ник','NORTH','nick',NOW()-INTERVAL '20 days') RETURNING id::text`)
    pivnikUser=u1.rows[0]!.id;northUser=u2.rows[0]!.id
    await setup.query(`INSERT INTO bar_customers(bar_id,user_id) VALUES($1,$2),($3,$4)`,[b1.rows[0]!.id,pivnikUser,b2.rows[0]!.id,northUser])
    await setup.query(`INSERT INTO wallets(user_id,balance) VALUES($1,500),($2,700)`,[pivnikUser,northUser])
    await setup.query(`INSERT INTO beer_loyalty(user_id) VALUES($1),($2)`,[pivnikUser,northUser])
    await setup.query(`INSERT INTO user_identities(user_id,provider,provider_user_id) VALUES($1,'telegram','tg-p'),($2,'vk','vk-n')`,[pivnikUser,northUser])
    await setup.query(`INSERT INTO transactions(request_key,client_id,mode,status,check_amount_cents,cash_paid_cents,bonus_earned,completed_at)
      VALUES('seed-p',$1,'accrue','completed',2000,2000,100,NOW()-INTERVAL '1 day'),('seed-n',$2,'accrue','completed',9000,9000,450,NOW()-INTERVAL '1 day')`,[pivnikUser,northUser])

    for(const file of ['001_admin_core.sql','002_configuration_foundation.sql','003_phase_c_write_safety.sql'])
      await setup.query(await fs.readFile(path.resolve('admin-migrations',file),'utf8'))

    const pc=await setup.query<{id:string}>(`SELECT id::text FROM companies WHERE code='pivnik'`)
    const pv=await setup.query<{id:string}>(`SELECT id::text FROM venues WHERE code='pivnik'`)
    pivnikVenue=pv.rows[0]!.id
    const nc=await setup.query<{id:string}>(`INSERT INTO companies(code,name) VALUES('north-hospitality-test','NORTH HOSPITALITY · TEST') RETURNING id::text`)
    const nv=await setup.query<{id:string}>(`INSERT INTO venues(company_id,code,name,address,legacy_bar_id) VALUES($1,'north-bar-test','NORTH BAR · TEST','Synthetic',$2) RETURNING id::text`,[nc.rows[0]!.id,b2.rows[0]!.id])
    northVenue=nv.rows[0]!.id

    async function admin(email:string,name:string,role:string){
      return (await setup!.query<{id:string}>(`INSERT INTO admin_accounts(email,display_name,role,password_hash) VALUES($1,$2,$3,'test-hash') RETURNING id::text`,[email,name,role])).rows[0]!.id
    }
    const pa=await admin('pivnik@test','Pivnik Admin','VENUE_ADMIN'),na=await admin('north@test','North Admin','VENUE_ADMIN'),sa=await admin('root@test','Root','SUPER_ADMIN')
    await setup.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1,$2,'owner'),($3,$4,'owner')`,[pa,pc.rows[0]!.id,na,nc.rows[0]!.id])
    pivnikAdmin={id:pa,email:'pivnik@test',displayName:'Pivnik Admin',role:'VENUE_ADMIN'}
    northAdmin={id:na,email:'north@test',displayName:'North Admin',role:'VENUE_ADMIN'}
    superAdmin={id:sa,email:'root@test',displayName:'Root',role:'SUPER_ADMIN'}
  },30_000)

  afterAll(async()=>{await setup?.end();const {closePool}=await import('../db.js');await closePool()})

  it('read pool is transaction-read-only',async()=>{
    const {readPool}=await import('../db.js')
    expect((await readPool.query<{default_transaction_read_only:string}>('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only).toBe('on')
    await expect(readPool.query(`UPDATE wallets SET balance=0 WHERE user_id=$1`,[pivnikUser])).rejects.toBeTruthy()
  })

  it('NORTH admin sees NORTH but not PIVNIK',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    expect((await resolveVenueScope(northAdmin,northVenue)).companyCode).toBe('north-hospitality-test')
    await expect(resolveVenueScope(northAdmin,pivnikVenue)).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
  })

  it('PIVNIK admin cannot resolve NORTH',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    await expect(resolveVenueScope(pivnikAdmin,northVenue)).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
  })

  it('SUPER ADMIN resolves both but legacy NORTH analytics is intentionally blocked',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {getVenueDashboard}=await import('../data.js')
    expect((await resolveVenueScope(superAdmin,pivnikVenue)).companyCode).toBe('pivnik')
    const north=await resolveVenueScope(superAdmin,northVenue)
    await expect(getVenueDashboard(north,{from:new Date(Date.now()-86400000),to:new Date(),days:1})).rejects.toMatchObject({code:'LEGACY_ADAPTER_NOT_TENANT_SAFE'})
  })

  it('PIVNIK bonus credit updates wallet + ledger + audit',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {adjustPivnikBonus}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    const result=await adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,{type:'credit',amount:200,reason:'Integration credit',idempotencyKey:'credit:integration:1'})
    expect(result.balanceBefore).toBe(500);expect(result.balanceAfter).toBe(700)
    expect(Number((await setup!.query(`SELECT balance FROM wallets WHERE user_id=$1`,[pivnikUser])).rows[0]!.balance)).toBe(700)
    expect(Number((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='customer.bonus.credit'`)).rows[0]!.n)).toBe(1)
  })

  it('duplicate bonus request is idempotent',async()=>{
    const {resolveVenueScope}=await import('../tenant.js');const {adjustPivnikBonus}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    const body={type:'credit',amount:50,reason:'Idempotency check',idempotencyKey:'credit:integration:duplicate'}
    const a=await adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,body),b=await adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,body)
    expect(a.balanceAfter).toBe(b.balanceAfter);expect(b.idempotent).toBe(true)
    expect(Number((await setup!.query(`SELECT COUNT(*) AS n FROM transactions WHERE request_key=$1`,[`admin:${pivnikVenue}:credit:integration:duplicate`])).rows[0]!.n)).toBe(1)
  })

  it('insufficient balance is protected',async()=>{
    const {resolveVenueScope}=await import('../tenant.js');const {adjustPivnikBonus}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    await expect(adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,{type:'debit',amount:999999,reason:'Too much',idempotencyKey:'debit:too-much:1'})).rejects.toMatchObject({code:'INSUFFICIENT_BALANCE'})
  })

  it('foreign user id substitution is denied',async()=>{
    const {resolveVenueScope}=await import('../tenant.js');const {adjustPivnikBonus}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    await expect(adjustPivnikBonus(pivnikAdmin,scope,northUser,{type:'credit',amount:10,reason:'Must fail',idempotencyKey:'foreign:user:1'})).rejects.toMatchObject({code:'CUSTOMER_NOT_FOUND'})
  })

  it('two concurrent debits cannot overspend one wallet',async()=>{
    await setup!.query(`UPDATE wallets SET balance=100 WHERE user_id=$1`,[pivnikUser])
    const {resolveVenueScope}=await import('../tenant.js');const {adjustPivnikBonus}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    const results=await Promise.allSettled([
      adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,{type:'debit',amount:80,reason:'Concurrent A',idempotencyKey:'concurrent:a:1'}),
      adjustPivnikBonus(pivnikAdmin,scope,pivnikUser,{type:'debit',amount:80,reason:'Concurrent B',idempotencyKey:'concurrent:b:1'}),
    ])
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1)
    expect(Number((await setup!.query(`SELECT balance FROM wallets WHERE user_id=$1`,[pivnikUser])).rows[0]!.balance)).toBe(20)
  })

  it('loyalty config persists valid ordered levels, rejects invalid thresholds and audits the mutation',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {getManagedLoyalty,saveLoyalty}=await import('../writes.js')
    const scope=await resolveVenueScope(northAdmin,northVenue)
    const valid={baseCashbackPercent:6,registrationBonus:125,referralBonus:75,levels:[
      {code:'start',title:'Start',thresholdRub:0,bonusPercent:5,discountPercent:0,enabled:true,sortOrder:0},
      {code:'regular',title:'Regular',thresholdRub:10_000,bonusPercent:7,discountPercent:0,enabled:true,sortOrder:1},
      {code:'vip',title:'VIP',thresholdRub:50_000,bonusPercent:10,discountPercent:2,enabled:true,sortOrder:2},
    ]}
    await saveLoyalty(northAdmin,scope,valid)
    const saved=await getManagedLoyalty(scope)
    expect(saved.levels.map(level=>level.code)).toEqual(['start','regular','vip'])
    expect(saved.levels.map(level=>level.thresholdRub)).toEqual([0,10_000,50_000])
    await expect(saveLoyalty(northAdmin,scope,{...valid,levels:[
      {...valid.levels[0],thresholdRub:100},
      {...valid.levels[1],thresholdRub:100},
    ]})).rejects.toMatchObject({code:'INVALID_LEVEL_THRESHOLDS'})
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE venue_id=$1 AND action='loyalty.config.save'`,[northVenue])).rows[0]!.n).toBe('1')
  })

  it('NORTH wheel preserves exact tiny probability, ignores disabled prizes, rejects invalid total and stays tenant scoped',async()=>{
    const {resolveVenueScope}=await import('../tenant.js');const {saveWheel,getManagedWheel}=await import('../writes.js')
    const north=await resolveVenueScope(northAdmin,northVenue)
    const valid={enabled:true,cooldownMinutes:60,retryCost:10,prizes:[
      {code:'north-rare',title:'NORTH Rare',rewardType:'item',rewardValue:{code:'north-rare'},probability:'0.0000001',inventoryLimit:1,enabled:true,sortOrder:0},
      {code:'north-rest',title:'NORTH Rest',rewardType:'none',rewardValue:{},probability:'99.9999999',inventoryLimit:null,enabled:true,sortOrder:1},
      {code:'north-disabled',title:'Disabled',rewardType:'bonus',rewardValue:{amount:10},probability:'50',inventoryLimit:0,enabled:false,sortOrder:2},
    ]}
    await saveWheel(northAdmin,north,valid)
    const saved=await getManagedWheel(north)
    expect(saved.prizes.map(prize=>prize.probability)).toEqual(['0.0000001','99.9999999','50'])
    expect(saved.prizes[2]?.enabled).toBe(false)
    await expect(saveWheel(northAdmin,north,{...valid,prizes:[{...valid.prizes[1],probability:'99.9'}]})).rejects.toMatchObject({code:'WHEEL_PROBABILITY_TOTAL'})
    await expect(resolveVenueScope(northAdmin,pivnikVenue)).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM wheel_prizes WHERE venue_id=$1`,[pivnikVenue])).rows[0]!.n).toBe('0')
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE venue_id=$1 AND action='wheel.config.save'`,[northVenue])).rows[0]!.n).toBe('1')
  })

  it('manual achievement grant writes reward_grants + user achievement + bonus exactly once',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {saveAchievements,manualGrantAchievement}=await import('../writes.js')
    const scope=await resolveVenueScope(pivnikAdmin,pivnikVenue)
    await saveAchievements(pivnikAdmin,scope,{items:[{
      code:'admin-test-achievement',title:'Admin Test',description:'Integration',conditionType:'manual',
      thresholdValue:1,rewardValue:{bonus:25},visibility:'public',enabled:true,sortOrder:0,
    }]})
    await setup!.query(`UPDATE wallets SET balance=100 WHERE user_id=$1`,[pivnikUser])
    const body={achievementCode:'admin-test-achievement',reason:'Approved integration grant',idempotencyKey:'achievement:integration:1'}
    const first=await manualGrantAchievement(pivnikAdmin,scope,pivnikUser,body)
    expect(first.balanceAfter).toBe(125)
    expect(Number((await setup!.query(`SELECT COUNT(*) AS n FROM reward_grants WHERE user_id=$1 AND achievement_code='admin-test-achievement'`,[pivnikUser])).rows[0]!.n)).toBe(1)
    expect((await setup!.query(`SELECT is_granted FROM user_achievements_v2 WHERE user_id=$1 AND achievement_code='admin-test-achievement'`,[pivnikUser])).rows[0]!.is_granted).toBe(true)
    const duplicate=await manualGrantAchievement(pivnikAdmin,scope,pivnikUser,body)
    expect(duplicate.idempotent).toBe(true)
    await expect(manualGrantAchievement(pivnikAdmin,scope,pivnikUser,{...body,idempotencyKey:'achievement:integration:2'})).rejects.toMatchObject({code:'ACHIEVEMENT_ALREADY_GRANTED'})
    expect(Number((await setup!.query(`SELECT balance FROM wallets WHERE user_id=$1`,[pivnikUser])).rows[0]!.balance)).toBe(125)
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='customer.achievement.grant'`)).rows[0]!.n).toBe('1')
  })

  it('shop config preserves stock, limits and disabled state in tenant-owned config',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {saveShop,getManagedShop}=await import('../writes.js')
    const scope=await resolveVenueScope(northAdmin,northVenue)
    await saveShop(northAdmin,scope,{items:[
      {code:'north-frame',title:'NORTH Frame',description:'Digital frame',category:'digital',rewardType:'frame',rewardValue:{code:'north'},bonusPrice:900,stock:5,purchaseLimit:1,enabled:true,sortOrder:0},
      {code:'north-off',title:'Disabled item',description:'Off',category:'other',rewardType:'item',rewardValue:{code:'off'},bonusPrice:100,stock:0,purchaseLimit:1,enabled:false,sortOrder:1},
    ]})
    const shop=await getManagedShop(scope)
    expect(shop.items).toHaveLength(2)
    expect(Number((shop.items[0] as any).stock)).toBe(5)
    expect(Number((shop.items[0] as any).purchase_limit)).toBe(1)
    expect((shop.items[1] as any).enabled).toBe(false)
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE venue_id=$1 AND action='shop.config.save'`,[northVenue])).rows[0]!.n).toBe('1')
  })

  it('promotion config derives draft, scheduled, active, finished and disabled states and audits the mutation',async()=>{
    const {resolveVenueScope}=await import('../tenant.js')
    const {getManagedPromotions,savePromotions}=await import('../writes.js')
    const scope=await resolveVenueScope(northAdmin,northVenue)
    const now=Date.now()
    await savePromotions(northAdmin,scope,{items:[
      {code:'draft',title:'Draft',description:'Draft',startsAt:null,endsAt:null,mechanic:{},reward:{},multiplier:null,enabled:false,sortOrder:0},
      {code:'scheduled',title:'Scheduled',description:'Scheduled',startsAt:new Date(now+86_400_000).toISOString(),endsAt:new Date(now+172_800_000).toISOString(),mechanic:{},reward:{},multiplier:null,enabled:true,sortOrder:1},
      {code:'active',title:'Active',description:'Active',startsAt:new Date(now-86_400_000).toISOString(),endsAt:new Date(now+86_400_000).toISOString(),mechanic:{},reward:{},multiplier:2,enabled:true,sortOrder:2},
      {code:'finished',title:'Finished',description:'Finished',startsAt:new Date(now-172_800_000).toISOString(),endsAt:new Date(now-86_400_000).toISOString(),mechanic:{},reward:{},multiplier:null,enabled:true,sortOrder:3},
      {code:'disabled',title:'Disabled',description:'Disabled',startsAt:new Date(now-86_400_000).toISOString(),endsAt:new Date(now+86_400_000).toISOString(),mechanic:{},reward:{},multiplier:null,enabled:false,sortOrder:4},
    ]})
    const saved=await getManagedPromotions(scope)
    expect(Object.fromEntries(saved.items.map((item:any)=>[item.code,item.state]))).toEqual({
      draft:'DRAFT',scheduled:'SCHEDULED',active:'ACTIVE',finished:'FINISHED',disabled:'DISABLED',
    })
    expect((await setup!.query(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE venue_id=$1 AND action='promotions.config.save'`,[northVenue])).rows[0]!.n).toBe('1')
  })

})
