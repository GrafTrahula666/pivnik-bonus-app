import {requireSpaceverseTenantRuntime,SpaceverseRuntimeError} from './spaceverse-runtime-manifest.js'
import { SPACEVERSE_VERIFIED_CUSTOMER_BINDING_SQL } from './customer-wallet-repository.js'

export const DIRECTORY_SQL=`WITH ${SPACEVERSE_VERIFIED_CUSTOMER_BINDING_SQL}, eligible AS (
 SELECT customer.id,ownership.runtime_key AS ownership_runtime_key,
 ownership.company_id AS ownership_company_id,ownership.venue_id AS ownership_venue_id
 FROM verified_binding binding JOIN spaceverse_customer_ownership ownership
 ON ownership.runtime_key=binding.runtime_key AND ownership.company_id=binding.company_id AND ownership.venue_id=binding.venue_id
 JOIN users customer ON customer.id=ownership.user_id AND customer.deleted_at IS NULL
 AND customer.merged_into_user_id IS NULL AND customer.role='client'
 WHERE concat_ws(' ',customer.first_name,customer.last_name) ILIKE $6
 OR COALESCE(customer.username,'') ILIKE $6 OR customer.id::text ILIKE $6
), page AS (
 SELECT eligible.id::text AS user_id,eligible.id::text AS ownership_user_id,
 eligible.ownership_runtime_key,eligible.ownership_company_id,eligible.ownership_venue_id,
 customer.username,customer.first_name,customer.last_name,customer.photo_url,customer.role,
 wallet.balance::text AS wallet_balance,wallet.updated_at AS wallet_updated_at
 FROM eligible JOIN users customer ON customer.id=eligible.id
 LEFT JOIN wallets wallet ON wallet.user_id=eligible.id
 ORDER BY eligible.id LIMIT $7::integer OFFSET $8::integer
)
SELECT EXISTS(SELECT 1 FROM verified_binding) AS binding_verified,
 (SELECT COUNT(*)::text FROM eligible) AS total,page.*
FROM (SELECT TRUE) one LEFT JOIN page ON TRUE ORDER BY page.user_id::bigint`

const fail=(code,message)=>new SpaceverseRuntimeError(code,message)
export function createSpaceverseCustomerDirectoryRepository({query,runtime}){
 if(typeof query!=='function')throw new TypeError('query must be a function')
 const verified=requireSpaceverseTenantRuntime(runtime)
 return async function list(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Invalid directory options')
  if(Object.keys(options).some(key=>!['q','limit','offset'].includes(key)))throw fail('SPACEVERSE_DIRECTORY_REQUEST_SCOPE_FORBIDDEN','Directory scope is server-owned.')
  const {q='',limit=25,offset=0}=options
  if(typeof q!=='string'||q.length>100||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)throw new TypeError('Invalid directory query or page')
  const binding=verified.binding,context=verified.context
  const pattern='%'+q.trim().replace(/[\\%_]/g,'\\$&')+'%'
  let result
  try{result=await query(DIRECTORY_SQL,[binding.runtimeKey,binding.manifestSha256,binding.manifestRevision,context.tenantId,context.locationId,pattern,limit,offset])}
  catch{throw fail('SPACEVERSE_DIRECTORY_READ_UNAVAILABLE','Directory read is unavailable.')}
  const rows=result?.rows
  if(!Array.isArray(rows)||!rows.length||rows.length>Math.max(1,limit))throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Invalid directory result.')
  const total=rows[0].total
  if(typeof total!=='string'||!/^(0|[1-9]\d*)$/.test(total))throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Invalid directory count.')
  const items=[],ids=new Set()
  for(const row of rows){
   if(row.binding_verified!==true)throw fail('SPACEVERSE_DIRECTORY_BINDING_REJECTED','Directory binding changed.')
   if(row.total!==total)throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Inconsistent directory count.')
   if(row.user_id===null){
    if(rows.length!==1||BigInt(offset)<BigInt(total))throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Invalid empty directory page.')
    continue
   }
   const id=String(row.user_id)
   if(!/^[1-9]\d*$/.test(id)||String(row.ownership_user_id)!==id||ids.has(id)||
    row.ownership_runtime_key!==binding.runtimeKey||row.ownership_company_id!==context.tenantId||row.ownership_venue_id!==context.locationId||row.role!=='client')throw fail('SPACEVERSE_DIRECTORY_SCOPE_MISMATCH','Invalid directory scope.')
   ids.add(id)
   let wallet=null
   if(row.wallet_balance!==null){
    if(typeof row.wallet_balance!=='string'||!/^\d+$/.test(row.wallet_balance)||row.wallet_updated_at==null)throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Invalid directory wallet.')
    wallet=Object.freeze({balance:row.wallet_balance,updatedAt:row.wallet_updated_at})
   }
   items.push(Object.freeze({customer:Object.freeze({id,username:row.username??null,firstName:row.first_name??null,lastName:row.last_name??null,photoUrl:row.photo_url??null,role:'client'}),wallet}))
  }
  if(items.length&&BigInt(offset+items.length)>BigInt(total))throw fail('SPACEVERSE_DIRECTORY_INVALID_RESULT','Invalid directory page size.')
  return Object.freeze({q:q.trim(),total,limit,offset,hasMore:BigInt(offset+items.length)<BigInt(total),items:Object.freeze(items)})
 }
}
