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
      for(const d of [doc('linked','a',11000),doc('anonymous','a',19000),doc('return','a',1000,'PAYBACK','linked'),doc('foreign','b',99000)]){
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
