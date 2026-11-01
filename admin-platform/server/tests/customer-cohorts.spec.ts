// @vitest-environment node
import {readFile} from 'node:fs/promises'
import {describe,it,expect} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {loadVerifiedPosCustomerCohorts} from '../customer-cohorts.js'
import type {PeriodRange} from '../types.js'

const range:PeriodRange={from:new Date('2026-10-01T21:00:00Z'),to:new Date('2026-10-02T21:00:00Z'),days:1}
const snapshot=(id:string,{store='a',receipt=true,split=false}={})=>({
  source:'evotor',storeId:store,documentId:id,type:'SELL',
  closedAt:'2026-10-02T10:00:00Z',receiptCount:receipt?1:null,
  linkable:receipt&&!split,fiscal:receipt?[{receiptNumber:12}]:[],
  amountCents:100,positions:[],payments:[],
})
describe('verified POS customer cohorts on isolated PGlite',()=>{
  it('counts active QR-linked single-fiscal SELL from only the scoped store and period',async()=>{
    const db=new PGlite()
    try{
      await db.exec('CREATE TABLE users(id BIGINT PRIMARY KEY,deleted_at TIMESTAMPTZ,merged_into_user_id BIGINT);')
      await db.exec("INSERT INTO users VALUES (1,NULL,NULL),(2,NULL,NULL),(3,NULL,NULL),(4,NOW(),NULL),(5,NULL,1),(6,NULL,NULL)")
      for(const file of ['012_evotor_sales.sql','013_evotor_pos_scope_devices.sql'])
        await db.exec(await readFile(new URL('../../../migrations/'+file,import.meta.url),'utf8'))
      await db.exec("INSERT INTO pos_store_bindings VALUES ('a','company-a','venue-a',TRUE),('b','company-b','venue-b',TRUE)")
      const add=async(id:string,client:number,closedAt:string,{store='a',receipt=true,split=false,type='SELL'}={})=>{
        const doc={...snapshot(id,{store,receipt,split}),closedAt,type}
        await db.query("INSERT INTO pos_documents(source,store_id,document_id,type,closed_at,amount_cents,snapshot) VALUES('evotor',$1,$2,$3,$4,100,$5::jsonb)",[store,id,type,closedAt,JSON.stringify(doc)])
        await db.query("INSERT INTO pos_customer_links(source,store_id,document_id,client_id,confirmed_by) VALUES('evotor',$1,$2,$3,6)",[store,id,client])
      }
      await add('old-1',1,'2026-09-29T10:00:00Z')
      await add('new-1',1,'2026-10-02T10:00:00Z')
      await add('new-2',2,'2026-10-02T10:00:00Z')
      await add('new-3',2,'2026-10-02T11:00:00Z')
      await add('unverified-old',3,'2026-09-29T10:00:00Z',{receipt:false})
      await add('first-3',3,'2026-10-02T12:00:00Z')
      await add('deleted',4,'2026-10-02T10:00:00Z')
      await add('merged',5,'2026-10-02T10:00:00Z')
      await add('split',6,'2026-10-02T10:00:00Z',{split:true})
      await add('foreign',6,'2026-10-02T10:00:00Z',{store:'b'})
      await add('return',6,'2026-10-02T10:00:00Z',{type:'PAYBACK'})
      await add('at-end',6,'2026-10-02T21:00:00Z')
      const result=await loadVerifiedPosCustomerCohorts(db,'a',range)
      expect(result.verifiedBuyers).toBe(3)
      expect(result.firstObservedInPeriod).toBe(2)
      expect(result.returningFromEarlierObserved).toBe(1)
      expect(result.repeatWithinPeriod).toBe(1)
      expect(result.newCustomers).toBeNull()
      expect(result.firstPurchaseEverKnown).toBe(false)
      expect(result.coverage).toBe('observed_imported_verified_links_only')
      expect(JSON.stringify(result)).not.toContain('client_id')
      expect((await loadVerifiedPosCustomerCohorts(db,'b',range)).verifiedBuyers).toBe(1)
      expect((await loadVerifiedPosCustomerCohorts(db,'a',{...range,from:new Date('2026-09-30T21:00:00Z'),to:new Date('2026-10-01T21:00:00Z')})).verifiedBuyers).toBe(0)
    }finally{await db.close()}
  })
  it('rejects malformed scope before any SQL is executed',async()=>{
    const db=new PGlite()
    try{
      await expect(loadVerifiedPosCustomerCohorts(db,'',range)).rejects.toThrow('INVALID_VERIFIED_CUSTOMER_COHORT_SCOPE')
      await expect(loadVerifiedPosCustomerCohorts(db,'a',{...range,to:range.from})).rejects.toThrow('INVALID_VERIFIED_CUSTOMER_COHORT_SCOPE')
    }finally{await db.close()}
  })
})
