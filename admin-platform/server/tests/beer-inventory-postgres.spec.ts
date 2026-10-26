// @vitest-environment node
// Native PostgreSQL, TWO disposable databases. No production URL accepted.
import pg from 'pg'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest'
import type {VenueScope,AdminPrincipal} from '../types.js'
const flags=vi.hoisted(()=>({enableBeerInventory:true,enableWrites:true,beerInventorySyncSeconds:120}))
vi.mock('../config.js',()=>({config:flags}))
import {getBeerInventory,writeBeerInventory,parseBeerCommand} from '../beer-inventory.js'
const url=process.env.BEER_INVENTORY_TEST_DATABASE_URL||''
let safe=false
try{const parsed=new URL(url);safe=/^codex_admin_test_beer$/.test(parsed.pathname.slice(1))}catch{safe=false}
const suite=safe?describe:describe.skip
const scope:VenueScope={id:'101',companyId:'10',companyCode:'a',companyName:'A',code:'a',name:'A',address:null,legacyBarId:null}
const admin:AdminPrincipal={id:'11',role:'VENUE_ADMIN',email:'fixture@invalid.test',displayName:'Fixture'}
const time=new Date('2026-10-26T10:00:00.000Z')
suite('beer journal with native SQL, read-only receipt DB and actual concurrent writers',()=>{
 let meta:pg.Pool,reader:pg.Pool,seed:pg.Pool,control:pg.Pool,baseline:string
 const deps=()=>({metadata:meta,reader,now:()=>new Date(time)})
 const command=(kind='delivery',quantityMillis='1000',extra:Record<string,unknown>={})=>({operationId:randomUUID(),productId:'beer-a',kind,quantityMillis,baselineId:baseline,note:'Fixture',invoice:'',reason:'',returnDocumentId:null,notInReceipts:false,...extra})
 const range={from:new Date('2026-10-25'),to:new Date('2026-10-27'),days:2}
 async function receipt(id:string,quantity=1000,type='SELL',when='2026-10-26T10:00:01Z',store='store-a',productId='beer-a'){
  await seed.query("INSERT INTO pos_documents VALUES('evotor',$1,$2,$3,$4,100,$5::jsonb,NOW()) ON CONFLICT DO NOTHING",[store,id,type,when,JSON.stringify({positions:[{productId,name:'Жигулёвское',measure:'л',quantityMillis:quantity}],baseDocumentId:type==='PAYBACK'?'sale-1':null})])
 }
 beforeAll(async()=>{
  control=new pg.Pool({connectionString:url})
  await control.query('CREATE DATABASE codex_admin_test_beer_pos')
  const readUrl=new URL(url);readUrl.pathname='/codex_admin_test_beer_pos'
  meta=new pg.Pool({connectionString:url,max:8});seed=new pg.Pool({connectionString:readUrl.toString()});reader=new pg.Pool({connectionString:readUrl.toString(),options:'-c default_transaction_read_only=on'})
  await meta.query(`CREATE TABLE companies(id BIGINT PRIMARY KEY,active BOOLEAN);CREATE TABLE venues(id BIGINT PRIMARY KEY,company_id BIGINT REFERENCES companies(id),active BOOLEAN);CREATE TABLE admin_accounts(id BIGINT PRIMARY KEY,active BOOLEAN,role TEXT);CREATE TABLE admin_company_access(admin_id BIGINT,company_id BIGINT,access_kind TEXT);CREATE TABLE admin_audit_log(admin_id BIGINT,admin_role TEXT,company_id BIGINT,venue_id BIGINT,action TEXT,entity_type TEXT,entity_id TEXT,before_value JSONB,after_value JSONB,reason TEXT,metadata JSONB);INSERT INTO companies VALUES(10,TRUE),(20,TRUE);INSERT INTO venues VALUES(101,10,TRUE),(202,20,TRUE);INSERT INTO admin_accounts VALUES(11,TRUE,'VENUE_ADMIN'),(12,TRUE,'VENUE_ADMIN');INSERT INTO admin_company_access VALUES(11,10,'owner'),(12,10,'trusted');`)
  await meta.query(await readFile(new URL('../../admin-migrations/026_beer_inventory_ledger.sql',import.meta.url),'utf8'))
  await seed.query(`CREATE TABLE pos_store_bindings(store_id TEXT PRIMARY KEY,tenant_id TEXT,location_id TEXT,enabled BOOLEAN);CREATE TABLE pos_documents(source TEXT,store_id TEXT,document_id TEXT,type TEXT,closed_at TIMESTAMPTZ,amount_cents BIGINT,snapshot JSONB,imported_at TIMESTAMPTZ,PRIMARY KEY(source,store_id,document_id));CREATE TABLE pos_sync_state(store_id TEXT,last_success_at TIMESTAMPTZ,scan_until TIMESTAMPTZ,cursor TEXT,last_error_code TEXT);CREATE TABLE wallets(id INT,balance INT);INSERT INTO wallets VALUES(1,999);INSERT INTO pos_store_bindings VALUES('store-a','10','101',TRUE),('store-b','20','202',TRUE);INSERT INTO pos_sync_state VALUES('store-a','2026-10-26T10:00:00Z','2026-10-26T10:00:00Z',NULL,NULL);`)
  await receipt('discovery',1000,'SELL','2026-10-25T10:00:00Z')
 },30000)
 afterAll(async()=>{await Promise.allSettled([meta?.end(),seed?.end(),reader?.end()]);if(control){await control.query('DROP DATABASE codex_admin_test_beer_pos');await control.end()}})
 it('creates initial point once and replay with reordered JSON is identical',async()=>{
  const b=command('initial','30000',{baselineId:null});baseline=b.operationId
  expect(await writeBeerInventory(admin,scope,b,deps())).toMatchObject({ok:true,alreadyApplied:false})
  expect(await writeBeerInventory(admin,scope,Object.fromEntries(Object.entries(b).reverse()),deps())).toMatchObject({alreadyApplied:true})
  expect((await meta.query('SELECT * FROM admin_beer_inventory_movements')).rows).toHaveLength(1)
  expect(parseBeerCommand(b).quantityMillis).toBe('30000')
 })
 it('deduplicates actual imported documents, includes anonymous/late sales and retains negative values',async()=>{
  await receipt('sale-1');await receipt('sale-1');await receipt('sale-half',500)
  time.setSeconds(3)
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('28500')
  await writeBeerInventory(admin,scope,command('delivery','50000'),deps())
  await writeBeerInventory(admin,scope,command('writeoff','2000',{reason:'spill',notInReceipts:true}),deps())
  await receipt('sale-new',1000,'SELL','2026-10-26T10:00:04Z');time.setSeconds(5)
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('75500')
  await receipt('late',500,'SELL','2026-10-26T10:00:02Z')
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('75000')
 })
 it('concurrent deliveries/retries are serialized, neither movement nor audit is lost',async()=>{
  const b=command('delivery','1000')
  await Promise.all(Array.from({length:5},()=>writeBeerInventory(admin,scope,b,deps())))
  await Promise.all(Array.from({length:4},()=>writeBeerInventory(admin,scope,command('delivery','500'),deps())))
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('78000')
  expect((await meta.query('SELECT * FROM admin_beer_inventory_movements WHERE operation_id=$1',[b.operationId])).rows).toHaveLength(1)
  expect((await meta.query("SELECT * FROM admin_audit_log WHERE metadata->>'operationId'=$1",[b.operationId])).rows).toHaveLength(1)
 })
 it('cash refund alone does nothing; physical refund is bounded and unique even with a new operation ID',async()=>{
  await receipt('refund',500,'PAYBACK','2026-10-26T10:00:04Z')
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('78000')
  await writeBeerInventory(admin,scope,command('physical_return','500',{returnDocumentId:'refund'}),deps())
  await expect(writeBeerInventory(admin,scope,command('physical_return','500',{returnDocumentId:'refund'}),deps())).rejects.toMatchObject({code:'BEER_RETURN_CONFLICT'})
  expect((await getBeerInventory(admin,scope,range,deps())).products[0]?.balanceMillis).toBe('78500')
 })
 it('count starts a new generation and exact replay cannot reset subsequent sales',async()=>{
  const b=command('count','0');time.setSeconds(10)
  await writeBeerInventory(admin,scope,b,deps());baseline=b.operationId
  await receipt('at-boundary',1000,'SELL',time.toISOString())
  await receipt('after-count',1000,'SELL','2026-10-26T10:00:11Z');time.setSeconds(12)
  await writeBeerInventory(admin,scope,b,deps())
  await receipt('late-old',1000,'SELL','2026-10-26T10:00:09Z')
  const p=(await getBeerInventory(admin,scope,range,deps())).products[0]!
  expect(p.balanceMillis).toBe('-1000');expect(p.status).toBe('incomplete')
  expect((await meta.query("SELECT * FROM admin_beer_inventory_movements WHERE kind='count'")).rows).toHaveLength(1)
 })
 it('scope/owner/baseline/operation substitution cannot mutate any tenant',async()=>{
  const before=(await meta.query('SELECT * FROM admin_beer_inventory_movements')).rows
  await expect(writeBeerInventory({...admin,id:'12'},scope,command(),deps())).rejects.toMatchObject({code:'BEER_OWNER_REQUIRED'})
  await expect(getBeerInventory(admin,{...scope,id:'202',companyId:'20'},range,deps())).rejects.toMatchObject({code:'BEER_OWNER_REQUIRED'})
  await expect(writeBeerInventory(admin,{...scope,id:'202'},command(),deps())).rejects.toMatchObject({code:'VENUE_NOT_FOUND'})
  await expect(writeBeerInventory(admin,scope,command('delivery','1',{baselineId:randomUUID()}),deps())).rejects.toMatchObject({code:'BEER_BASELINE_CHANGED'})
  await expect(writeBeerInventory(admin,scope,{...command(),storeId:'store-b'},deps())).rejects.toMatchObject({code:'BEER_INPUT'})
  await expect(writeBeerInventory(admin,scope,command('delivery','1',{operationId:baseline}),deps())).rejects.toMatchObject({code:'BEER_OPERATION_CONFLICT'})
  expect((await meta.query('SELECT * FROM admin_beer_inventory_movements')).rows).toEqual(before)
 })
 it('audit failure rolls back the movement and does not leave a partial delivery',async()=>{
  const b=command()
  await meta.query("ALTER TABLE admin_audit_log ADD CONSTRAINT fixture_audit_failure CHECK(action<>'beer.inventory.delivery') NOT VALID")
  try{await expect(writeBeerInventory(admin,scope,b,deps())).rejects.toBeTruthy()}
  finally{await meta.query('ALTER TABLE admin_audit_log DROP CONSTRAINT fixture_audit_failure')}
  expect((await meta.query('SELECT * FROM admin_beer_inventory_movements WHERE operation_id=$1',[b.operationId])).rows).toHaveLength(0)
 })
 it('POS store/receipts/wallets are unchanged and the receipt connection refuses writes',async()=>{
  await expect(reader.query('UPDATE wallets SET balance=0')).rejects.toBeTruthy()
  expect((await seed.query('SELECT balance FROM wallets')).rows[0]?.balance).toBe(999)
  expect((await seed.query('SELECT count(*)::int AS n FROM pos_documents')).rows[0]?.n).toBe(9)
  expect((await seed.query('SELECT count(*)::int AS n FROM pos_store_bindings')).rows[0]?.n).toBe(2)
 })
 it('default-off gate rejects before any database or provider action',async()=>{
  flags.enableBeerInventory=false
  await expect(writeBeerInventory(admin,scope,command(),deps())).rejects.toMatchObject({code:'BEER_INVENTORY_DISABLED'})
  flags.enableBeerInventory=true
 })
})
