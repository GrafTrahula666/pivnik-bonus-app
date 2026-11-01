// @vitest-environment node
import { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import type { AdminPrincipal } from '../types.js'

// An isolated, in-memory PostgreSQL fixture exercises the real scoped SQL.
// No production DB URL, HTTP session or wallet writer is involved.
const state=vi.hoisted(()=>({db:null as PGlite|null}))
vi.mock('../db.js',()=>{
  const query=async(text:string,params?:unknown[])=>{
    if(!state.db)throw new Error('Loyalty test database not initialized')
    const result=await state.db.query(text,params)
    return {...result,rowCount:result.rows.length||result.affectedRows||0}
  }
  const pool={query}
  return {pool,readPool:pool,writePool:null}
})

const pivnikAdmin:AdminPrincipal={id:'11',email:'pivnik@fixture.invalid',displayName:'Pivnik',role:'VENUE_ADMIN'}
const northAdmin:AdminPrincipal={id:'12',email:'north@fixture.invalid',displayName:'North',role:'VENUE_ADMIN'}

describe('tenant-scoped loyalty settings (in-memory PostgreSQL)',()=>{
  let resolveVenueScope:typeof import('../tenant.js').resolveVenueScope
  let getManagedLoyalty:typeof import('../writes.js').getManagedLoyalty

  beforeAll(async()=>{
    state.db=new PGlite()
    await state.db.exec(`
      CREATE TABLE companies (
        id BIGINT PRIMARY KEY,code TEXT NOT NULL,name TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE venues (
        id BIGINT PRIMARY KEY,company_id BIGINT NOT NULL,code TEXT NOT NULL,name TEXT NOT NULL,
        address TEXT,legacy_bar_id BIGINT,active BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE admin_company_access (
        admin_id BIGINT NOT NULL,company_id BIGINT NOT NULL,access_kind TEXT NOT NULL
      );
      CREATE TABLE venue_settings (
        venue_id BIGINT PRIMARY KEY,base_cashback_percent NUMERIC,
        registration_bonus BIGINT,referral_bonus BIGINT
      );
      CREATE TABLE loyalty_levels (
        id BIGSERIAL PRIMARY KEY,venue_id BIGINT NOT NULL,code TEXT NOT NULL,title TEXT NOT NULL,
        threshold_cents BIGINT NOT NULL,bonus_percent NUMERIC NOT NULL,
        discount_percent NUMERIC NOT NULL,enabled BOOLEAN NOT NULL,sort_order INTEGER NOT NULL
      );
      INSERT INTO companies(id,code,name) VALUES
        (1,'pivnik','ПИВНИК'),(2,'north','North');
      INSERT INTO venues(id,company_id,code,name,legacy_bar_id) VALUES
        (101,1,'pivnik','ПИВНИК',42),
        (102,1,'pivnik-sibling','Соседний зал',NULL),
        (201,2,'north-one','North One',NULL),
        (202,2,'north-two','North Two',NULL);
      INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES
        (11,1,'owner'),(12,2,'owner');
    `)
    resolveVenueScope=(await import('../tenant.js')).resolveVenueScope
    getManagedLoyalty=(await import('../writes.js')).getManagedLoyalty
  })
  afterAll(async()=>{await state.db?.close();state.db=null})

  it('returns unknown instead of invented zeros for an unconfigured unrelated venue',async()=>{
    const north=await resolveVenueScope(northAdmin,'201')
    expect(await getManagedLoyalty(north)).toMatchObject({
      source:'not_configured',baseCashbackPercent:null,
      registrationBonus:null,referralBonus:null,levels:[],
    })
  })

  it('keeps the existing PIVNIK ladder for its exact mapped legacy venue',async()=>{
    const pivnik=await resolveVenueScope(pivnikAdmin,'101')
    const data=await getManagedLoyalty(pivnik)
    expect(data.source).toBe('legacy-fallback')
    expect(data.baseCashbackPercent).toBe(5)
    expect(data.registrationBonus).toBe(100)
    expect(data.levels.length).toBeGreaterThan(0)
  })

  it('does not inherit PIVNIK rules in a sibling venue of the same company',async()=>{
    const sibling=await resolveVenueScope(pivnikAdmin,'102')
    expect(sibling.companyCode).toBe('pivnik')
    expect(await getManagedLoyalty(sibling)).toMatchObject({
      source:'not_configured',baseCashbackPercent:null,registrationBonus:null,levels:[],
    })
  })

  it('uses explicit configured 0 as a real setting for just the selected tenant',async()=>{
    await state.db!.exec(`
      INSERT INTO venue_settings VALUES(201,0,0,0);
      INSERT INTO loyalty_levels(venue_id,code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order)
      VALUES(201,'zero','Zero',0,0,0,TRUE,0);
    `)
    const northOne=await getManagedLoyalty(await resolveVenueScope(northAdmin,'201'))
    expect(northOne).toMatchObject({source:'db',baseCashbackPercent:0,registrationBonus:0,referralBonus:0})
    expect(northOne.levels[0]?.bonusPercent).toBe(0)
    expect((await getManagedLoyalty(await resolveVenueScope(northAdmin,'202'))).source).toBe('not_configured')
    expect((await getManagedLoyalty(await resolveVenueScope(pivnikAdmin,'101'))).source).toBe('legacy-fallback')
  })

  it('does not leak incomplete settings or nullable saved values as explicit zeros',async()=>{
    await state.db!.exec(`
      INSERT INTO venue_settings VALUES(202,NULL,0,0);
      INSERT INTO loyalty_levels(venue_id,code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order)
      VALUES(202,'draft','Draft',0,1,0,TRUE,0);
    `)
    const incomplete=await getManagedLoyalty(await resolveVenueScope(northAdmin,'202'))
    expect(incomplete).toMatchObject({source:'not_configured',baseCashbackPercent:null,registrationBonus:null,levels:[]})
  })

  it('keeps distinct saved values for two configured venues in the same company',async()=>{
    await state.db!.exec(`
      INSERT INTO venues(id,company_id,code,name) VALUES
        (301,2,'north-a','North A'),(302,2,'north-b','North B');
      INSERT INTO venue_settings(venue_id,base_cashback_percent,registration_bonus,referral_bonus)
      VALUES(301,2.5,30,5),(302,12.5,0,150);
      INSERT INTO loyalty_levels(venue_id,code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order)
      VALUES(301,'entry','Entry',0,2.5,0,TRUE,0),(302,'entry','Entry',0,12.5,0,TRUE,0);
    `)
    const first=await getManagedLoyalty(await resolveVenueScope(northAdmin,'301'))
    const second=await getManagedLoyalty(await resolveVenueScope(northAdmin,'302'))
    expect(first).toMatchObject({source:'db',baseCashbackPercent:2.5,registrationBonus:30,referralBonus:5})
    expect(second).toMatchObject({source:'db',baseCashbackPercent:12.5,registrationBonus:0,referralBonus:150})
    expect(first.levels[0]?.bonusPercent).toBe(2.5)
    expect(second.levels[0]?.bonusPercent).toBe(12.5)
    await expect(resolveVenueScope(pivnikAdmin,'301')).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
  })

  it('denies access to any foreign-company venue before reading loyalty settings',async()=>{
    await expect(resolveVenueScope(northAdmin,'101')).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
    await expect(resolveVenueScope(pivnikAdmin,'201')).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
  })
})
