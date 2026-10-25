import {pool,readPool,tableExists} from './db.js'
import {recordAudit} from './audit.js'
import {config} from './config.js'
import {HttpError,type AdminPrincipal,type VenueScope} from './types.js'
import {getEvotorStockList,getEvotorStockProduct,patchEvotorStockQuantity} from './evotor-stock-client.js'

const operationPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const productPattern=/^[A-Za-z0-9_-]{1,200}$/
function millis(value:unknown):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>9_999_999.999
    ||Math.abs(value*1000-Math.round(value*1000))>.00001)throw new HttpError(400,'EVOTOR_STOCK_QUANTITY','Некорректное количество литров.')
  return Math.round(value*1000)
}
export function parseEvotorStockCommand(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'INVALID_STOCK_WRITE','Некорректный запрос.')
  const b=value as Record<string,unknown>
  if(Object.keys(b).sort().join('|')!=='expectedQuantity|expectedUpdatedAt|liters|operationId|productId'
    ||typeof b.productId!=='string'||!productPattern.test(b.productId)
    ||typeof b.operationId!=='string'||!operationPattern.test(b.operationId)
    ||typeof b.expectedUpdatedAt!=='string'||b.expectedUpdatedAt.length<8||b.expectedUpdatedAt.length>80
    ||typeof b.liters!=='number')
    throw new HttpError(400,'INVALID_STOCK_WRITE','Нужны ID товара, литры и подтверждённый остаток Эвотора.')
  const delta=millis(b.liters)
  if(delta<1||delta>10_000_000)throw new HttpError(400,'INVALID_STOCK_WRITE','Привоз должен быть больше нуля и не более 10 000 л.')
  return {productId:b.productId,operationId:b.operationId,expectedMillis:millis(b.expectedQuantity),
    expectedUpdatedAt:b.expectedUpdatedAt,delta}
}
async function binding(scope:VenueScope){
  const token=String(process.env.EVOTOR_API_TOKEN||''),configuredStore=String(process.env.EVOTOR_STORE_ID||'')
  if(!token||!configuredStore)throw new HttpError(503,'EVOTOR_STOCK_NOT_CONFIGURED','Нет серверных ключей Эвотора для панели.')
  const ready=await readPool.query<{exists:boolean}>("SELECT to_regclass('public.pos_store_bindings') IS NOT NULL AS exists")
  if(!ready.rows[0]?.exists)throw new HttpError(503,'EVOTOR_STOCK_NOT_BOUND','Нет проверенной связи с магазином.')
  const result=await readPool.query<{store_id:string}>('SELECT store_id FROM pos_store_bindings WHERE tenant_id=$1 AND location_id=$2 AND enabled=TRUE',[scope.companyId,scope.id])
  if(result.rows.length!==1||result.rows[0]?.store_id!==configuredStore)
    throw new HttpError(503,'EVOTOR_STOCK_NOT_BOUND','Магазин кассы не совпал с заведением.')
  return {storeId:configuredStore,token}
}
export async function listEvotorStock(scope:VenueScope){
  if(!config.enableBeerIntake||!config.enableWrites)throw new HttpError(403,'EVOTOR_STOCK_DISABLED','Модуль отключён.')
  const {storeId,token}=await binding(scope)
  return {source:'evotor_cloud',writeEnabled:config.enableEvotorStockWrites,products:await getEvotorStockList(storeId,token)}
}
export async function incrementEvotorStock(admin:AdminPrincipal,scope:VenueScope,input:unknown){
  if(!config.enableBeerIntake||!config.enableWrites||!config.enableEvotorStockWrites)
    throw new HttpError(403,'EVOTOR_STOCK_WRITE_DISABLED','Запись остатков Эвотора пока выключена.')
  const body=parseEvotorStockCommand(input)
  if(!await tableExists('admin_evotor_stock_operations'))
    throw new HttpError(503,'EVOTOR_STOCK_SCHEMA_REQUIRED','Миграция журнала операций не применена.')
  const {storeId,token}=await binding(scope)
  const db=await pool.connect()
  let targetMillis=0
  try{
    await db.query('BEGIN')
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['evotor-stock:'+storeId+':'+body.productId])
    const prior=await db.query<{venue_id:string;store_id:string;product_id:string;actor_id:string;delta_millis:string;before_millis:string;expected_updated_at:string;status:string;target_millis:string}>(
      'SELECT venue_id::text,store_id,product_id,actor_id::text,delta_millis::text,before_millis::text,expected_updated_at,status,target_millis::text FROM admin_evotor_stock_operations WHERE id=$1::uuid FOR UPDATE',[body.operationId])
    if(prior.rows.length){
      const existing=prior.rows[0]!
      if(existing.venue_id!==scope.id||existing.store_id!==storeId||existing.product_id!==body.productId||existing.actor_id!==admin.id
        ||Number(existing.delta_millis)!==body.delta||Number(existing.before_millis)!==body.expectedMillis||existing.expected_updated_at!==body.expectedUpdatedAt)
        throw new HttpError(409,'EVOTOR_STOCK_OPERATION_CONFLICT','Идентификатор операции повторён с другими данными.')
      if(existing.status!=='confirmed')throw new HttpError(409,'EVOTOR_STOCK_OPERATION_UNCERTAIN','Операция ещё не подтверждена. Нужна сверка.')
      await db.query('COMMIT')
      return {ok:true,alreadyApplied:true,recordedLiters:Number(existing.target_millis)/1000,source:'evotor_cloud'}
    }
    const inFlight=await db.query(
      "SELECT 1 FROM admin_evotor_stock_operations WHERE store_id=$1 AND product_id=$2 AND status IN ('sent','uncertain') LIMIT 1",
      [storeId,body.productId])
    if(inFlight.rows.length)throw new HttpError(409,'EVOTOR_STOCK_OPERATION_UNCERTAIN','По этому сорту есть неподтверждённый приход.')
    const current=await getEvotorStockProduct(storeId,body.productId,token)
    if(millis(current.quantity)!==body.expectedMillis||current.updated_at!==body.expectedUpdatedAt)
      throw new HttpError(409,'EVOTOR_STOCK_STALE','Остаток в Эвоторе изменился. Обновите список перед добавлением.')
    targetMillis=body.expectedMillis+body.delta
    if(targetMillis>9_999_999_999)throw new HttpError(400,'EVOTOR_STOCK_TOO_LARGE','Превышен допустимый остаток.')
    await db.query('INSERT INTO admin_evotor_stock_operations(id,venue_id,store_id,product_id,actor_id,delta_millis,before_millis,target_millis,expected_updated_at,status) VALUES($1::uuid,$2::bigint,$3,$4,$5::bigint,$6::bigint,$7::bigint,$8::bigint,$9,$10)',
      [body.operationId,scope.id,storeId,body.productId,admin.id,body.delta,body.expectedMillis,targetMillis,body.expectedUpdatedAt,'sent'])
    await db.query('COMMIT')
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  // Only one PATCH after a durable reservation. Unknown response does NOT trigger a retry.
  let status:'confirmed'|'rejected'|'uncertain'='uncertain'
  let failure:unknown
  try{
    await patchEvotorStockQuantity(storeId,body.productId,token,targetMillis/1000)
    const readback=await getEvotorStockProduct(storeId,body.productId,token)
    if(millis(readback.quantity)!==targetMillis)
      throw new HttpError(409,'EVOTOR_STOCK_UNCERTAIN','Эвотор показал другой остаток после записи.')
    status='confirmed'
  }catch(e){
    failure=e
    if(e instanceof HttpError&&['EVOTOR_STOCK_AUTH','EVOTOR_STOCK_PERMISSIONS','EVOTOR_PRODUCT_NOT_FOUND','EVOTOR_STOCK_LIMIT'].includes(e.code))
      status='rejected'
  }
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    await client.query('UPDATE admin_evotor_stock_operations SET status=$2,resolved_at=NOW() WHERE id=$1::uuid AND status=$3',
      [body.operationId,status,'sent'])
    await recordAudit({admin,scope,action:'evotor.stock.'+status,entityType:'evotor_product',entityId:body.productId,
      metadata:{operationId:body.operationId,addedLiters:body.delta/1000,before:body.expectedMillis/1000,after:targetMillis/1000,status}},client)
    await client.query('COMMIT')
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  if(status!=='confirmed')throw new HttpError(409,status==='rejected'?'EVOTOR_STOCK_REJECTED':'EVOTOR_STOCK_OPERATION_UNCERTAIN',
    status==='rejected'?'Эвотор отказал в записи. Проверьте подключение и права.':
      'Результат изменения неизвестен. Не нажимайте повторно, нужна сверка с Эвотором.',
    {providerError:failure instanceof HttpError?failure.code:'EVOTOR_STOCK_UNCERTAIN'})
  return {ok:true,alreadyApplied:false,recordedLiters:targetMillis/1000,source:'evotor_cloud'}
}
