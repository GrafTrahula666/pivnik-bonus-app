// Pure projection of immutable imported receipts + append-only CRM movements.
// No provider calls, wallets, money writes or persistent derived balance.
export type BeerDocument={storeId:string;documentId:string;type:string;closedAt:string;baseDocumentId:string|null;positions:unknown}
export type BeerMovement={operationId:string;sequence:string;productId:string;kind:string;quantityMillis:string;baselineId:string|null;effectiveAt:string;recordedAt:string;actorId:string;note:string;invoice:string;reason:string;returnDocumentId:string|null;evidence:Record<string,unknown>}
export type BeerSync={lastSuccessAt:string|null;scanUntil:string|null;cursor:string|null;errorCode:string|null;recent?:{state:string;lastSuccessAt:string|null;from:string|null;until:string|null;pages:number;cursorPending:boolean;errorCode:string|null;updatedAt:string}}
export type BeerStatus='current'|'pending'|'incomplete'|'uninitialized'
export type BeerProduct={productId:string;name:string;measure:string;supported:boolean;baseline:BeerMovement|null;balanceMillis:string|null;deliveredMillis:string;soldMillis:string;writtenOffMillis:string;returnedMillis:string;soldTodayMillis:string;soldPeriodMillis:string;warnings:string[];status:BeerStatus;history:unknown[];historyTruncated:boolean;refunds:{documentId:string;baseDocumentId:string|null;closedAt:string;quantityMillis:string;restored:boolean}[]}
const idPattern=/^[A-Za-z0-9_-]{1,200}$/
const validMillis=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
export function projectBeerInventory({storeId,documents,movements,sync,asOf,periodFrom,periodUntil,now,staleAfterMs=360000,historyOffset=0}:{storeId:string;documents:BeerDocument[];movements:BeerMovement[];sync:BeerSync;asOf:string;periodFrom:string;periodUntil:string;now:string;staleAfterMs?:number;historyOffset?:number}){
 const end=Date.parse(asOf)
 const moscowDay=new Date(Date.parse(now)+10800000).toISOString().slice(0,10)
 const todayFrom=Date.parse(moscowDay+'T00:00:00+03:00')
 const products=new Map<string,BeerProduct>(),sales=new Map<string,{documentId:string;closedAt:string;quantity:bigint}[]>(),seen=new Set<string>()
 let unknownPositions=0
 const unknownAt:number[]=[]
 const ensure=(id:string,name=id,measure='л')=>{
  if(!products.has(id))products.set(id,{productId:id,name,measure,supported:true,baseline:null,balanceMillis:null,deliveredMillis:'0',soldMillis:'0',writtenOffMillis:'0',returnedMillis:'0',soldTodayMillis:'0',soldPeriodMillis:'0',warnings:[],status:'uninitialized',history:[],historyTruncated:false,refunds:[]})
  return products.get(id)!
 }
 const warn=(p:BeerProduct,message:string)=>{if(!p.warnings.includes(message))p.warnings.push(message)}
 for(const d of [...documents].sort((a,b)=>a.closedAt.localeCompare(b.closedAt)||a.documentId.localeCompare(b.documentId))){
  if(d.storeId!==storeId||!['SELL','PAYBACK'].includes(d.type)||Date.parse(d.closedAt)>=end)continue
  const key=d.storeId+'\0'+d.documentId
  if(seen.has(key))continue // DB PK is authoritative; projection also remains replay-safe.
  seen.add(key)
  if(!Number.isFinite(Date.parse(d.closedAt))||!Array.isArray(d.positions)){unknownPositions++;unknownAt.push(Date.parse(d.closedAt));continue}
  const grouped=new Map<string,bigint>()
  for(const raw of d.positions){
   const x=raw as Record<string,unknown>|null
   if(!x||typeof x.productId!=='string'||!idPattern.test(x.productId)){unknownPositions++;unknownAt.push(Date.parse(d.closedAt));continue}
   const p=ensure(x.productId,typeof x.name==='string'?x.name.slice(0,500):x.productId,typeof x.measure==='string'?x.measure:'')
   if(typeof x.name==='string')p.name=x.name.slice(0,500)
   if(typeof x.measure!=='string'||x.measure.trim().toLowerCase()!=='л'){
    p.supported=false;warn(p,'Единица измерения не подтверждена как литры.');continue
   }
   if(!validMillis(x.quantityMillis)){p.supported=false;warn(p,'Неизвестное количество в чеке.');continue}
   grouped.set(p.productId,(grouped.get(p.productId)||0n)+BigInt(x.quantityMillis))
  }
  for(const [id,quantity] of grouped){
   const p=products.get(id)!
   if(d.type==='SELL'){
    const list=sales.get(id)||[];list.push({documentId:d.documentId,closedAt:d.closedAt,quantity});sales.set(id,list)
    if(Date.parse(d.closedAt)>=todayFrom)p.soldTodayMillis=String(BigInt(p.soldTodayMillis)+quantity)
    if(Date.parse(d.closedAt)>=Date.parse(periodFrom)&&Date.parse(d.closedAt)<Date.parse(periodUntil))p.soldPeriodMillis=String(BigInt(p.soldPeriodMillis)+quantity)
   }else p.refunds.push({documentId:d.documentId,baseDocumentId:d.baseDocumentId,closedAt:d.closedAt,quantityMillis:String(quantity),restored:movements.some(m=>m.kind==='physical_return'&&m.productId===id&&m.returnDocumentId===d.documentId)})
  }
 }
 const sorted=[...movements].filter(m=>Date.parse(m.effectiveAt)<=end).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1)
 for(const m of sorted){const p=ensure(m.productId);if(m.kind==='initial'||m.kind==='count')p.baseline=m}
 const historyComplete=Boolean(sync.lastSuccessAt)&&!sync.cursor&&!sync.errorCode
 const coveredUntil=historyComplete?sync.scanUntil:null
 const fresh=Boolean(sync.lastSuccessAt)&&Date.parse(now)-Date.parse(sync.lastSuccessAt!)<=staleAfterMs
 const recent=sync.recent
 const recentFresh=Boolean(recent?.lastSuccessAt)&&Date.parse(now)-Date.parse(recent!.lastSuccessAt!)<=staleAfterMs
 for(const p of products.values()){
  const base=p.baseline
  if(base){
   let balance=BigInt(base.quantityMillis),delivered=0n,written=0n,returned=0n,sold=0n
   // Baseline includes physical stock AT its timestamp; only strictly later closes
   // are deducted. Late imports use close time, never imported_at.
   for(const sale of sales.get(p.productId)||[]){if(Date.parse(sale.closedAt)<=Date.parse(base.effectiveAt))continue;sold+=sale.quantity}
   for(const m of sorted.filter(m=>m.productId===p.productId&&m.baselineId===base.operationId)){
    if(m.kind==='delivery')delivered+=BigInt(m.quantityMillis)
    if(m.kind==='writeoff')written+=BigInt(m.quantityMillis)
    if(m.kind==='physical_return')returned+=BigInt(m.quantityMillis)
   }
   balance+=delivered-sold-written+returned
   Object.assign(p,{balanceMillis:String(balance),deliveredMillis:String(delivered),soldMillis:String(sold),writtenOffMillis:String(written),returnedMillis:String(returned)})
   if(balance<0n)warn(p,'Отрицательный расчётный остаток: проверьте привозы, списания и сверку.')
  }
  if(base&&unknownAt.some(at=>!Number.isFinite(at)||at>Date.parse(base.effectiveAt)))warn(p,'После начальной точки есть позиции без надёжного ID; расчёт может быть неполным.')
  const recentCovers=base&&recent?.from&&recent.until&&Date.parse(recent.from)<=Date.parse(base.effectiveAt)&&Date.parse(recent.until)>=end&&recentFresh&&recent.state==='complete'
  p.status=!base?'uninitialized':p.warnings.length||sync.errorCode||recent?.errorCode?'incomplete':(coveredUntil&&Date.parse(coveredUntil)>=end&&fresh)||recentCovers?'current':'pending'
  const history=[...sorted.filter(m=>m.productId===p.productId).map(m=>({source:'crm',...m})),...(sales.get(p.productId)||[]).map(s=>({source:'evotor',kind:'sale',documentId:s.documentId,effectiveAt:s.closedAt,quantityMillis:String(s.quantity),included:Boolean(base)&&Date.parse(s.closedAt)>Date.parse(base!.effectiveAt)}))]
  history.sort((a,b)=>String(b.effectiveAt).localeCompare(String(a.effectiveAt)))
  p.history=history.slice(historyOffset,historyOffset+100);p.historyTruncated=history.length>historyOffset+100
 }
 return {products:[...products.values()],quality:{historyComplete,coveredUntil,lastSuccessfulHistorySyncAt:sync.lastSuccessAt,historyCursorPending:Boolean(sync.cursor),errorCode:sync.errorCode,recentSync:recent??{state:'not_recorded',lastSuccessAt:null,from:null,until:null,pages:0,cursorPending:false,errorCode:null,updatedAt:null},unknownPositions,stale:!fresh&&!recentFresh,staleAfterMs},asOf,period:{from:periodFrom,until:periodUntil},source:'crm_calculated' as const}
}
