import { posDashboards } from '../../pos/analytics.js'
import { loadPosDocuments,posConnectionStatus,type PosReadDb } from '../../pos/repository.js'
import type { PeriodRange,VenueScope } from './types.js'

export function evotorPeriod(url:URL, now=new Date()):PeriodRange {
  const requested=Number(url.searchParams.get('days')||30)
  const days=[1,7,30,90,365].includes(requested)?requested:30
  const today=new Date(now.getTime()+3*3600000).toISOString().slice(0,10)
  const midnight=Date.parse(`${today}T00:00:00+03:00`)
  return {from:new Date(midnight-(days-1)*86400000),to:new Date(midnight+86400000),days}
}

// Caller MUST have resolved scope through resolveVenueScope(session.admin,...).
// No legacy bar id, provider env store, request company id, or global fallback.
export async function getEvotorReport(db:PosReadDb,scope:VenueScope,range:PeriodRange){
  const period={from:range.from.toISOString(),until:range.to.toISOString(),timeZone:'Europe/Moscow'}
  const empty=(state:string)=>({period,connection:{state,lastSuccessAt:null},all:null,app:null,unlinked:null,linkedRevenueSharePercent:null})
  const schema=await db.query(`SELECT to_regclass('public.pos_store_bindings') IS NOT NULL
    AND to_regclass('public.pos_documents') IS NOT NULL AND to_regclass('public.pos_customer_links') IS NOT NULL
    AND to_regclass('public.pos_sync_state') IS NOT NULL AS ready`)
  if(!schema.rows[0]?.ready)return empty('schema_required')
  const binding=await db.query(`SELECT store_id FROM pos_store_bindings
    WHERE tenant_id=$1 AND location_id=$2 AND enabled=TRUE`,[scope.companyId,scope.id])
  if(binding.rows.length!==1)return empty('not_connected')
  const storeId=String(binding.rows[0]!.store_id)
  const connection=await posConnectionStatus(db,{enabled:true,readOnly:true,storeId})
  if(!connection.lastSuccessAt)return {...empty(connection.state),connection}
  const documents=await loadPosDocuments(db,storeId,period)
  return {period,connection,...posDashboards(documents)}
}
