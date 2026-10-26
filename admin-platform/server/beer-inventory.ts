import {createHash} from 'node:crypto'
import type {Pool,PoolClient} from 'pg'
import {pool,readPool} from './db.js'
import {config} from './config.js'
import {recordAudit} from './audit.js'
import {HttpError,type AdminPrincipal,type VenueScope,type PeriodRange} from './types.js'
import {projectBeerInventory,type BeerDocument,type BeerMovement,type BeerSync} from './beer-inventory-model.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=/^[A-Za-z0-9_-]{1,200}$/
const reasons=['spill','staff','spoilage','tasting','other']
type Command={operationId:string;productId:string;kind:string;quantityMillis:string;baselineId:string|null;note:string;invoice:string;reason:string;returnDocumentId:string|null;notInReceipts:boolean}
export function parseBeerCommand(input:unknown):Command{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'BEER_INPUT','Некорректная операция.')
 const b=input as Record<string,unknown>
 const allowed=['operationId','productId','kind','quantityMillis','baselineId','note','invoice','reason','returnDocumentId','notInReceipts']
 if(Object.keys(b).some(k=>!allowed.includes(k))||!allowed.every(k=>Object.hasOwn(b,k))
  ||typeof b.operationId!=='string'||!uuid.test(b.operationId)||typeof b.productId!=='string'||!id.test(b.productId)
  ||typeof b.kind!=='string'||!['initial','delivery','writeoff','physical_return','count'].includes(b.kind)
  ||typeof b.quantityMillis!=='string'||! /^(0|[1-9]\d{0,9})$/.test(b.quantityMillis)||BigInt(b.quantityMillis)>9999999999n
  ||!(b.baselineId===null||typeof b.baselineId==='string'&&uuid.test(b.baselineId))
  ||typeof b.note!=='string'||b.note.length>500||typeof b.invoice!=='string'||b.invoice.length>100
  ||typeof b.reason!=='string'||typeof b.notInReceipts!=='boolean'
  ||!(b.returnDocumentId===null||typeof b.returnDocumentId==='string'&&id.test(b.returnDocumentId)))
  throw new HttpError(400,'BEER_INPUT','Проверьте товар, количество и идентификатор операции.')
 if(!['initial','count'].includes(b.kind)&&b.quantityMillis==='0')throw new HttpError(400,'BEER_INPUT','Количество должно быть больше нуля.')
 if((b.kind==='initial')!==(b.baselineId===null))throw new HttpError(400,'BEER_BASELINE','Нужна текущая начальная точка.')
 if(b.kind==='writeoff'&&(!reasons.includes(b.reason)||!b.notInReceipts))throw new HttpError(400,'BEER_WRITEOFF','Подтвердите, что расход ещё не отражён в кассовых чеках, и выберите причину.')
 if((b.kind==='physical_return')!==(b.returnDocumentId!==null))throw new HttpError(400,'BEER_RETURN','Укажите чек денежного возврата для физического возврата.')
 if(['count','writeoff','physical_return'].includes(b.kind)&&!b.note.trim())throw new HttpError(400,'BEER_NOTE','Добавьте комментарий для аудита.')
 return {operationId:b.operationId.toLowerCase(),productId:b.productId,kind:b.kind,quantityMillis:b.quantityMillis,baselineId:typeof b.baselineId==='string'?b.baselineId.toLowerCase():null,note:b.note,invoice:b.invoice,reason:b.reason,returnDocumentId:b.returnDocumentId,notInReceipts:b.notInReceipts} as Command
}
const iso=(value:unknown)=>new Date(value as string).toISOString()
type Dependencies={metadata:Pool;reader:Pool;now:()=>Date}
const defaults:Dependencies={metadata:pool,reader:readPool,now:()=>new Date()}
function enabled(write=false){
 if(!config.enableBeerInventory||write&&!config.enableWrites)throw new HttpError(403,'BEER_INVENTORY_DISABLED','Расчётный учёт пива выключен.')
}
async function authorize(db:PoolClient,admin:AdminPrincipal,scope:VenueScope){
 const venue=await db.query('SELECT v.id FROM venues v JOIN companies c ON c.id=v.company_id WHERE v.id=$1::bigint AND v.company_id=$2::bigint AND v.active=TRUE AND c.active=TRUE FOR SHARE OF v,c',[scope.id,scope.companyId])
 if(!venue.rows.length)throw new HttpError(404,'VENUE_NOT_FOUND','Заведение недоступно.')
 const account=await db.query('SELECT id FROM admin_accounts WHERE id=$1::bigint AND active=TRUE AND role=$2 FOR SHARE',[admin.id,admin.role])
 if(!account.rows.length)throw new HttpError(403,'BEER_OWNER_REQUIRED','Требуются действующие права владельца.')
 if(admin.role==='SUPER_ADMIN')return
 const grant=await db.query("SELECT admin_id FROM admin_company_access WHERE admin_id=$1::bigint AND company_id=$2::bigint AND access_kind='owner' FOR SHARE",[admin.id,scope.companyId])
 if(!grant.rows.length)throw new HttpError(403,'BEER_OWNER_REQUIRED','Раздел доступен владельцу заведения.')
}
async function schema(db:PoolClient){
 if(!(await db.query("SELECT to_regclass('public.admin_beer_inventory_movements') IS NOT NULL AS ready")).rows[0]?.ready)
  throw new HttpError(503,'BEER_SCHEMA_REQUIRED','Журнал расчётных остатков ещё не подготовлен.')
}
async function readProvider(db:PoolClient,scope:VenueScope){
 const ready=await db.query("SELECT to_regclass('public.pos_store_bindings') IS NOT NULL AND to_regclass('public.pos_documents') IS NOT NULL AND to_regclass('public.pos_sync_state') IS NOT NULL AS ready")
 if(!ready.rows[0]?.ready)throw new HttpError(503,'BEER_POS_SCHEMA','Кассовые документы ещё недоступны.')
 const bindings=await db.query<{store_id:string}>('SELECT store_id FROM pos_store_bindings WHERE tenant_id=$1 AND location_id=$2 AND enabled=TRUE',[scope.companyId,scope.id])
 if(bindings.rows.length!==1)throw new HttpError(503,'BEER_POS_BINDING','Нужна единственная подтверждённая касса этого заведения.')
 const storeId=bindings.rows[0]!.store_id
 const rows=await db.query<{store_id:string;document_id:string;type:string;closed_at:Date;positions:unknown;base_document_id:string|null}>("SELECT store_id,document_id,type,closed_at,snapshot->'positions' AS positions,snapshot->>'baseDocumentId' AS base_document_id FROM pos_documents WHERE source='evotor' AND store_id=$1 ORDER BY closed_at,document_id LIMIT 50001",[storeId])
 if(rows.rows.length>50000)throw new HttpError(503,'BEER_DATA_LIMIT','Слишком много чеков для полной сверки. Требуется расширение расчётного диапазона.')
 const documents:BeerDocument[]=rows.rows.map(r=>({storeId:r.store_id,documentId:r.document_id,type:r.type,closedAt:iso(r.closed_at),positions:r.positions,baseDocumentId:r.base_document_id}))
 const state=(await db.query<{last_success_at:Date|null;scan_until:Date|null;cursor:string|null;last_error_code:string|null}>('SELECT last_success_at,scan_until,cursor,last_error_code FROM pos_sync_state WHERE store_id=$1',[storeId])).rows[0]
 const sync:BeerSync={lastSuccessAt:state?.last_success_at?iso(state.last_success_at):null,scanUntil:state?.scan_until?iso(state.scan_until):null,cursor:state?.cursor??null,errorCode:state?.last_error_code??null}
 const observed=await db.query("SELECT to_regclass('public.pos_recent_sync_status') IS NOT NULL AS ready")
 if(observed.rows[0]?.ready){
  const r=(await db.query('SELECT * FROM pos_recent_sync_status WHERE store_id=$1',[storeId])).rows[0]
  if(r)sync.recent={state:r.state,lastSuccessAt:r.last_success_at?iso(r.last_success_at):null,from:r.success_since?iso(r.success_since):null,until:r.success_until?iso(r.success_until):null,pages:r.pages,cursorPending:r.cursor_pending,errorCode:r.last_error_code,updatedAt:iso(r.updated_at)}
 }
 return {storeId,documents,sync}
}
async function movements(db:PoolClient,scope:VenueScope,storeId:string){
 const r=await db.query('SELECT * FROM admin_beer_inventory_movements WHERE company_id=$1::bigint AND venue_id=$2::bigint AND store_id=$3 ORDER BY sequence LIMIT 50001',[scope.companyId,scope.id,storeId])
 if(r.rows.length>50000)throw new HttpError(503,'BEER_DATA_LIMIT','Слишком большой журнал для полной сверки.')
 return r.rows.map(m=>({operationId:m.operation_id,sequence:String(m.sequence),productId:m.product_id,kind:m.kind,quantityMillis:String(m.quantity_millis),baselineId:m.baseline_id,effectiveAt:iso(m.effective_at),recordedAt:iso(m.recorded_at),actorId:String(m.actor_id),note:m.note,invoice:m.invoice,reason:m.reason,returnDocumentId:m.return_document_id,evidence:m.evidence})) as BeerMovement[]
}
async function transaction<T>(p:Pool,readOnly:boolean,fn:(db:PoolClient)=>Promise<T>){
 const db=await p.connect()
 try{await db.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');const result=await fn(db);await db.query('COMMIT');return result}
 catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
}
export async function getBeerInventory(admin:AdminPrincipal,scope:VenueScope,range:PeriodRange,deps=defaults,historyOffset=0){
 enabled()
 return transaction(deps.metadata,true,async meta=>{
  // FOR SHARE cannot execute in READ ONLY; authorization remains in router and
  // is rechecked below without row locks for a read-only report.
  const access=await meta.query("SELECT v.id FROM venues v JOIN companies c ON c.id=v.company_id JOIN admin_accounts a ON a.id=$3::bigint AND a.active=TRUE AND a.role=$4 WHERE v.id=$1::bigint AND v.company_id=$2::bigint AND v.active AND c.active AND ($4='SUPER_ADMIN' OR EXISTS(SELECT 1 FROM admin_company_access g WHERE g.admin_id=a.id AND g.company_id=c.id AND g.access_kind='owner'))",[scope.id,scope.companyId,admin.id,admin.role])
  if(!access.rows.length)throw new HttpError(403,'BEER_OWNER_REQUIRED','Требуются права владельца.')
  await schema(meta)
  const provider=await transaction(deps.reader,true,db=>readProvider(db,scope))
  const journal=await movements(meta,scope,provider.storeId),now=deps.now().toISOString()
  const asOf=new Date(Math.min(range.to.getTime(),Date.parse(now))).toISOString()
  return {...projectBeerInventory({...provider,movements:journal,asOf,periodFrom:range.from.toISOString(),periodUntil:range.to.toISOString(),now,
   staleAfterMs:Math.max(30,config.beerInventorySyncSeconds)*3000,historyOffset}),storeId:provider.storeId,writeEnabled:config.enableWrites,
   databaseBoundary:'separate_read_snapshots',historyLimit:100}
 })
}
export async function writeBeerInventory(admin:AdminPrincipal,scope:VenueScope,input:unknown,deps=defaults){
 enabled(true)
 const body=parseBeerCommand(input),hash=createHash('sha256').update(JSON.stringify(body)).digest('hex')
 return transaction(deps.metadata,false,async meta=>{
  await authorize(meta,admin,scope);await schema(meta)
  const provider=await transaction(deps.reader,true,db=>readProvider(db,scope))
  await meta.query('SELECT pg_advisory_xact_lock(hashtext($1))',['crm-beer:'+provider.storeId+':'+body.productId])
  // Check under the product lock, BEFORE checking the new baseline: a lost reply
  // to an initial/count operation must still replay its original result.
  const prior=(await meta.query('SELECT company_id::text,venue_id::text,store_id,actor_id::text,request_hash,effective_at FROM admin_beer_inventory_movements WHERE operation_id=$1::uuid',[body.operationId])).rows[0]
  if(prior){
   if(prior.company_id!==scope.companyId||prior.venue_id!==scope.id||prior.store_id!==provider.storeId||prior.actor_id!==admin.id||prior.request_hash!==hash)
    throw new HttpError(409,'BEER_OPERATION_CONFLICT','ID операции уже использован с другими данными.')
   return {ok:true,alreadyApplied:true,operationId:body.operationId,effectiveAt:iso(prior.effective_at),source:'crm_calculated'}
  }
  const journal=await movements(meta,scope,provider.storeId)
  const now=deps.now().toISOString()
  const projection=projectBeerInventory({...provider,movements:journal,asOf:new Date(Date.parse(now)+1).toISOString(),periodFrom:now,periodUntil:now,now})
  const product=projection.products.find(p=>p.productId===body.productId)
  if(!product?.supported)throw new HttpError(409,'BEER_PRODUCT_UNSUPPORTED','Нужен существующий товар с подтверждёнными ID и единицей «л» в чеках.')
  if((product.baseline?.operationId??null)!==body.baselineId)throw new HttpError(409,'BEER_BASELINE_CHANGED','Начальная точка изменилась. Обновите данные и проверьте остаток.')
  if(body.kind==='physical_return'){
   const refund=product.refunds.find(r=>r.documentId===body.returnDocumentId)
   if(!refund||refund.restored||BigInt(body.quantityMillis)>BigInt(refund.quantityMillis))throw new HttpError(409,'BEER_RETURN_CONFLICT','Возврат не найден, уже восстановлен или количество превышает чек. Один чек подтверждается один раз.')
  }
  const evidence={productName:product.name,calculatedBeforeMillis:product.balanceMillis,discrepancyMillis:body.kind==='count'?String(BigInt(body.quantityMillis)-BigInt(product.balanceMillis!)):null,
   sync:projection.quality,baseDocumentId:product.refunds.find(r=>r.documentId===body.returnDocumentId)?.baseDocumentId??null,
   boundary:'baseline includes closes at or before effectiveAt; later closes only',separateDatabaseSnapshots:true}
  await meta.query('INSERT INTO admin_beer_inventory_movements(operation_id,company_id,venue_id,store_id,product_id,kind,quantity_millis,baseline_id,effective_at,actor_id,note,invoice,reason,return_document_id,request_hash,evidence) VALUES($1::uuid,$2::bigint,$3::bigint,$4,$5,$6,$7::bigint,$8::uuid,$9::timestamptz,$10::bigint,$11,$12,$13,$14,$15,$16::jsonb)',
   [body.operationId,scope.companyId,scope.id,provider.storeId,body.productId,body.kind,body.quantityMillis,body.baselineId,now,admin.id,body.note,body.invoice,body.reason,body.returnDocumentId,hash,JSON.stringify(evidence)])
  await recordAudit({admin,scope,action:'beer.inventory.'+body.kind,entityType:'crm_beer_product',entityId:body.productId,
   metadata:{operationId:body.operationId,storeId:provider.storeId,quantityMillis:body.quantityMillis,baselineId:body.baselineId,...evidence}},meta)
  return {ok:true,alreadyApplied:false,operationId:body.operationId,effectiveAt:now,source:'crm_calculated'}
 })
}
