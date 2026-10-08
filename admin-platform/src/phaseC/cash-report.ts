import type { PosSummary } from '../../../pos/analytics.js'

// Optional, venue-scoped server payload from the Evotor POS service.
// The loyalty ledger must never substitute for a missing cash-register report.
export interface CashReport {
  period?:{from:string;until:string;timeZone:string}
  connection:{state:string;lastSuccessAt?:string|null;errorCode?:string|null}
  all:null|{
    salesCents:string;returnsCents:string;netCents:string;averageCents:string|null
    receiptCount:number|null;saleDocuments:number;returnDocuments:number
    days:Array<{label:string;amountCents:string}>
    payments:Array<{label:string;amountCents:string}>
  }
  app?:PosSummary|null
  unlinked?:PosSummary|null
  linkedRevenueSharePercent?:number|null
}

const integer=(value:unknown,negative=false):value is string=>typeof value==='string'&&(negative?/^-?\d+$/:/^\d+$/).test(value)&&value.length<=40
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))

export function isCashReport(value:unknown):value is CashReport {
  if(!record(value)||!record(value.connection)||!['connected','not_connected','schema_required','error','syncing','awaiting_sync'].includes(String(value.connection.state)))return false
  if(value.connection.lastSuccessAt!=null&&!date(value.connection.lastSuccessAt))return false
  if(value.period!=null&&(!record(value.period)||!date(value.period.from)||!date(value.period.until)||Date.parse(String(value.period.from))>=Date.parse(String(value.period.until))||value.period.timeZone!=='Europe/Moscow'))return false
  if(value.all===null)return value.app==null&&value.unlinked==null&&value.linkedRevenueSharePercent==null
  const valid=(m:unknown)=>{
    if(!record(m)||!integer(m.salesCents)||!integer(m.returnsCents)||!integer(m.netCents,true)||!count(m.saleDocuments)||!count(m.returnDocuments))return false
    if(m.receiptCount!==null&&!count(m.receiptCount)||m.averageCents!==null&&!integer(m.averageCents)||m.receiptCount===null&&m.averageCents!==null)return false
    if(!['days','payments'].every(k=>Array.isArray(m[k])&&m[k].every((r:unknown)=>record(r)&&typeof r.label==='string'&&integer(r.amountCents,true))))return false
    for(const k of ['activeBuyers','repeatBuyers'])if(m[k]!=null&&!count(m[k]))return false
    for(const k of ['repeatPurchaseRate','purchaseFrequency'])if(m[k]!=null&&(typeof m[k]!=='number'||!Number.isFinite(m[k])||m[k]<0))return false
    if(typeof m.repeatPurchaseRate==='number'&&m.repeatPurchaseRate>100)return false
    return BigInt(m.netCents)===BigInt(m.salesCents)-BigInt(m.returnsCents)
  }
  if(!valid(value.all)||value.app!=null&&!valid(value.app)||value.unlinked!=null&&!valid(value.unlinked))return false
  const r=value as unknown as CashReport
  if(r.linkedRevenueSharePercent!=null&&(typeof r.linkedRevenueSharePercent!=='number'||!Number.isFinite(r.linkedRevenueSharePercent)||r.linkedRevenueSharePercent<0||r.linkedRevenueSharePercent>100))return false
  if(r.app&&r.all&&(BigInt(r.app.salesCents)>BigInt(r.all.salesCents)||BigInt(r.app.returnsCents)>BigInt(r.all.returnsCents)))return false
  if(r.app&&r.unlinked&&r.all)for(const k of ['salesCents','returnsCents','netCents'] as const)if(BigInt(r.app[k])+BigInt(r.unlinked[k])!==BigInt(r.all[k]))return false
  return true
}
