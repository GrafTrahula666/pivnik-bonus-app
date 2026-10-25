// @vitest-environment node
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import fs from 'node:fs/promises'

const state=vi.hoisted(()=>({db:null as PGlite|null}))
vi.mock('../db.js',()=>({
  pool:{
    query:async(sql:string,params?:unknown[])=>{const r=await state.db!.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length}},
    connect:async()=>({query:async(sql:string,params?:unknown[])=>{const r=await state.db!.query(sql,params);return {...r,rowCount:r.affectedRows??r.rows.length}},release:()=>{}}),
  },
  tableExists:async(name:string)=>{
    const result=await state.db!.query<{exists:boolean}>("SELECT to_regclass($1) IS NOT NULL AS exists",['public.'+name])
    return Boolean(result.rows[0]?.exists)
  },
}))
import {addBeerIntake,getBeerIntake,parseBeerArrival} from '../beer-intake.js'
import type {AdminPrincipal,VenueScope} from '../types.js'

const admin:AdminPrincipal={id:'9',email:'test@example.invalid',displayName:'Test',role:'SUPER_ADMIN'}
const venue:VenueScope={id:'1',companyId:'1',companyCode:'pivnik',companyName:'ПИВНИК',code:'pivnik',name:'Пивник',address:null,legacyBarId:null}
const one='11111111-1111-4111-8111-111111111111'
const two='22222222-2222-4222-8222-222222222222'

describe('minimal scoped beer additions',()=>{
 beforeAll(async()=>{
   state.db=new PGlite()
   await state.db.exec("CREATE TABLE venues(id BIGINT PRIMARY KEY); CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY); INSERT INTO venues VALUES(1),(2); INSERT INTO admin_accounts VALUES(9)")
   await state.db.exec('CREATE TABLE admin_audit_log (id BIGSERIAL PRIMARY KEY,admin_id BIGINT,admin_role TEXT,company_id BIGINT,venue_id BIGINT,action TEXT,entity_type TEXT,entity_id TEXT,before_value JSONB,after_value JSONB,reason TEXT,metadata JSONB)')
   const sql=await fs.readFile(new URL('../../admin-migrations/018_beer_intake.sql',import.meta.url),'utf8')
   await state.db.exec(sql)
 })
 beforeEach(async()=>{await state.db!.exec('TRUNCATE admin_beer_intake_operations,admin_beer_intake_balance,admin_audit_log')})
 afterAll(async()=>{await state.db?.close()})
 it('accepts exactly one positive volume per product and transaction key',()=>{
   expect(parseBeerArrival({productId:'beer-01',liters:'12,5',operationId:one}).millis).toBe(12500)
   for(const liters of ['-1','0','10001','1.1234',1e100,NaN]){
     expect(()=>parseBeerArrival({productId:'beer-01',liters,operationId:one})).toThrow()
   }
   expect(()=>parseBeerArrival({productId:'beer-99',liters:12,operationId:one})).toThrow()
   expect(()=>parseBeerArrival({productId:'beer-01',liters:12,operationId:one,venueId:2})).toThrow()
 })
 it('adds and returns saved liter amount, no double count on retry',async()=>{
   expect((await getBeerIntake(venue)).balances).toEqual({})
   expect((await addBeerIntake(admin,venue,{productId:'beer-01',liters:12.5,operationId:one})).recordedLiters).toBe(12.5)
   expect((await addBeerIntake(admin,venue,{productId:'beer-01',liters:12.5,operationId:one})).alreadyApplied).toBe(true)
   expect((await addBeerIntake(admin,venue,{productId:'beer-01',liters:2,operationId:two})).recordedLiters).toBe(14.5)
   expect((await getBeerIntake(venue)).balances).toMatchObject({'beer-01':14.5})
   expect((await state.db!.query('SELECT * FROM admin_audit_log')).rows).toHaveLength(2)
 })
 it('does not leak stock to other venues, never reuse an operation with different data',async()=>{
   await addBeerIntake(admin,venue,{productId:'beer-02',liters:30,operationId:one})
   await expect(addBeerIntake(admin,{...venue,id:'2'},{productId:'beer-02',liters:30,operationId:one})).rejects.toThrow()
   await expect(addBeerIntake(admin,venue,{productId:'beer-02',liters:45,operationId:one})).rejects.toThrow()
   expect((await getBeerIntake({...venue,id:'2'})).balances).toEqual({})
   expect((await getBeerIntake(venue)).balances['beer-02']).toBe(30)
 })
})
