// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {projectBeerInventory,type BeerDocument,type BeerMovement} from '../beer-inventory-model.js'
import {summarizePos} from '../../../pos/analytics.js'
const t='2026-10-26T10:00:00.000Z',later=(n:number)=>new Date(Date.parse(t)+n*1000).toISOString()
const move=(kind='initial',quantity='30000',extra:Partial<BeerMovement>={}):BeerMovement=>({operationId:'base',sequence:'1',productId:'beer-a',kind,quantityMillis:quantity,baselineId:null,effectiveAt:t,recordedAt:t,actorId:'1',note:'Fixture',invoice:'',reason:'',returnDocumentId:null,evidence:{},...extra})
const doc=(n:number,qty=1000,extra:Partial<BeerDocument>={}):BeerDocument=>({storeId:'store-a',documentId:'doc-'+n,type:'SELL',closedAt:later(n),baseDocumentId:null,positions:[{productId:'beer-a',name:'Жигулёвское',measure:'л',quantityMillis:qty}],...extra})
function project(documents:BeerDocument[],movements=[move()],extra={}){return projectBeerInventory({storeId:'store-a',documents,movements,sync:{lastSuccessAt:later(100),scanUntil:later(100),cursor:null,errorCode:null},asOf:later(100),periodFrom:t,periodUntil:later(100),now:later(100),...extra})}
describe('CRM beer calculation from existing immutable receipts',()=>{
 it('30 →29 →28.5 →78.5 →76.5 →75.5 and restart/replay are deterministic',()=>{
  const docs=[doc(1),doc(2,500),doc(5)],moves=[move(),move('delivery','50000',{operationId:'arrival',sequence:'2',baselineId:'base',effectiveAt:later(3)}),move('writeoff','2000',{operationId:'spill',sequence:'3',baselineId:'base',effectiveAt:later(4)})]
  expect(project([docs[0]!]).products[0]?.balanceMillis).toBe('29000')
  expect(project(docs.slice(0,2)).products[0]?.balanceMillis).toBe('28500')
  expect(project(docs.slice(0,2),moves.slice(0,2)).products[0]?.balanceMillis).toBe('78500')
  expect(project(docs.slice(0,2),moves).products[0]?.balanceMillis).toBe('76500')
  expect(project(docs,moves).products[0]?.balanceMillis).toBe('75500')
  expect(project([...docs,docs[0]!],moves)).toEqual(project(docs,moves))
  expect(project(structuredClone(docs),structuredClone(moves))).toEqual(project(docs,moves))
 })
 it('late closes after the baseline count, old/equal closes do not; simultaneous delivery is deterministic',()=>{
  expect(project([doc(-1),doc(0),doc(1)]).products[0]?.balanceMillis).toBe('29000')
  const m=[move(),move('delivery','500',{sequence:'2',baselineId:'base',effectiveAt:later(1)})]
  expect(project([doc(1,500)],m).products[0]?.balanceMillis).toBe('30000')
  expect(project([],m).products[0]?.balanceMillis).toBe('30500')
  expect(project([doc(1,500)],m).products[0]?.balanceMillis).toBe('30000')
 })
 it('money refunds never restore beer; explicit physical return restores once',()=>{
  const docs=[doc(1),doc(2,500,{type:'PAYBACK',baseDocumentId:'doc-1'})]
  expect(project(docs).products[0]?.balanceMillis).toBe('29000')
  const result=project(docs,[move(),move('physical_return','500',{sequence:'2',baselineId:'base',returnDocumentId:'doc-2'})]).products[0]!
  expect(result.balanceMillis).toBe('29500');expect(result.refunds).toMatchObject([{baseDocumentId:'doc-1',restored:true}])
 })
 it('new baseline retains history, permits zero and excludes earlier receipts including late ones',()=>{
  const moves=[move(),move('delivery','50000',{sequence:'2',baselineId:'base'}),move('count','0',{operationId:'count',sequence:'3',baselineId:'base',effectiveAt:later(5)})]
  const p=project([doc(4),doc(6)],moves).products[0]!
  expect(p.balanceMillis).toBe('-1000');expect(p.warnings.join()).toContain('Отрицательный')
  expect(p.history).toHaveLength(5);expect(p.deliveredMillis).toBe('0')
 })
 it('identity is store/product, never name; pieces and unknown positions cannot become liters',()=>{
  const docs=[doc(1),doc(2,1000,{storeId:'other'}),doc(3,1000,{positions:[{productId:'beer-b',name:'Жигулёвское',measure:'л',quantityMillis:1000}]}),doc(4,1000,{positions:[{productId:'pieces',name:'Банка',measure:'шт',quantityMillis:1000},{productId:null,measure:'л',quantityMillis:1000}]})]
  const r=project(docs)
  expect(r.products.find(p=>p.productId==='beer-a')?.balanceMillis).toBe('29000')
  expect(r.products.find(p=>p.productId==='beer-b')?.balanceMillis).toBeNull()
  expect(r.products.find(p=>p.productId==='pieces')?.supported).toBe(false)
  expect(r.quality.unknownPositions).toBe(1);expect(r.products[0]?.status).toBe('incomplete')
 })
 it('errors, pagination, stale ranges and absent initial stock are distinct from full coverage',()=>{
  expect(project([doc(1)]).products[0]?.status).toBe('current')
  for(const sync of [{lastSuccessAt:t,scanUntil:t,cursor:'next',errorCode:null},{lastSuccessAt:t,scanUntil:later(100),cursor:null,errorCode:'invalid_response'}]){
   expect(project([doc(1)],[move()],{sync}).products[0]?.status).not.toBe('current')
  }
  expect(project([doc(1)],[move()],{now:later(10000)}).products[0]?.status).toBe('pending')
  expect(project([doc(1)],[]).products[0]?.status).toBe('uninitialized')
  expect(project([doc(1)],[move()],{asOf:later(101)}).products[0]?.status).toBe('pending')
 })
 it('sales agree with the existing analytics after separately removing monetary returns',()=>{
  const docs=[doc(1),doc(2,500),doc(3,500,{type:'PAYBACK',baseDocumentId:'doc-1'})]
  const totals=summarizePos(docs.map(d=>({...d,amountCents:100,receiptCount:1,positions:(d.positions as Record<string,unknown>[]).map(p=>({...p,amountCents:100})),payments:[]})) as never)
  expect(totals.products[0]?.quantityMillis).toBe('1000') // 1500 sold -500 money refund.
  expect(project(docs).products[0]?.soldMillis).toBe('1500')
  expect(project(docs).products[0]?.balanceMillis).toBe('28500')
 })
 it('pages history without losing or rewriting persisted movements',()=>{
  const docs=Array.from({length:125},(_,i)=>doc(i+1))
  const r=project(docs,[move()],{asOf:later(200),historyOffset:100})
  expect(r.products[0]?.history).toHaveLength(26);expect(r.products[0]?.historyTruncated).toBe(false)
 })
 it('uses actual recent complete-range telemetry separately from history and never upgrades a failed page',()=>{
  const sync={lastSuccessAt:null,scanUntil:null,cursor:'old-history',errorCode:null,recent:{state:'complete',lastSuccessAt:later(100),from:later(-100),until:later(100),pages:2,cursorPending:false,errorCode:null,updatedAt:later(100)}}
  expect(project([doc(1)],[move()],{sync}).products[0]?.status).toBe('current')
  expect(project([doc(1)],[move()],{sync:{...sync,recent:{...sync.recent,state:'incomplete',cursorPending:true}}}).products[0]?.status).toBe('pending')
  expect(project([doc(1)],[move()],{sync:{...sync,recent:{...sync.recent,state:'error',errorCode:'scan_failed'}}}).products[0]?.status).toBe('incomplete')
 })
})
