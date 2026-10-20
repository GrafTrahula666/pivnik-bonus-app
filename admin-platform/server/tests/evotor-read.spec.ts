// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe,it,expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { evotorPeriod,getEvotorReport } from '../evotor-read.js'
import { buildVenueScopeQuery } from '../tenant.js'
import type { VenueScope } from '../types.js'

const scope:VenueScope={id:'101',companyId:'10',companyCode:'anything',companyName:'A',code:'A',name:'A',address:null,legacyBarId:null}
const range=evotorPeriod(new URL('https://fixture.invalid/?days=1'),new Date('2026-10-01T21:00:00Z'))

describe('Evotor cash adapter on disposable PostgreSQL/WASM',()=>{
  it('uses Moscow calendar dates, not rolling 24 hours',()=>{
    expect(range.from.toISOString()).toBe('2026-10-01T21:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-10-02T21:00:00.000Z')
  })
  it('selects yesterday and arbitrary valid calendar days with exclusive Moscow midnight bounds',()=>{
    const now=new Date('2026-10-10T21:30:00Z') // Already October 11 in Moscow.
    for(const date of ['2026-10-10','2026-09-30','2024-02-29']){
      const selected=evotorPeriod(new URL('https://fixture.invalid/?date='+date),now)
      expect(selected.from.getTime()).toBe(Date.parse(date+'T00:00:00+03:00'))
      expect(selected.to.getTime()-selected.from.getTime()).toBe(86400000)
      expect(selected.days).toBe(1)
    }
    const fortnight=evotorPeriod(new URL('https://fixture.invalid/?days=14'),now)
    expect(fortnight.from.toISOString()).toBe('2026-09-27T21:00:00.000Z')
    expect(fortnight.to.toISOString()).toBe('2026-10-11T21:00:00.000Z')
    expect(fortnight.days).toBe(14)
    for(const date of ['','2026-02-29','2026-04-31','2026-10-12','not-a-date','2026-1-1','2026-10-10T00:00:00Z']){
      expect(()=>evotorPeriod(new URL('https://fixture.invalid/?date='+date),now)).toThrowError(expect.objectContaining({statusCode:400,code:'INVALID_PERIOD'}))
    }
  })
  it('accepts inclusive comparison ranges and rejects reversed, ambiguous, malformed or excessive ranges',()=>{
    const now=new Date('2026-10-11T10:00:00Z')
    const selected=evotorPeriod(new URL('https://fixture.invalid/?from=2026-09-01&to=2026-09-07'),now)
    expect(selected.from.toISOString()).toBe('2026-08-31T21:00:00.000Z')
    expect(selected.to.toISOString()).toBe('2026-09-07T21:00:00.000Z')
    expect(selected.days).toBe(7)
    expect(evotorPeriod(new URL('https://fixture.invalid/?from=2024-01-01&to=2024-12-31'),now).days).toBe(366)
    for(const query of ['from=2026-09-08&to=2026-09-07','from=2026-09-01','to=2026-09-07',
      'from=2026-02-30&to=2026-03-02','from=2024-01-01&to=2025-01-01',
      'from=2026-10-11&to=2026-10-12','date=2026-10-01&from=2026-09-01&to=2026-09-07']){
      expect(()=>evotorPeriod(new URL('https://fixture.invalid/?'+query),now)).toThrowError(expect.objectContaining({statusCode:400,code:'INVALID_PERIOD'}))
    }
  })
  it('resolves company access first and selects only an explicit company/venue store mapping',async()=>{
    const db=new PGlite()
    try{
      await db.exec(`CREATE TABLE users(id BIGINT PRIMARY KEY,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);
        INSERT INTO users VALUES(1,NULL,NULL),(3,NULL,NULL);
        CREATE TABLE companies(id BIGINT PRIMARY KEY,code TEXT,name TEXT,active BOOLEAN);
        CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT,code TEXT,name TEXT,address TEXT,legacy_bar_id BIGINT,active BOOLEAN);
        CREATE TABLE admin_company_access(company_id BIGINT,admin_id BIGINT);
        INSERT INTO companies VALUES(10,'a','A',TRUE),(20,'b','B',TRUE);
        INSERT INTO venues VALUES(101,10,'a','A',NULL,NULL,TRUE),(202,20,'b','B',NULL,NULL,TRUE);
        INSERT INTO admin_company_access VALUES(10,11);`)
      for(const f of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql'])await db.exec(await readFile(new URL('../../../migrations/'+f,import.meta.url),'utf8'))
      await db.exec(`INSERT INTO pos_store_bindings VALUES('a','10','101',TRUE),('b','20','202',TRUE);
        INSERT INTO pos_sync_state(store_id,last_success_at) VALUES('a',NOW()),('b',NOW());`)
      const doc=(id:string,storeId:string,amount:number,type='SELL',baseDocumentId:string|null=null)=>({source:'evotor',documentId:id,storeId,closedAt:'2026-10-02T10:00:00Z',type,amountCents:amount,receiptCount:1,linkable:true,positions:[],payments:[{type:'CASH',method:'',amountCents:amount}],baseDocumentId})
      for(const d of [doc('linked','a',11000),doc('anonymous','a',19000),doc('return','a',1000,'PAYBACK','linked'),doc('foreign','b',99000),
        {...doc('before','a',88000),closedAt:'2026-10-01T20:59:59.999Z'},
        {...doc('after','a',77000),closedAt:'2026-10-02T21:00:00.000Z'}]){
        await db.query(`INSERT INTO pos_documents(source,store_id,document_id,type,closed_at,amount_cents,snapshot)
          VALUES('evotor',$1,$2,$3,$4,$5,$6::jsonb)`,[d.storeId,d.documentId,d.type,d.closedAt,d.amountCents,JSON.stringify(d)])
      }
      await db.query("INSERT INTO pos_customer_links VALUES('evotor','a','linked',1,3,NOW())")
      const query=buildVenueScopeQuery({id:'11',email:'fixture',displayName:'Fixture',role:'VENUE_ADMIN'},'202')
      expect((await db.query(query.text,query.params)).rows).toHaveLength(0)
      const report=await getEvotorReport(db,scope,range)
      expect(report.all?.salesCents).toBe('30000');expect(report.all?.netCents).toBe('29000')
      expect(report.app?.salesCents).toBe('11000');expect(report.app?.netCents).toBe('10000')
      expect(report.unlinked?.salesCents).toBe('19000')
      expect(report.all).not.toHaveProperty('activeBuyers')
      expect(report.app?.activeBuyers).toBe(1)
      const historical=await getEvotorReport(db,scope,evotorPeriod(new URL('https://fixture.invalid/?date=2026-10-02'),new Date('2026-10-11T12:00:00Z')))
      expect(historical.all?.netCents).toBe('29000')
      expect(historical.all?.hours).toEqual([{label:'13',amountCents:'29000'}])
      expect(historical.period.from).toBe('2026-10-01T21:00:00.000Z')
      const compared=await getEvotorReport(db,scope,evotorPeriod(new URL('https://fixture.invalid/?from=2026-10-01&to=2026-10-02'),new Date('2026-10-11T12:00:00Z')))
      expect(compared.all?.salesCents).toBe('118000')
      expect(compared.all?.netCents).toBe('117000')
      expect(compared.app?.salesCents).toBe('11000')
      expect((await getEvotorReport(db,{...scope,id:'202'},range)).all).toBeNull()
      expect((await getEvotorReport(db,{...scope,companyId:'20'},range)).all).toBeNull()
      await db.query("UPDATE pos_store_bindings SET enabled=FALSE WHERE store_id='a'")
      expect((await getEvotorReport(db,scope,range)).all).toBeNull()
    }finally{await db.close()}
  })
  it('schema absence never supplies loyalty amounts or invented zeros',async()=>{
    const db=new PGlite()
    try{const report=await getEvotorReport(db,scope,range);expect(report.all).toBeNull();expect(report.connection.state).toBe('schema_required')}
    finally{await db.close()}
  })
})
