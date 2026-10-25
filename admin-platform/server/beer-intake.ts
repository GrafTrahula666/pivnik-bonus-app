import {pool,tableExists} from './db.js'
import {recordAudit} from './audit.js'
import {HttpError,type AdminPrincipal,type VenueScope} from './types.js'

const knownProduct=(v:unknown):v is string=>typeof v==='string'&&/^beer-(0[1-9]|[12]\d|3[0-5])$/.test(v)
const knownOperation=(v:unknown):v is string=>typeof v==='string'&&/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v)

export function parseBeerArrival(body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new HttpError(400,'INVALID_ARRIVAL','Некорректные данные поступления.')
  const b=body as Record<string,unknown>
  if(Object.keys(b).sort().join('|')!=='liters|operationId|productId'||!knownProduct(b.productId)||!knownOperation(b.operationId))
    throw new HttpError(400,'INVALID_ARRIVAL','Укажите сорт, литры и идентификатор операции.')
  const liters=typeof b.liters==='number'?String(b.liters):typeof b.liters==='string'?b.liters.trim():''
  if(!/^\d{1,5}(?:[.,]\d{1,3})?$/.test(liters))throw new HttpError(400,'INVALID_LITERS','Введите количество в литрах, не более трёх знаков после запятой.')
  const millis=Math.round(Number(liters.replace(',','.'))*1000)
  if(millis<1||millis>10_000_000)throw new HttpError(400,'INVALID_LITERS','Нужно от 0,001 до 10 000 литров.')
  return {productId:b.productId,operationId:b.operationId,millis}
}
export async function beerIntakeReady(){
  const [a,b]=await Promise.all([tableExists('admin_beer_intake_balance'),tableExists('admin_beer_intake_operations')])
  if(!a||!b)throw new HttpError(503,'BEER_INTAKE_SCHEMA_REQUIRED','Учёт поступлений пока не подготовлен.')
}
export async function getBeerIntake(scope:VenueScope){
  await beerIntakeReady()
  const result=await pool.query<{product_key:string;liters_millis:string}>('SELECT product_key,liters_millis::text FROM admin_beer_intake_balance WHERE venue_id=$1::bigint',[scope.id])
  return {source:'admin_arrivals_only',balances:Object.fromEntries(result.rows.map(row=>[row.product_key,Number(row.liters_millis)/1000]))}
}
export async function addBeerIntake(admin:AdminPrincipal,scope:VenueScope,body:unknown){
  const {productId,operationId,millis}=parseBeerArrival(body)
  await beerIntakeReady()
  const db=await pool.connect()
  try{
    await db.query('BEGIN')
    const saved=await db.query('INSERT INTO admin_beer_intake_operations(operation_id,venue_id,product_key,added_millis,created_by) VALUES($1::uuid,$2::bigint,$3,$4::bigint,$5::bigint) ON CONFLICT(operation_id) DO NOTHING RETURNING operation_id',[operationId,scope.id,productId,millis,admin.id])
    let litersMillis:number
    if(saved.rowCount===0){
      const previous=await db.query<{venue_id:string;product_key:string;added_millis:string;created_by:string}>('SELECT venue_id::text,product_key,added_millis::text,created_by::text FROM admin_beer_intake_operations WHERE operation_id=$1::uuid',[operationId])
      const item=previous.rows[0]
      if(!item||item.venue_id!==scope.id||item.product_key!==productId||Number(item.added_millis)!==millis||item.created_by!==admin.id)
        throw new HttpError(409,'ARRIVAL_REPLAY_CONFLICT','Повторный запрос с другими данными отклонён.')
      const balance=await db.query<{liters_millis:string}>('SELECT liters_millis::text FROM admin_beer_intake_balance WHERE venue_id=$1::bigint AND product_key=$2',[scope.id,productId])
      litersMillis=Number(balance.rows[0]?.liters_millis??0)
    }else{
      const result=await db.query<{liters_millis:string}>('INSERT INTO admin_beer_intake_balance(venue_id,product_key,liters_millis) VALUES($1::bigint,$2,$3::bigint) ON CONFLICT(venue_id,product_key) DO UPDATE SET liters_millis=admin_beer_intake_balance.liters_millis+EXCLUDED.liters_millis,updated_at=NOW() RETURNING liters_millis::text',[scope.id,productId,millis])
      litersMillis=Number(result.rows[0]?.liters_millis??0)
      await recordAudit({admin,scope,action:'beer_intake.add',entityType:'beer_arrival',entityId:operationId,
        metadata:{productId,addedLiters:millis/1000,newRecordedLiters:litersMillis/1000}},db)
    }
    await db.query('COMMIT')
    return {ok:true,productId,operationId,recordedLiters:litersMillis/1000,alreadyApplied:saved.rowCount===0}
  }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
