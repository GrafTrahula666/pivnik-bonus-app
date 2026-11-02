/**
 * CHAT 09 / 82: shared, additive server-side contract for pre-aggregated
 * chart series. It does not authorize a scope, recalculate money, or claim
 * provider completeness. Only call it after the existing scoped read model.
 */
export type AggregateRow = {label:string;amountCents:string}
type Common = {
  companyId:string
  venueId:string
  period:{from:string;to:string}
  days:readonly AggregateRow[]
  hours:readonly AggregateRow[]|null // null = not requested/available; [] = measured empty
}
export type AggregateInput = Common & (
  | {source:'evotor_pos';metric:'net_cash';currency:null}
  | {source:'pivnik_loyalty';metric:'tracked_cash';currency:'RUB'}
)

const DAY=/^\d{4}-\d{2}-\d{2}$/
const HOUR=/^(?:[01]\d|2[0-3])$/
const CENTS=/^-?\d+$/

function bucketRows(rows:readonly AggregateRow[],kind:'day'|'hour'):AggregateRow[]{
  if(!Array.isArray(rows))throw new Error('INVALID_AGGREGATE_ROWS')
  const seen=new Set<string>()
  return rows.map(row=>{
    if(!row||typeof row.label!=='string'||typeof row.amountCents!=='string'||
       !CENTS.test(row.amountCents)||!(kind==='day'?DAY:HOUR).test(row.label)||
       (kind==='day'&&(!Number.isFinite(Date.parse(row.label+'T00:00:00Z'))||
        new Date(row.label+'T00:00:00Z').toISOString().slice(0,10)!==row.label))||
       seen.has(row.label))throw new Error('INVALID_AGGREGATE_BUCKET')
    seen.add(row.label)
    return {label:row.label,amountCents:row.amountCents}
  }).sort((a,b)=>a.label.localeCompare(b.label))
}
const sum=(rows:readonly AggregateRow[])=>rows.reduce((acc,row)=>acc+BigInt(row.amountCents),0n)

export function buildServerTimeSeries(input:AggregateInput){
  const {from,to}=input.period
  if(!input.companyId||!input.venueId||
     !Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||
     Date.parse(from)>=Date.parse(to))throw new Error('INVALID_AGGREGATE_SCOPE_OR_PERIOD')
  const days=bucketRows(input.days,'day')
  const hours=input.hours===null?null:bucketRows(input.hours,'hour')
  // Both arrays must summarize the SAME underlying scoped records.
  // A missing hourly projection is not an empty zero series.
  if(hours!==null&&sum(days)!==sum(hours))throw new Error('AGGREGATE_GROUPING_MISMATCH')
  return {
    schemaVersion:1 as const,
    source:input.source,
    metric:input.metric,
    unit:'minor_currency_units' as const,
    currency:input.currency,
    scope:{companyId:input.companyId,venueId:input.venueId},
    period:{from,to,timeZone:'Europe/Moscow' as const},
    coverage:'read_model_only' as const,
    groups:{
      days:{grain:'calendar_day' as const,buckets:days},
      hours:hours===null?null:{grain:'hour_of_day' as const,foldedAcrossDays:true as const,buckets:hours},
    },
  }
}
