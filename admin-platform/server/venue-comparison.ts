import type {AdminPrincipal,PeriodRange,VenueScope} from './types.js'
import {HttpError} from './types.js'
import {resolveVenueScope,requireVenueAccess} from './tenant.js'
import {readPool} from './db.js'
import {evotorPeriod,getEvotorReport} from './evotor-read.js'
import type {PosReadDb} from '../../pos/repository.js'

// Separate, allowlisted aggregate model: no client identities or financial sums.
type ComparisonDb=PosReadDb&{release:()=>void}
type ComparisonReport={
  connection:{state:string;lastSuccessAt:unknown}
  all:null|{salesCents:string;returnsCents:string;netCents:string;
    saleDocuments:number;returnDocuments:number;receiptCount:number|null}
}
type ComparisonDeps={
  resolveScope:(admin:AdminPrincipal,id:string)=>Promise<VenueScope>
  requireAccess:(admin:AdminPrincipal,scope:VenueScope,method:string,
    resource:string,child:string,grandchild:string)=>Promise<void>
  connect:()=>Promise<ComparisonDb>
  loadReport:(db:PosReadDb,scope:VenueScope,range:PeriodRange)=>Promise<ComparisonReport>
}
const productionDeps:ComparisonDeps={
  resolveScope:resolveVenueScope,requireAccess:requireVenueAccess,
  connect:()=>readPool.connect(),loadReport:getEvotorReport,
}

export function parseComparisonVenueIds(url:URL):string[]{
  const raw=url.searchParams.getAll('venueIds')
  if(raw.length!==1||raw[0]!.length>120)
    throw new HttpError(400,'INVALID_COMPARISON_VENUES','Выберите от двух до шести заведений.')
  const ids=raw[0]!.split(',')
  if(ids.length<2||ids.length>6||ids.some(id=>!/^[1-9]\d{0,18}$/.test(id)
    ||BigInt(id)>9223372036854775807n)||new Set(ids).size!==ids.length)
    throw new HttpError(400,'INVALID_COMPARISON_VENUES','Укажите от двух до шести разных корректных ID заведений.')
  return ids
}

/** Authorize EVERY venue first; a forbidden/missing/foreign company venue
 * fails the whole request before POS access. No partial financial response.
 */
export async function getAuthorizedVenueComparison(
  admin:AdminPrincipal,url:URL,deps:ComparisonDeps=productionDeps,
){
  const venueIds=parseComparisonVenueIds(url)
  const range=evotorPeriod(url)
  const scopes:VenueScope[]=[]
  let companyId:string|null=null
  for(const id of venueIds){
    const scope=await deps.resolveScope(admin,id)
    await deps.requireAccess(admin,scope,'GET','pos','','')
    if(scope.id!==id||(companyId!==null&&scope.companyId!==companyId))
      throw new HttpError(404,'VENUE_COMPARISON_SCOPE','Сравнение доступно только внутри одной компании.')
    companyId=scope.companyId
    scopes.push(scope)
  }
  const db=await deps.connect()
  const venues:Array<{
    venueId:string;venueName:string;venueCode:string
    status:'unavailable'|'observed'|'stale_or_partial'
    connectionState:string;lastSuccessAt:unknown
    source:'evotor_pos';currency:null;unit:'minor_currency_units'
    salesCents:string|null;returnsCents:string|null;netCents:string|null
    saleDocuments:number|null;returnDocuments:number|null;receiptCount:number|null
  }>=[]
  try{
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    for(const scope of scopes){
      const report=await deps.loadReport(db,scope,range)
      const available=report.all!==null
      venues.push({
        venueId:scope.id,venueName:scope.name,venueCode:scope.code,
        status:!available?'unavailable':report.connection.state==='connected'?'observed':'stale_or_partial',
        connectionState:report.connection.state,
        lastSuccessAt:report.connection.lastSuccessAt,
        source:'evotor_pos',currency:null,unit:'minor_currency_units',
        salesCents:report.all?.salesCents??null,
        returnsCents:report.all?.returnsCents??null,
        netCents:report.all?.netCents??null,
        saleDocuments:report.all?.saleDocuments??null,
        returnDocuments:report.all?.returnDocuments??null,
        receiptCount:report.all?.receiptCount??null,
      })
    }
    await db.query('COMMIT')
  }catch(error){
    await db.query('ROLLBACK').catch(() => undefined) // preserve the original read error
    throw error
  }finally{db.release()}
  return {
    schemaVersion:1 as const,
    comparisonMode:'side_by_side_only' as const,
    source:'evotor_pos' as const,
    coverage:'imported_read_model_only' as const,
    companyId:companyId!,
    period:{from:range.from.toISOString(),to:range.to.toISOString(),timeZone:'Europe/Moscow' as const},
    comparableMoney:false as const,currency:null,total:null,venues,
  }
}
