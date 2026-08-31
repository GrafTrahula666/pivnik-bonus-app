import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { config } from './config.js'
import { pool, writePool } from './db.js'
import { recordAudit } from './audit.js'
import { validateBonusAdjustmentInput } from './writes.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'

interface ProductionTxRow {
  id:string
  client_id:string
  bonus_spent:string
  bonus_earned:string
  balance_after:string
  reason:string|null
  reward_code:string|null
}

function requestHash(value:unknown):string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function requireBonusPilot(scope:VenueScope):void {
  if(!config.enableProductionBonusWrites){
    throw new HttpError(405,'PRODUCTION_BONUS_WRITES_DISABLED','Изменение бонусов отключено для production pilot.')
  }
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId){
    throw new HttpError(409,'LEGACY_WRITE_NOT_TENANT_SAFE','Production bonus writer разрешён только mapped PIVNIK tenant.')
  }
  if(!writePool){
    throw new HttpError(503,'PRODUCTION_WRITER_UNAVAILABLE','Production writer не настроен.')
  }
}

function expectedProductionShape(type:'credit'|'debit',amount:number,reason:string){
  return {
    spent:type==='debit'?amount:0,
    earned:type==='credit'?amount:0,
    reason:`Admin: ${reason}`,
    rewardCode:`admin:bonus:${type}`,
  }
}

function responseFromExisting(
  row:ProductionTxRow,
  userId:string,
  type:'credit'|'debit',
  amount:number,
  reason:string,
):Record<string,unknown>{
  const expected=expectedProductionShape(type,amount,reason)
  if(
    String(row.client_id)!==userId||
    Number(row.bonus_spent)!==expected.spent||
    Number(row.bonus_earned)!==expected.earned||
    String(row.reason||'')!==expected.reason||
    String(row.reward_code||'')!==expected.rewardCode
  ){
    throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Этот idempotency key уже использован для другой production-операции.')
  }
  const after=Number(row.balance_after)
  const before=type==='credit'?after-amount:after+amount
  return {userId,type,amount,balanceBefore:before,balanceAfter:after,transactionId:String(row.id),idempotent:true}
}

async function findProductionTx(client:PoolClient,requestKey:string):Promise<ProductionTxRow|null>{
  const result=await client.query<ProductionTxRow>(
    `SELECT id::text,client_id::text,bonus_spent::text,bonus_earned::text,balance_after::text,reason,reward_code
     FROM transactions WHERE request_key=$1 LIMIT 1 FOR UPDATE`,
    [requestKey],
  )
  return result.rows[0]||null
}

async function reserveMetadataKey(
  admin:AdminPrincipal,
  scope:VenueScope,
  idempotencyKey:string,
  hash:string,
):Promise<Record<string,unknown>|null>{
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const existing=await client.query<{request_hash:string;response_json:Record<string,unknown>|null}>(
      `SELECT request_hash,response_json FROM admin_idempotency_keys
       WHERE admin_id=$1::bigint AND venue_id=$2::bigint AND operation='bonus-adjustment' AND idempotency_key=$3
       FOR UPDATE`,
      [admin.id,scope.id,idempotencyKey],
    )
    if(existing.rowCount){
      if(existing.rows[0]!.request_hash!==hash){
        throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Этот idempotency key уже использован для другого запроса.')
      }
      await client.query('COMMIT')
      return existing.rows[0]!.response_json?{...existing.rows[0]!.response_json,idempotent:true}:null
    }
    await client.query(
      `INSERT INTO admin_idempotency_keys(admin_id,venue_id,operation,idempotency_key,request_hash,response_json)
       VALUES($1::bigint,$2::bigint,'bonus-adjustment',$3,$4,NULL)`,
      [admin.id,scope.id,idempotencyKey,hash],
    )
    await client.query('COMMIT')
    return null
  }catch(error){
    await client.query('ROLLBACK').catch(()=>undefined)
    throw error
  }finally{client.release()}
}

async function finalizeMetadata(
  admin:AdminPrincipal,
  scope:VenueScope,
  userId:string,
  type:'credit'|'debit',
  amount:number,
  reason:string,
  idempotencyKey:string,
  hash:string,
  response:Record<string,unknown>,
):Promise<void>{
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const idem=await client.query<{request_hash:string;response_json:Record<string,unknown>|null}>(
      `SELECT request_hash,response_json FROM admin_idempotency_keys
       WHERE admin_id=$1::bigint AND venue_id=$2::bigint AND operation='bonus-adjustment' AND idempotency_key=$3
       FOR UPDATE`,
      [admin.id,scope.id,idempotencyKey],
    )
    if(!idem.rowCount){
      throw new Error('Reserved Admin idempotency row disappeared before finalization.')
    }
    if(idem.rows[0]!.request_hash!==hash){
      throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Idempotency metadata не совпадает с production-операцией.')
    }
    if(idem.rows[0]!.response_json){
      await client.query('COMMIT')
      return
    }

    const adjustment=await client.query<{id:string}>(
      `INSERT INTO admin_bonus_adjustments(
        admin_id,company_id,venue_id,user_id,adjustment_type,amount,reason,production_transaction_id,idempotency_key
       ) VALUES($1::bigint,$2::bigint,$3::bigint,$4::bigint,$5,$6::bigint,$7,$8::bigint,$9)
       ON CONFLICT(venue_id,idempotency_key) DO NOTHING
       RETURNING id::text`,
      [admin.id,scope.companyId,scope.id,userId,type,amount,reason,String(response.transactionId),idempotencyKey],
    )
    if(!adjustment.rowCount){
      const existing=await client.query<{
        admin_id:string;user_id:string;adjustment_type:string;amount:string;reason:string;production_transaction_id:string|null
      }>(
        `SELECT admin_id::text,user_id::text,adjustment_type,amount::text,reason,production_transaction_id::text
         FROM admin_bonus_adjustments WHERE venue_id=$1::bigint AND idempotency_key=$2 FOR UPDATE`,
        [scope.id,idempotencyKey],
      )
      const row=existing.rows[0]
      if(!row||String(row.admin_id)!==String(admin.id)||String(row.user_id)!==userId||row.adjustment_type!==type||Number(row.amount)!==amount||row.reason!==reason||String(row.production_transaction_id||'')!==String(response.transactionId||'')){
        throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Admin metadata для idempotency key не совпадает с production-операцией.')
      }
    }else{
      await recordAudit({
        admin,scope,
        action:type==='credit'?'customer.bonus.credit':'customer.bonus.debit',
        entityType:'customer_wallet',entityId:userId,
        before:{balance:response.balanceBefore},
        after:{balance:response.balanceAfter,amount},
        reason,
        metadata:{productionTransactionId:response.transactionId,idempotencyKey,writer:'isolated-production-pilot'},
      },client)
    }

    await client.query(
      `UPDATE admin_idempotency_keys SET response_json=$5::jsonb
       WHERE admin_id=$1::bigint AND venue_id=$2::bigint AND operation='bonus-adjustment' AND idempotency_key=$3 AND request_hash=$4`,
      [admin.id,scope.id,idempotencyKey,hash,JSON.stringify(response)],
    )
    await client.query('COMMIT')
  }catch(error){
    await client.query('ROLLBACK').catch(()=>undefined)
    throw error
  }finally{client.release()}
}

async function finalizeWithRetry(args:Parameters<typeof finalizeMetadata>):Promise<boolean>{
  let lastError:unknown
  for(let attempt=0;attempt<3;attempt+=1){
    try{
      await finalizeMetadata(...args)
      return true
    }catch(error){
      lastError=error
      if(error instanceof HttpError&&error.code==='IDEMPOTENCY_CONFLICT') throw error
      await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)))
    }
  }
  console.error('Admin bonus metadata finalization failed after production commit:',lastError)
  return false
}

export async function adjustPivnikBonusPilot(
  admin:AdminPrincipal,
  scope:VenueScope,
  rawUserId:string,
  raw:unknown,
):Promise<Record<string,unknown>>{
  requireBonusPilot(scope)
  const {type,amount,reason,idempotencyKey,userId}=validateBonusAdjustmentInput(raw,rawUserId)
  const hash=requestHash({type,amount,reason,userId})
  const reservedResponse=await reserveMetadataKey(admin,scope,idempotencyKey,hash)
  if(reservedResponse) return reservedResponse

  const requestKey=`admin:${scope.id}:${idempotencyKey}`
  const client=await writePool!.connect()
  let response:Record<string,unknown>
  try{
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[requestKey])
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[userId])

    const existing=await findProductionTx(client,requestKey)
    if(existing){
      response=responseFromExisting(existing,userId,type,amount,reason)
      await client.query('COMMIT')
    }else{
      const account=await client.query<{balance:string}>(
        `SELECT w.balance::text
         FROM bar_customers bc
         JOIN users u ON u.id=bc.user_id
         JOIN wallets w ON w.user_id=u.id
         WHERE bc.bar_id=$1::bigint AND bc.user_id=$2::bigint AND bc.status='active'
           AND u.role='client' AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
         FOR UPDATE OF w`,
        [scope.legacyBarId,userId],
      )
      if(!account.rowCount) throw new HttpError(404,'CUSTOMER_NOT_FOUND','Клиент не найден в этом заведении.')
      const before=Number(account.rows[0]!.balance)
      if(type==='debit'&&before<amount) throw new HttpError(409,'INSUFFICIENT_BALANCE','Баланс клиента недостаточен.')
      const after=type==='credit'?before+amount:before-amount
      await client.query('UPDATE wallets SET balance=$1::bigint,updated_at=NOW() WHERE user_id=$2::bigint',[after,userId])
      const expected=expectedProductionShape(type,amount,reason)
      const tx=await client.query<{id:string}>(
        `INSERT INTO transactions(
          request_key,client_id,mode,status,bonus_spent,bonus_earned,balance_after,reason,reward_code,completed_at
         ) VALUES($1,$2::bigint,'adjustment','completed',$3::bigint,$4::bigint,$5::bigint,$6,$7,NOW())
         RETURNING id::text`,
        [requestKey,userId,expected.spent,expected.earned,after,expected.reason,expected.rewardCode],
      )
      response={userId,type,amount,balanceBefore:before,balanceAfter:after,transactionId:tx.rows[0]!.id,idempotent:false}
      await client.query('COMMIT')
    }
  }catch(error){
    await client.query('ROLLBACK').catch(()=>undefined)
    throw error
  }finally{client.release()}

  const metadataSynced=await finalizeWithRetry([admin,scope,userId,type,amount,reason,idempotencyKey,hash,response])
  return metadataSynced?response:{...response,metadataSynced:false}
}
