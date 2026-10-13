import crypto from 'node:crypto'
import { config } from './config.js'
import { pool, readPool, writePool } from './db.js'
import { recordAudit } from './audit.js'
import { PIVNIK_LEGACY_STATUS_LEVELS } from './legacy-compat.js'
import { HttpError, type AdminPrincipal, type VenueScope } from './types.js'
import { parsePositiveId } from './tenant.js'

const MAX_BONUS_ADJUSTMENT = 1_000_000
const PROBABILITY_TOTAL_PPB = 1_000_000_000n

function requireWrites(): void {
  if (!config.enableWrites) throw new HttpError(405,'WRITES_DISABLED','Изменения отключены на этом окружении.')
}
function nonNegativeInt(value:unknown, name:string, max=10_000_000):number {
  const n=Number(value)
  if(!Number.isSafeInteger(n)||n<0||n>max) throw new HttpError(400,'INVALID_VALUE',`${name}: некорректное значение.`)
  return n
}
function positiveInt(value:unknown, name:string, max=MAX_BONUS_ADJUSTMENT):number {
  const n=Number(value)
  if(!Number.isSafeInteger(n)||n<=0||n>max) throw new HttpError(400,'INVALID_VALUE',`${name}: требуется целое положительное значение до ${max}.`)
  return n
}
function boundedPercent(value:unknown, name:string):number {
  const n=Number(value)
  if(!Number.isFinite(n)||n<0||n>100) throw new HttpError(400,'INVALID_PERCENT',`${name}: значение должно быть от 0 до 100%.`)
  return n
}
function text(value:unknown,name:string,min=1,max=500):string {
  const v=String(value??'').trim()
  if(v.length<min||v.length>max) throw new HttpError(400,'INVALID_TEXT',`${name}: длина должна быть ${min}–${max} символов.`)
  return v
}
function code(value:unknown,name='code'):string {
  const v=String(value??'').trim().toLowerCase()
  if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) throw new HttpError(400,'INVALID_CODE',`${name}: разрешены a-z, 0-9, _ и -.`)
  return v
}
function requestHash(value:unknown):string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function imageSource(value:unknown, name='image'):string|null {
  const v=String(value??'').trim()
  if(!v) return null
  if(/^https:\/\/[^\s]+$/i.test(v) && v.length<=2000) return v
  if(/^data:image\/(jpeg|png|webp);base64,/i.test(v) && Buffer.byteLength(v,'utf8')<=3_200_000) return v
  throw new HttpError(400,'INVALID_IMAGE',`${name}: разрешены HTTPS или JPG/PNG/WEBP data image до 3 МБ.`)
}
export function percentToPpb(raw:unknown):bigint {
  const value=String(raw??'').trim()
  const m=/^(\d{1,3})(?:\.(\d{1,7}))?$/.exec(value)
  if(!m) throw new HttpError(400,'INVALID_PROBABILITY','Вероятность должна быть decimal percent с максимум 7 знаками после запятой.')
  const whole=BigInt(m[1]!)
  const fraction=(m[2]||'').padEnd(7,'0')
  const ppb=whole*10_000_000n+BigInt(fraction||'0')
  if(ppb<0n||ppb>PROBABILITY_TOTAL_PPB) throw new HttpError(400,'INVALID_PROBABILITY','Вероятность должна быть от 0 до 100%.')
  return ppb
}
export function ppbToPercent(ppb:bigint|string|number):string {
  const n=BigInt(ppb)
  const whole=n/10_000_000n
  const rem=(n%10_000_000n).toString().padStart(7,'0').replace(/0+$/,'')
  return rem ? `${whole}.${rem}` : String(whole)
}

export interface BonusAdjustmentInput {
  type:'credit'|'debit'
  amount:number
  reason:string
  idempotencyKey:string
}
export function validateBonusAdjustmentInput(raw:unknown, rawUserId:string):BonusAdjustmentInput & {userId:string} {
  const body=(raw||{}) as Record<string,unknown>
  const type=body.type==='credit'?'credit':body.type==='debit'?'debit':null
  if(!type) throw new HttpError(400,'INVALID_ADJUSTMENT_TYPE','type должен быть credit или debit.')
  const amount=positiveInt(body.amount,'amount')
  const reason=text(body.reason,'reason',3,500)
  const idempotencyKey=text(body.idempotencyKey,'idempotencyKey',8,100)
  if(!/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY','Некорректный idempotency key.')
  const userId=parsePositiveId(rawUserId,'user_id')
  return {type,amount,reason,idempotencyKey,userId}
}
export async function adjustPivnikBonus(
  admin:AdminPrincipal,
  scope:VenueScope,
  rawUserId:string,
  raw:unknown,
):Promise<Record<string,unknown>> {
  requireWrites()
  if(!config.enableProductionBonusWrites) throw new HttpError(405,'PRODUCTION_BONUS_WRITES_DISABLED','Production bonus writes требуют отдельного pilot gate.')
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'LEGACY_WRITE_NOT_TENANT_SAFE','Legacy bonus writer разрешён только mapped PIVNIK tenant.')
  if(!writePool) throw new HttpError(503,'PRODUCTION_WRITER_UNAVAILABLE','Production writer не настроен.')

  const {type,amount,reason,idempotencyKey,userId}=validateBonusAdjustmentInput(raw,rawUserId)
  const hash=requestHash({type,amount,reason,userId})
  const client=await writePool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[userId])

    const idem=await client.query<{request_hash:string;response_json:Record<string,unknown>|null}>(
      `SELECT request_hash,response_json FROM admin_idempotency_keys
       WHERE admin_id=$1::bigint AND venue_id=$2::bigint AND operation='bonus-adjustment' AND idempotency_key=$3
       FOR UPDATE`,
      [admin.id,scope.id,idempotencyKey],
    )
    if(idem.rowCount){
      if(idem.rows[0]!.request_hash!==hash) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Этот idempotency key уже использован для другого запроса.')
      await client.query('COMMIT')
      return {...(idem.rows[0]!.response_json||{}),idempotent:true}
    }

    const account=await client.query<{balance:string;name:string}>(
      `SELECT w.balance::text,TRIM(CONCAT_WS(' ',u.first_name,u.last_name)) AS name
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

    await client.query(`UPDATE wallets SET balance=$1::bigint,updated_at=NOW() WHERE user_id=$2::bigint`,[after,userId])
    const requestKey=`admin:${scope.id}:${idempotencyKey}`
    const tx=await client.query<{id:string}>(
      `INSERT INTO transactions(
         request_key,client_id,mode,status,bonus_spent,bonus_earned,balance_after,reason,reward_code,completed_at
       ) VALUES($1,$2::bigint,'adjustment','completed',$3::bigint,$4::bigint,$5::bigint,$6,$7,NOW())
       RETURNING id::text`,
      [requestKey,userId,type==='debit'?amount:0,type==='credit'?amount:0,after,`Admin: ${reason}`,`admin:bonus:${type}`],
    )
    const txId=tx.rows[0]!.id
    await client.query(
      `INSERT INTO admin_bonus_adjustments(
        admin_id,company_id,venue_id,user_id,adjustment_type,amount,reason,production_transaction_id,idempotency_key
      ) VALUES($1::bigint,$2::bigint,$3::bigint,$4::bigint,$5,$6::bigint,$7,$8::bigint,$9)`,
      [admin.id,scope.companyId,scope.id,userId,type,amount,reason,txId,idempotencyKey],
    )
    const response={userId,type,amount,balanceBefore:before,balanceAfter:after,transactionId:txId,idempotent:false}
    await recordAudit({
      admin,scope,action:type==='credit'?'customer.bonus.credit':'customer.bonus.debit',
      entityType:'customer_wallet',entityId:userId,before:{balance:before},after:{balance:after,amount},reason,
      metadata:{productionTransactionId:txId,idempotencyKey},
    },client)
    await client.query(
      `INSERT INTO admin_idempotency_keys(admin_id,venue_id,operation,idempotency_key,request_hash,response_json)
       VALUES($1::bigint,$2::bigint,'bonus-adjustment',$3,$4,$5::jsonb)`,
      [admin.id,scope.id,idempotencyKey,hash,JSON.stringify(response)],
    )
    await client.query('COMMIT')
    return response
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined)
    throw error
  } finally { client.release() }
}

export interface LoyaltyPayload {
  baseCashbackPercent:number
  registrationBonus:number
  referralBonus:number
  levels:Array<{code:string;title:string;thresholdRub:number;bonusPercent:number;discountPercent?:number;enabled?:boolean;sortOrder?:number}>
}
export function validateLoyalty(raw:unknown):LoyaltyPayload {
  const b=(raw||{}) as Record<string,unknown>
  const levels=Array.isArray(b.levels)?b.levels:[]
  if(levels.length<1||levels.length>20) throw new HttpError(400,'INVALID_LEVELS','Нужно от 1 до 20 уровней.')
  const parsed=levels.map((entry,i)=>{
    const x=entry as Record<string,unknown>
    return {
      code:code(x.code,`levels[${i}].code`),title:text(x.title,`levels[${i}].title`,1,80),
      thresholdRub:nonNegativeInt(x.thresholdRub,`levels[${i}].thresholdRub`,100_000_000),
      bonusPercent:boundedPercent(x.bonusPercent,`levels[${i}].bonusPercent`),
      discountPercent:boundedPercent(x.discountPercent??0,`levels[${i}].discountPercent`),
      enabled:x.enabled!==false,sortOrder:Number.isSafeInteger(Number(x.sortOrder))?Number(x.sortOrder):i,
    }
  }).sort((a,b)=>a.sortOrder-b.sortOrder)
  if(new Set(parsed.map(x=>x.code)).size!==parsed.length) throw new HttpError(400,'DUPLICATE_LEVEL_CODE','Коды уровней должны быть уникальны.')
  let prev=-1
  for(const l of parsed.filter(x=>x.enabled)){if(l.thresholdRub<=prev)throw new HttpError(400,'INVALID_LEVEL_THRESHOLDS','Пороги активных уровней должны строго возрастать.');prev=l.thresholdRub}
  return {
    baseCashbackPercent:boundedPercent(b.baseCashbackPercent,'baseCashbackPercent'),
    registrationBonus:nonNegativeInt(b.registrationBonus,'registrationBonus',1_000_000),
    referralBonus:nonNegativeInt(b.referralBonus,'referralBonus',1_000_000),
    levels:parsed,
  }
}

export async function getManagedLoyalty(scope:VenueScope) {
  const settings=await pool.query(`SELECT base_cashback_percent,registration_bonus,referral_bonus FROM venue_settings WHERE venue_id=$1::bigint`,[scope.id])
  const levels=await pool.query(`SELECT code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order FROM loyalty_levels WHERE venue_id=$1::bigint ORDER BY sort_order,id`,[scope.id])
  if(settings.rowCount&&levels.rowCount){
    const s=settings.rows[0] as any
    return {source:'db',editable:true,baseCashbackPercent:Number(s.base_cashback_percent),registrationBonus:Number(s.registration_bonus),referralBonus:Number(s.referral_bonus),
      levels:levels.rows.map((r:any)=>({code:r.code,title:r.title,thresholdRub:Number(r.threshold_cents)/100,bonusPercent:Number(r.bonus_percent),discountPercent:Number(r.discount_percent),enabled:r.enabled,sortOrder:r.sort_order}))}
  }
  if(scope.companyCode==='pivnik') return {source:'legacy-fallback',editable:true,baseCashbackPercent:5,registrationBonus:100,referralBonus:0,
    levels:PIVNIK_LEGACY_STATUS_LEVELS.map((l,i)=>({code:`legacy-${i+1}`,title:l.name,thresholdRub:l.minCents/100,bonusPercent:l.bonusPercent,discountPercent:l.discountPercent,enabled:true,sortOrder:i}))}
  return {source:'unconfigured',editable:true,baseCashbackPercent:0,registrationBonus:0,referralBonus:0,levels:[]}
}
export async function saveLoyalty(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const value=validateLoyalty(raw);const client=await pool.connect()
  try{await client.query('BEGIN');const before=await getManagedLoyalty(scope)
    await client.query(`INSERT INTO venue_settings(venue_id,base_cashback_percent,registration_bonus,referral_bonus,updated_by)
      VALUES($1::bigint,$2,$3::bigint,$4::bigint,$5::bigint)
      ON CONFLICT(venue_id) DO UPDATE SET base_cashback_percent=EXCLUDED.base_cashback_percent,registration_bonus=EXCLUDED.registration_bonus,referral_bonus=EXCLUDED.referral_bonus,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [scope.id,value.baseCashbackPercent,value.registrationBonus,value.referralBonus,admin.id])
    await client.query(`DELETE FROM loyalty_levels WHERE venue_id=$1::bigint`,[scope.id])
    for(const l of value.levels) await client.query(`INSERT INTO loyalty_levels(venue_id,code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order)
      VALUES($1::bigint,$2,$3,$4::bigint,$5,$6,$7,$8)`,[scope.id,l.code,l.title,l.thresholdRub*100,l.bonusPercent,l.discountPercent,l.enabled,l.sortOrder])
    await recordAudit({admin,scope,action:'loyalty.config.save',entityType:'loyalty_config',entityId:scope.id,before,after:value,reason:'Admin save'},client)
    await client.query('COMMIT');return {...value,source:'db'}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export interface WheelPayload {
  enabled:boolean;cooldownMinutes:number;retryCost:number;
  prizes:Array<{code:string;title:string;rewardType:string;rewardValue:Record<string,unknown>;probability:string;inventoryLimit:number|null;enabled:boolean;sortOrder:number}>
}

function validateRewardValue(rewardType:string, raw:unknown, field='rewardValue'):Record<string,unknown>{
  const value=(raw&&typeof raw==='object'?raw:{}) as Record<string,unknown>
  if(rewardType==='bonus'||rewardType==='beer_ml'){
    const amount=positiveInt(value.amount,`${field}.amount`,10_000_000)
    return {amount}
  }
  if(rewardType==='item'||rewardType==='frame'){
    return {code:code(value.code,`${field}.code`)}
  }
  if(rewardType==='retry'){
    const count=value.count===undefined?1:positiveInt(value.count,`${field}.count`,100)
    return {count}
  }
  if(rewardType==='none') return {}
  throw new HttpError(400,'INVALID_REWARD_TYPE','Некорректный тип награды.')
}

export function validateWheel(raw:unknown):WheelPayload{
  const b=(raw||{}) as Record<string,unknown>, prizes=Array.isArray(b.prizes)?b.prizes:[]
  if(prizes.length<1||prizes.length>100)throw new HttpError(400,'INVALID_PRIZES','Нужно от 1 до 100 призов.')
  const parsed=prizes.map((entry,i)=>{const x=entry as Record<string,unknown>;const rewardType=String(x.rewardType||'')
    if(!['bonus','beer_ml','item','frame','retry','none'].includes(rewardType))throw new HttpError(400,'INVALID_REWARD_TYPE','Некорректный тип награды.')
    const probability=String(x.probability??'0');percentToPpb(probability)
    const inv=x.inventoryLimit===null||x.inventoryLimit===undefined?null:nonNegativeInt(x.inventoryLimit,'inventoryLimit',10_000_000)
    return {code:code(x.code),title:text(x.title,'title',1,100),rewardType,rewardValue:validateRewardValue(rewardType,x.rewardValue),probability,inventoryLimit:inv,enabled:x.enabled!==false,sortOrder:Number.isSafeInteger(Number(x.sortOrder))?Number(x.sortOrder):i}})
  if(new Set(parsed.map(x=>x.code)).size!==parsed.length)throw new HttpError(400,'DUPLICATE_PRIZE_CODE','Коды призов должны быть уникальны.')
  const total=parsed.filter(x=>x.enabled).reduce((s,x)=>s+percentToPpb(x.probability),0n)
  if(total!==PROBABILITY_TOTAL_PPB)throw new HttpError(400,'WHEEL_PROBABILITY_TOTAL',`Сумма вероятностей активных призов должна быть ровно 100%, сейчас ${ppbToPercent(total)}%.`)
  return {enabled:b.enabled!==false,cooldownMinutes:nonNegativeInt(b.cooldownMinutes,'cooldownMinutes',525_600),retryCost:nonNegativeInt(b.retryCost,'retryCost',1_000_000),prizes:parsed}
}
export async function getManagedWheel(scope:VenueScope){
  const c=await pool.query(`SELECT enabled,cooldown_minutes,retry_cost,version FROM wheel_configs WHERE venue_id=$1::bigint`,[scope.id])
  const p=await pool.query(`SELECT code,title,reward_type,reward_value,probability_ppb,inventory_limit,enabled,sort_order FROM wheel_prizes WHERE venue_id=$1::bigint ORDER BY sort_order,id`,[scope.id])
  return {source:c.rowCount?'db':'unconfigured',enabled:c.rows[0]?.enabled??null,cooldownMinutes:c.rows[0]?.cooldown_minutes??null,retryCost:c.rows[0]?.retry_cost??null,version:c.rows[0]?.version??0,
    prizes:p.rows.map((r:any)=>({code:r.code,title:r.title,rewardType:r.reward_type,rewardValue:r.reward_value,probability:ppbToPercent(r.probability_ppb),inventoryLimit:r.inventory_limit,enabled:r.enabled,sortOrder:r.sort_order}))}
}
export async function saveWheel(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const value=validateWheel(raw);const client=await pool.connect()
  try{await client.query('BEGIN');const before=await getManagedWheel(scope)
    await client.query(`INSERT INTO wheel_configs(venue_id,enabled,cooldown_minutes,retry_cost,updated_by)
      VALUES($1::bigint,$2,$3,$4::bigint,$5::bigint)
      ON CONFLICT(venue_id) DO UPDATE SET enabled=EXCLUDED.enabled,cooldown_minutes=EXCLUDED.cooldown_minutes,retry_cost=EXCLUDED.retry_cost,version=wheel_configs.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [scope.id,value.enabled,value.cooldownMinutes,value.retryCost,admin.id])
    await client.query(`DELETE FROM wheel_prizes WHERE venue_id=$1::bigint`,[scope.id])
    for(const prize of value.prizes)await client.query(`INSERT INTO wheel_prizes(venue_id,code,title,reward_type,reward_value,probability_ppb,inventory_limit,enabled,sort_order)
      VALUES($1::bigint,$2,$3,$4,$5::jsonb,$6::bigint,$7,$8,$9)`,
      [scope.id,prize.code,prize.title,prize.rewardType,JSON.stringify(prize.rewardValue),percentToPpb(prize.probability).toString(),prize.inventoryLimit,prize.enabled,prize.sortOrder])
    await recordAudit({admin,scope,action:'wheel.config.save',entityType:'wheel_config',entityId:scope.id,before,after:value,reason:'Probability/reward publish'},client)
    await client.query('COMMIT');return {...value,source:'db'}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}


export async function getManagedFeatures(scope:VenueScope){
  const r=await pool.query(`SELECT wheel_enabled,shop_enabled,achievements_enabled,referrals_enabled,promotions_enabled,branding_enabled
    FROM venue_settings WHERE venue_id=$1::bigint`,[scope.id])
  const row=(r.rows[0]||{}) as Record<string,boolean|null|undefined>
  return {
    wheelEnabled:row.wheel_enabled??null,
    shopEnabled:row.shop_enabled??null,
    achievementsEnabled:row.achievements_enabled??null,
    referralsEnabled:row.referrals_enabled??null,
    promotionsEnabled:row.promotions_enabled??null,
    brandingEnabled:row.branding_enabled??null,
    fallback:'null means existing production behavior',
  }
}
export async function saveFeatureSettings(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const b=(raw||{}) as Record<string,unknown>
  const keys=['wheelEnabled','shopEnabled','achievementsEnabled','referralsEnabled','promotionsEnabled','brandingEnabled'] as const
  const vals=keys.map(k=>b[k]===null||b[k]===undefined?null:Boolean(b[k]))
  const before=await pool.query(`SELECT wheel_enabled,shop_enabled,achievements_enabled,referrals_enabled,promotions_enabled,branding_enabled FROM venue_settings WHERE venue_id=$1::bigint`,[scope.id])
  const client=await pool.connect()
  try{await client.query('BEGIN')
    await client.query(`INSERT INTO venue_settings(venue_id,wheel_enabled,shop_enabled,achievements_enabled,referrals_enabled,promotions_enabled,branding_enabled,updated_by)
      VALUES($1::bigint,$2,$3,$4,$5,$6,$7,$8::bigint)
      ON CONFLICT(venue_id) DO UPDATE SET wheel_enabled=EXCLUDED.wheel_enabled,shop_enabled=EXCLUDED.shop_enabled,achievements_enabled=EXCLUDED.achievements_enabled,referrals_enabled=EXCLUDED.referrals_enabled,promotions_enabled=EXCLUDED.promotions_enabled,branding_enabled=EXCLUDED.branding_enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [scope.id,...vals,admin.id])
    await recordAudit({admin,scope,action:'venue.features.save',entityType:'venue_settings',entityId:scope.id,before:before.rows[0]||null,after:Object.fromEntries(keys.map((k,i)=>[k,vals[i]])),reason:'Feature flags; null means legacy behavior'},client)
    await client.query('COMMIT');return {ok:true}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export function promotionState(row:{enabled:boolean;starts_at?:string|null;ends_at?:string|null}, now=new Date()):'DRAFT'|'SCHEDULED'|'ACTIVE'|'FINISHED'|'DISABLED'{
  const start=row.starts_at?new Date(row.starts_at):null,end=row.ends_at?new Date(row.ends_at):null
  if(!row.enabled)return start||end?'DISABLED':'DRAFT'
  if(start&&start>now)return 'SCHEDULED'
  if(end&&end<=now)return 'FINISHED'
  return 'ACTIVE'
}


export async function getManagedAchievements(scope:VenueScope){
  const r=await pool.query(`SELECT id::text,code,title,description,image_src,condition_type,threshold_value,reward_value,visibility,enabled,sort_order,legacy_code
    FROM achievement_configs WHERE venue_id=$1::bigint ORDER BY sort_order,id`,[scope.id])
  return {source:r.rowCount?'db':'unconfigured',items:r.rows}
}
export async function saveAchievements(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const b=(raw||{}) as Record<string,unknown>, items=Array.isArray(b.items)?b.items:[]
  if(items.length>200)throw new HttpError(400,'TOO_MANY_ACHIEVEMENTS','Слишком много достижений.')
  const parsed=items.map((entry,i)=>{const x=entry as Record<string,unknown>
    const conditionType=text(x.conditionType,'conditionType',1,64)
    const visibility=x.visibility==='hidden'?'hidden':'public'
    const rewardRaw=(x.rewardValue&&typeof x.rewardValue==='object'?x.rewardValue:{}) as Record<string,unknown>
    const reward:Record<string,unknown>={}
    if(rewardRaw.bonus!==undefined) reward.bonus=nonNegativeInt(rewardRaw.bonus,'rewardValue.bonus',10_000_000)
    if(rewardRaw.frame!==undefined&&String(rewardRaw.frame).trim()) reward.frame=code(rewardRaw.frame,'rewardValue.frame')
    if(rewardRaw.beerMl!==undefined) reward.beerMl=nonNegativeInt(rewardRaw.beerMl,'rewardValue.beerMl',10_000_000)
    return {code:code(x.code),title:text(x.title,'title',1,120),description:String(x.description||'').slice(0,1000),imageSrc:imageSource(x.imageSrc,'imageSrc'),
      conditionType,thresholdValue:x.thresholdValue===null||x.thresholdValue===undefined?null:Number(x.thresholdValue),rewardValue:reward,visibility,enabled:x.enabled!==false,
      sortOrder:Number.isSafeInteger(Number(x.sortOrder))?Number(x.sortOrder):i,legacyCode:x.legacyCode?String(x.legacyCode).slice(0,100):null}
  })
  if(new Set(parsed.map(x=>x.code)).size!==parsed.length)throw new HttpError(400,'DUPLICATE_ACHIEVEMENT_CODE','Коды достижений должны быть уникальны.')
  for(const x of parsed)if(x.thresholdValue!==null&&(!Number.isFinite(x.thresholdValue)||x.thresholdValue<0))throw new HttpError(400,'INVALID_THRESHOLD','Threshold должен быть неотрицательным.')
  const client=await pool.connect()
  try{await client.query('BEGIN');const before=await getManagedAchievements(scope)
    await client.query(`DELETE FROM achievement_configs WHERE venue_id=$1::bigint`,[scope.id])
    for(const x of parsed)await client.query(`INSERT INTO achievement_configs(venue_id,code,title,description,image_src,condition_type,threshold_value,reward_value,visibility,enabled,sort_order,legacy_code)
      VALUES($1::bigint,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
      [scope.id,x.code,x.title,x.description,x.imageSrc,x.conditionType,x.thresholdValue,JSON.stringify(x.rewardValue),x.visibility,x.enabled,x.sortOrder,x.legacyCode])
    await recordAudit({admin,scope,action:'achievements.config.save',entityType:'achievement_config',entityId:scope.id,before,after:{items:parsed},reason:'Achievement manager save'},client)
    await client.query('COMMIT');return {source:'db',items:parsed}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export async function manualGrantAchievement(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,raw:unknown){
  requireWrites()
  if(!config.enableProductionAchievementWrites)throw new HttpError(405,'PRODUCTION_ACHIEVEMENT_WRITES_DISABLED','Manual production achievement grants требуют отдельного pilot gate.')
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId)throw new HttpError(409,'LEGACY_WRITE_NOT_TENANT_SAFE','Legacy achievement writer разрешён только PIVNIK.')
  if(!writePool)throw new HttpError(503,'PRODUCTION_WRITER_UNAVAILABLE','Production writer не настроен.')
  const b=(raw||{}) as Record<string,unknown>
  const achievementCode=code(b.achievementCode,'achievementCode'), reason=text(b.reason,'reason',3,500), idempotencyKey=text(b.idempotencyKey,'idempotencyKey',8,100)
  const userId=parsePositiveId(rawUserId,'user_id'), hash=requestHash({userId,achievementCode,reason})
  const configRow=await pool.query<{reward_value:Record<string,unknown>}>(
    `SELECT reward_value FROM achievement_configs WHERE venue_id=$1::bigint AND code=$2 AND enabled=TRUE LIMIT 1`,[scope.id,achievementCode])
  const reward=configRow.rows[0]?.reward_value||{}
  const bonus=reward.bonus===undefined?0:nonNegativeInt(reward.bonus,'reward.bonus',MAX_BONUS_ADJUSTMENT)
  const frame=reward.frame?code(reward.frame,'reward.frame'):null

  const client=await writePool.connect()
  try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[userId])
    const idem=await client.query<{request_hash:string;response_json:any}>(`SELECT request_hash,response_json FROM admin_idempotency_keys
      WHERE admin_id=$1::bigint AND venue_id=$2::bigint AND operation='achievement-grant' AND idempotency_key=$3 FOR UPDATE`,[admin.id,scope.id,idempotencyKey])
    if(idem.rowCount){if(idem.rows[0]!.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Idempotency key уже использован.');await client.query('COMMIT');return {...idem.rows[0]!.response_json,idempotent:true}}
    const member=await client.query(`SELECT 1 FROM bar_customers bc JOIN users u ON u.id=bc.user_id
      WHERE bc.bar_id=$1::bigint AND bc.user_id=$2::bigint AND bc.status='active' AND u.role='client' AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`,[scope.legacyBarId,userId])
    if(!member.rowCount)throw new HttpError(404,'CUSTOMER_NOT_FOUND','Клиент не найден в этом заведении.')
    const existing=await client.query<{is_granted:boolean}>(`SELECT is_granted FROM user_achievements_v2 WHERE user_id=$1::bigint AND achievement_code=$2 FOR UPDATE`,[userId,achievementCode])
    if(existing.rows[0]?.is_granted)throw new HttpError(409,'ACHIEVEMENT_ALREADY_GRANTED','Достижение уже выдано.')

    const grantCode=`admin-achievement:${scope.id}:${achievementCode}:${idempotencyKey}`
    const grant=await client.query<{code:string}>(
      `INSERT INTO reward_grants(
         code,user_id,amount,source,achievement_code,achievement_period,reward_beer_ml
       ) VALUES($1,$2::bigint,$3::bigint,'achievement',$4,NULL,0)
       ON CONFLICT(code,user_id) DO NOTHING
       RETURNING code`,
      [grantCode,userId,bonus,achievementCode],
    )
    if(!grant.rowCount) throw new HttpError(409,'ACHIEVEMENT_GRANT_DUPLICATE','Reward grant already exists.')

    let balanceAfter:number|null=null, txId:string|null=null
    if(bonus>0){
      const wallet=await client.query<{balance:string}>(`SELECT balance::text FROM wallets WHERE user_id=$1::bigint FOR UPDATE`,[userId])
      if(!wallet.rowCount)throw new HttpError(409,'WALLET_NOT_FOUND','У клиента нет кошелька.')
      balanceAfter=Number(wallet.rows[0]!.balance)+bonus
      await client.query(`UPDATE wallets SET balance=$1::bigint,updated_at=NOW() WHERE user_id=$2::bigint`,[balanceAfter,userId])
      const tx=await client.query<{id:string}>(`INSERT INTO transactions(request_key,client_id,mode,status,bonus_earned,balance_after,reason,reward_code,completed_at)
        VALUES($1,$2::bigint,'achievement','completed',$3::bigint,$4::bigint,$5,$6,NOW()) RETURNING id::text`,
        [`admin-achievement:${scope.id}:${idempotencyKey}`,userId,bonus,balanceAfter,`Admin achievement: ${reason}`,`achievement:${achievementCode}`])
      txId=tx.rows[0]!.id
    }
    await client.query(`INSERT INTO user_achievements_v2(user_id,achievement_code,is_granted,granted_at,current_progress,required_progress,last_progress_check_at)
      VALUES($1::bigint,$2,TRUE,NOW(),1,1,NOW())
      ON CONFLICT(user_id,achievement_code) DO UPDATE SET is_granted=TRUE,granted_at=COALESCE(user_achievements_v2.granted_at,NOW()),current_progress=GREATEST(user_achievements_v2.current_progress,1),required_progress=GREATEST(user_achievements_v2.required_progress,1),last_progress_check_at=NOW()`,
      [userId,achievementCode])
    if(frame)await client.query(`INSERT INTO user_frames(user_id,frame_id,acquired_source) VALUES($1::bigint,$2,'admin') ON CONFLICT(user_id,frame_id) DO NOTHING`,[userId,frame])
    await client.query(`INSERT INTO manual_achievement_grants(admin_id,company_id,venue_id,user_id,achievement_code,reason,idempotency_key)
      VALUES($1::bigint,$2::bigint,$3::bigint,$4::bigint,$5,$6,$7)`,[admin.id,scope.companyId,scope.id,userId,achievementCode,reason,idempotencyKey])
    const response={userId,achievementCode,bonus,frame,balanceAfter,transactionId:txId,idempotent:false}
    await recordAudit({admin,scope,action:'customer.achievement.grant',entityType:'customer_achievement',entityId:`${userId}:${achievementCode}`,before:{granted:false},after:{granted:true,bonus,frame},reason,metadata:{transactionId:txId,idempotencyKey,rewardGrantCode:grantCode}},client)
    await client.query(`INSERT INTO admin_idempotency_keys(admin_id,venue_id,operation,idempotency_key,request_hash,response_json)
      VALUES($1::bigint,$2::bigint,'achievement-grant',$3,$4,$5::jsonb)`,[admin.id,scope.id,idempotencyKey,hash,JSON.stringify(response)])
    await client.query('COMMIT');return response
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export async function getManagedShop(scope:VenueScope){
  const r=await pool.query(`SELECT id::text,code,title,description,image_src,category,reward_type,reward_value,bonus_price,stock,purchase_limit,enabled,sort_order,legacy_code
    FROM shop_item_configs WHERE venue_id=$1::bigint ORDER BY sort_order,id`,[scope.id])
  return {source:r.rowCount?'db':'unconfigured',items:r.rows}
}
export async function saveShop(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const items:any[]=Array.isArray((raw as any)?.items)?(raw as any).items:[]
  if(items.length>500)throw new HttpError(400,'TOO_MANY_ITEMS','Слишком много товаров.')
  const parsed=items.map((entry:any,i:number)=>({
    code:code(entry.code),title:text(entry.title,'title',1,140),description:String(entry.description||'').slice(0,1500),imageSrc:imageSource(entry.imageSrc,'imageSrc'),
    category:text(entry.category||'other','category',1,60),rewardType:text(entry.rewardType||'item','rewardType',1,60),
    rewardValue:(entry.rewardValue&&typeof entry.rewardValue==='object'?entry.rewardValue:{}),bonusPrice:nonNegativeInt(entry.bonusPrice,'bonusPrice',100_000_000),
    stock:entry.stock===null||entry.stock===undefined?null:nonNegativeInt(entry.stock,'stock',100_000_000),
    purchaseLimit:entry.purchaseLimit===null||entry.purchaseLimit===undefined?null:nonNegativeInt(entry.purchaseLimit,'purchaseLimit',1_000_000),
    enabled:entry.enabled!==false,sortOrder:Number.isSafeInteger(Number(entry.sortOrder))?Number(entry.sortOrder):i,legacyCode:entry.legacyCode?String(entry.legacyCode).slice(0,100):null
  }))
  if(new Set(parsed.map(x=>x.code)).size!==parsed.length)throw new HttpError(400,'DUPLICATE_ITEM_CODE','Коды товаров должны быть уникальны.')
  const client=await pool.connect()
  try{await client.query('BEGIN');const before=await getManagedShop(scope);await client.query(`DELETE FROM shop_item_configs WHERE venue_id=$1::bigint`,[scope.id])
    for(const x of parsed)await client.query(`INSERT INTO shop_item_configs(venue_id,code,title,description,image_src,category,reward_type,reward_value,bonus_price,stock,purchase_limit,enabled,sort_order,legacy_code)
      VALUES($1::bigint,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::bigint,$10,$11,$12,$13,$14)`,
      [scope.id,x.code,x.title,x.description,x.imageSrc,x.category,x.rewardType,JSON.stringify(x.rewardValue),x.bonusPrice,x.stock,x.purchaseLimit,x.enabled,x.sortOrder,x.legacyCode])
    await recordAudit({admin,scope,action:'shop.config.save',entityType:'shop_config',entityId:scope.id,before,after:{items:parsed},reason:'Shop manager save'},client)
    await client.query('COMMIT');return {source:'db',items:parsed}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export async function getManagedPromotions(scope:VenueScope){
  const r=await pool.query(`SELECT id::text,code,title,description,image_src,starts_at,ends_at,mechanic,reward,multiplier,enabled,sort_order
    FROM promotion_configs WHERE venue_id=$1::bigint ORDER BY sort_order,id`,[scope.id])
  return {source:r.rowCount?'db':'unconfigured',items:r.rows.map((x:any)=>({...x,state:promotionState(x)}))}
}
export async function savePromotions(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const items:any[]=Array.isArray((raw as any)?.items)?(raw as any).items:[]
  const parsed=items.map((entry:any,i:number)=>{const startsAt=entry.startsAt?new Date(entry.startsAt):null,endsAt=entry.endsAt?new Date(entry.endsAt):null
    if(startsAt&&Number.isNaN(startsAt.getTime())||endsAt&&Number.isNaN(endsAt.getTime()))throw new HttpError(400,'INVALID_PROMOTION_DATE','Некорректная дата акции.')
    if(startsAt&&endsAt&&endsAt<=startsAt)throw new HttpError(400,'INVALID_PROMOTION_RANGE','end_at должен быть позже start_at.')
    const multiplier=entry.multiplier===null||entry.multiplier===undefined?null:Number(entry.multiplier);if(multiplier!==null&&(!Number.isFinite(multiplier)||multiplier<0||multiplier>1000))throw new HttpError(400,'INVALID_MULTIPLIER','Некорректный multiplier.')
    return {code:code(entry.code),title:text(entry.title,'title',1,140),description:String(entry.description||'').slice(0,1500),imageSrc:imageSource(entry.imageSrc,'imageSrc'),
      startsAt:startsAt?.toISOString()||null,endsAt:endsAt?.toISOString()||null,mechanic:(entry.mechanic&&typeof entry.mechanic==='object'?entry.mechanic:{}),reward:(entry.reward&&typeof entry.reward==='object'?entry.reward:{}),
      multiplier,enabled:entry.enabled===true,sortOrder:Number.isSafeInteger(Number(entry.sortOrder))?Number(entry.sortOrder):i}}
  )
  if(new Set(parsed.map(x=>x.code)).size!==parsed.length)throw new HttpError(400,'DUPLICATE_PROMOTION_CODE','Коды акций должны быть уникальны.')
  const client=await pool.connect()
  try{await client.query('BEGIN');const before=await getManagedPromotions(scope);await client.query(`DELETE FROM promotion_configs WHERE venue_id=$1::bigint`,[scope.id])
    for(const x of parsed)await client.query(`INSERT INTO promotion_configs(venue_id,code,title,description,image_src,starts_at,ends_at,mechanic,reward,multiplier,enabled,sort_order)
      VALUES($1::bigint,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)`,
      [scope.id,x.code,x.title,x.description,x.imageSrc,x.startsAt,x.endsAt,JSON.stringify(x.mechanic),JSON.stringify(x.reward),x.multiplier,x.enabled,x.sortOrder])
    await recordAudit({admin,scope,action:'promotions.config.save',entityType:'promotion_config',entityId:scope.id,before,after:{items:parsed},reason:'Promotion manager save'},client)
    await client.query('COMMIT');return {source:'db',items:parsed.map(x=>({...x,state:promotionState({enabled:x.enabled,starts_at:x.startsAt,ends_at:x.endsAt})}))}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}

export async function getManagedBranding(scope:VenueScope){
  const r=await pool.query(`SELECT branding_enabled,branding,phone,links FROM venue_settings WHERE venue_id=$1::bigint`,[scope.id])
  const venue=await pool.query<{name:string;address:string|null}>(`SELECT name,address FROM venues WHERE id=$1::bigint`,[scope.id])
  const row=r.rows[0] as any
  return {source:row?.branding_enabled===true?'db':'legacy-fallback',brandingEnabled:row?.branding_enabled??null,branding:row?.branding||{},phone:row?.phone||null,links:row?.links||{},venue:venue.rows[0]||{name:scope.name,address:scope.address}}
}
export async function saveBranding(admin:AdminPrincipal,scope:VenueScope,raw:unknown){
  requireWrites();const b=(raw||{}) as Record<string,unknown>, branding=(b.branding&&typeof b.branding==='object'?b.branding:{}) as Record<string,unknown>
  const allowed=['logo','cover','primaryAccent','secondaryAccent','theme','background'] as const
  const clean:Record<string,unknown>={}
  for(const k of allowed)if(branding[k]!==undefined){
    const rawValue=branding[k]
    if(k==='logo'||k==='cover') clean[k]=imageSource(rawValue,k)
    else {
      const v=String(rawValue??'').slice(0,1000)
      if((k==='primaryAccent'||k==='secondaryAccent')&&!/^#[0-9A-Fa-f]{6}$/.test(v))throw new HttpError(400,'INVALID_COLOR',`${k}: нужен #RRGGBB.`)
      clean[k]=v
    }
  }
  const phone=b.phone?String(b.phone).slice(0,80):null,links=(b.links&&typeof b.links==='object'?b.links:{})
  const venueName=b.venueName?text(b.venueName,'venueName',1,140):scope.name
  const venueAddress=b.address===null?null:b.address===undefined?scope.address:String(b.address).trim().slice(0,300)
  const before=await getManagedBranding(scope);const client=await pool.connect()
  try{await client.query('BEGIN')
    await client.query(`UPDATE venues SET name=$2,address=$3,updated_at=NOW() WHERE id=$1::bigint`,[scope.id,venueName,venueAddress])
    await client.query(`INSERT INTO venue_settings(venue_id,branding_enabled,branding,phone,links,updated_by)
    VALUES($1::bigint,$2,$3::jsonb,$4,$5::jsonb,$6::bigint)
    ON CONFLICT(venue_id) DO UPDATE SET branding_enabled=EXCLUDED.branding_enabled,branding=EXCLUDED.branding,phone=EXCLUDED.phone,links=EXCLUDED.links,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [scope.id,b.brandingEnabled===true,JSON.stringify(clean),phone,JSON.stringify(links),admin.id])
    await recordAudit({admin,scope,action:'branding.config.save',entityType:'venue_branding',entityId:scope.id,before,after:{brandingEnabled:b.brandingEnabled===true,branding:clean,phone,links,venueName,address:venueAddress},reason:'Branding save; customer runtime still uses legacy fallback until pilot'},client)
    await client.query('COMMIT');return getManagedBranding(scope)
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}


export async function setCustomerCashbackOverride(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,raw:unknown){
  requireWrites();const userId=parsePositiveId(rawUserId,'user_id'),b=(raw||{}) as Record<string,unknown>
  const cashbackPercent=boundedPercent(b.cashbackPercent,'cashbackPercent'),reason=text(b.reason,'reason',3,500),enabled=b.enabled!==false
  // Ownership is verified against the legacy membership for PIVNIK. Native future tenants must use their own venue-attributed customer store.
  if(scope.companyCode==='pivnik'){
    if(!scope.legacyBarId)throw new HttpError(409,'VENUE_NOT_MAPPED','Venue not mapped.')
    const membership=await readPool.query(`SELECT 1 FROM bar_customers bc JOIN users u ON u.id=bc.user_id
      WHERE bc.bar_id=$1::bigint AND bc.user_id=$2::bigint AND bc.status='active' AND u.role='client' AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`,
      [scope.legacyBarId,userId])
    if(!membership.rowCount)throw new HttpError(404,'CUSTOMER_NOT_FOUND','Клиент не найден в этом заведении.')
  } else throw new HttpError(409,'CUSTOMER_SOURCE_NOT_TENANT_SAFE','Для этого tenant ещё нет venue-attributed customer source.')
  const before=await pool.query(`SELECT cashback_percent,reason,enabled FROM customer_cashback_overrides WHERE venue_id=$1::bigint AND user_id=$2::bigint`,[scope.id,userId])
  const client=await pool.connect()
  try{await client.query('BEGIN');await client.query(`INSERT INTO customer_cashback_overrides(company_id,venue_id,user_id,cashback_percent,reason,enabled,updated_by)
    VALUES($1::bigint,$2::bigint,$3::bigint,$4,$5,$6,$7::bigint)
    ON CONFLICT(venue_id,user_id) DO UPDATE SET cashback_percent=EXCLUDED.cashback_percent,reason=EXCLUDED.reason,enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
    [scope.companyId,scope.id,userId,cashbackPercent,reason,enabled,admin.id])
    await recordAudit({admin,scope,action:'customer.cashback.override',entityType:'customer_cashback',entityId:userId,before:before.rows[0]||null,after:{cashbackPercent,reason,enabled},reason},client)
    await client.query('COMMIT');return {userId,cashbackPercent,reason,enabled,runtimeActive:false,compatibility:'DB override -> future adapter; legacy STATUS_LEVELS fallback remains active'}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}


export async function grantCustomerEntitlement(admin:AdminPrincipal,scope:VenueScope,rawUserId:string,raw:unknown){
  requireWrites()
  if(scope.companyCode!=='pivnik'||!scope.legacyBarId) throw new HttpError(409,'CUSTOMER_SOURCE_NOT_TENANT_SAFE','Customer entitlement adapter пока доступен только mapped PIVNIK.')
  const b=(raw||{}) as Record<string,unknown>
  const entitlementType=String(b.entitlementType||'')
  if(!['item','frame','digital_reward'].includes(entitlementType)) throw new HttpError(400,'INVALID_ENTITLEMENT_TYPE','Тип должен быть item, frame или digital_reward.')
  const entitlementCode=code(b.entitlementCode,'entitlementCode')
  const reason=text(b.reason,'reason',3,500)
  const idempotencyKey=text(b.idempotencyKey,'idempotencyKey',8,100)
  const userId=parsePositiveId(rawUserId,'user_id')
  const membership=await readPool.query(`SELECT 1 FROM bar_customers bc JOIN users u ON u.id=bc.user_id
    WHERE bc.bar_id=$1::bigint AND bc.user_id=$2::bigint AND bc.status='active' AND u.role='client' AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`,
    [scope.legacyBarId,userId])
  if(!membership.rowCount) throw new HttpError(404,'CUSTOMER_NOT_FOUND','Клиент не найден в этом заведении.')

  const actualFrameWrite=entitlementType==='frame'&&config.enableProductionEntitlementWrites
  if(actualFrameWrite&&!writePool) throw new HttpError(503,'PRODUCTION_WRITER_UNAVAILABLE','Production entitlement writer не настроен.')
  const db=actualFrameWrite?writePool!:pool
  const client=await db.connect()
  try{
    await client.query('BEGIN')
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`entitlement:${scope.id}:${userId}:${entitlementType}:${entitlementCode}`])
    const existing=await client.query(`SELECT id FROM admin_customer_entitlements
      WHERE venue_id=$1::bigint AND user_id=$2::bigint AND entitlement_type=$3 AND entitlement_code=$4`,
      [scope.id,userId,entitlementType,entitlementCode])
    if(existing.rowCount) throw new HttpError(409,'ENTITLEMENT_ALREADY_GRANTED','Эта награда уже выдана клиенту.')
    if(actualFrameWrite){
      await client.query(`INSERT INTO user_frames(user_id,frame_id,acquired_source)
        VALUES($1::bigint,$2,'admin') ON CONFLICT(user_id,frame_id) DO NOTHING`,[userId,entitlementCode])
    }
    await client.query(`INSERT INTO admin_customer_entitlements(
      company_id,venue_id,user_id,entitlement_type,entitlement_code,source,granted_by,reason
    ) VALUES($1::bigint,$2::bigint,$3::bigint,$4,$5,'admin',$6::bigint,$7)`,
      [scope.companyId,scope.id,userId,entitlementType,entitlementCode,admin.id,reason])
    const after={entitlementType,entitlementCode,runtimeActive:actualFrameWrite}
    await recordAudit({admin,scope,action:'customer.entitlement.grant',entityType:'customer_entitlement',entityId:`${userId}:${entitlementType}:${entitlementCode}`,before:null,after,reason,metadata:{idempotencyKey}},client)
    await client.query('COMMIT')
    return {userId,...after,compatibility:actualFrameWrite?'production user_frames updated':'Admin entitlement stored; customer runtime adapter not enabled'}
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}
