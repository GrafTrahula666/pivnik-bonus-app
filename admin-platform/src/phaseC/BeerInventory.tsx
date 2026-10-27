import {useEffect,useId,useRef,useState} from 'react'
import {apiGet,apiPost,ApiError,type ApiVenue} from '../api'
import {PageHead} from '../ui'
import {beerSearchKey} from './beer-catalog'
import type {BeerProduct} from '../../server/beer-inventory-model'
import './beer-inventory.css'

type Report={source:'crm_calculated';asOf:string;storeId:string;writeEnabled:boolean;products:BeerProduct[];quality:{lastSuccessfulHistorySyncAt:string|null;coveredUntil:string|null;historyComplete:boolean;historyCursorPending:boolean;errorCode:string|null;unknownPositions:number;stale:boolean;recentSync:{state:string;lastSuccessAt?:string|null;from?:string|null;until?:string|null;pages?:number;cursorPending?:boolean;errorCode?:string|null}}}
type Command={operationId:string;productId:string;kind:string;quantityMillis:string;baselineId:string|null;note:string;invoice:string;reason:string;returnDocumentId:string|null;notInReceipts:boolean}
const statusText={current:'Актуально на указанное время',pending:'Ожидается синхронизация',incomplete:'Данные неполные',uninitialized:'Нет начального остатка'}
const kindText:Record<string,string>={initial:'Начальный остаток',delivery:'Привоз',writeoff:'Списание',physical_return:'Физический возврат',count:'Инвентаризация',sale:'Продажа'}
const text=(e:unknown)=>e instanceof Error?e.message:'Не удалось обновить расчёт.'
const liters=(v:string|null)=>v===null?'Не задан':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(Number(v)/1000)+' л'
const date=(v:string|null)=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК':'не подтверждено'
function beerQuantity(raw:string):string|null{
 if(!/^\d{1,7}(?:[.,]\d{1,3})?$/.test(raw.trim()))return null
 const [whole,part='']=raw.trim().replace(',','.').split('.')
 return String(BigInt(whole!)*1000n+BigInt(part.padEnd(3,'0')))
}
export function BeerInventory({venue,actorId}:{venue:ApiVenue;actorId:string}){
 const tabsId=useId()
 const [view,setView]=useState<'tracked'|'all'>('tracked')
 const scope=actorId+':'+venue.companyId+':'+venue.id,storage='beer-inventory-pending:'+scope
 const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[query,setQuery]=useState(''),[sort,setSort]=useState('balance'),[low,setLow]=useState(false)
 const [period,setPeriod]=useState('1'),[from,setFrom]=useState(''),[to,setTo]=useState('')
 const [historyOffset,setHistoryOffset]=useState(0)
 const [selected,setSelected]=useState<string|null>(null),[kind,setKind]=useState('delivery'),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[invoice,setInvoice]=useState(''),[reason,setReason]=useState('spill'),[refund,setRefund]=useState(''),[notInReceipts,setNotInReceipts]=useState(false)
 const [pending,setPending]=useState<Command|null>(()=>{try{return JSON.parse(sessionStorage.getItem(storage)||'null') as Command|null}catch{return null}})
 const sequence=useRef(0),busy=useRef(false)
 const base='/api/admin/venues/'+venue.id+'/beer-inventory'
 const yesterday=new Date(Date.now()+10800000-86400000).toISOString().slice(0,10)
 const queryString=(period==='custom'?'from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to):period==='yesterday'?'date='+yesterday:'days='+period)+'&historyOffset='+historyOffset
 async function refresh(){
  const request=++sequence.current;setLoading(true);setReport(null);setError('')
  try{
   const data=await apiGet<Report>(base+'?'+queryString)
   if(data.source!=='crm_calculated'||!Array.isArray(data.products))throw new Error('Расчёт не подтверждён сервером.')
   if(request===sequence.current)setReport(data)
  }catch(e){if(request===sequence.current)setError(text(e))}finally{if(request===sequence.current)setLoading(false)}
 }
 useEffect(()=>{void refresh();return()=>{sequence.current++}},[base,queryString]) // eslint-disable-line react-hooks/exhaustive-deps
 // Parent keys by actor/company/venue. No form or late response crosses a scope.
 useEffect(()=>{const timer=setInterval(()=>{if(!busy.current)void refresh()},120000);return()=>clearInterval(timer)},[base,queryString]) // eslint-disable-line react-hooks/exhaustive-deps
 const product=report?.products.find(p=>p.productId===selected)
 const quantity=beerQuantity(amount)
 const historical=Boolean(report)&&Date.parse(report!.asOf)<Date.parse(new Date(Date.now()+10800000).toISOString().slice(0,10)+'T00:00:00+03:00')
 const canWrite=Boolean(report?.writeEnabled)&&!historical
 const tracked=(report?.products||[]).filter(p=>p.baseline!==null)
 const lowStock=tracked.filter(p=>p.balanceMillis!==null&&BigInt(p.balanceMillis)<=10000n)
 const needsReview=tracked.filter(p=>!p.supported||p.status==='incomplete')
 const products=(view==='tracked'?tracked:report?.products||[]).filter(p=>beerSearchKey(p.name).includes(beerSearchKey(query))&&(!low||p.balanceMillis!==null&&BigInt(p.balanceMillis)<=10000n)).sort((a,b)=>sort==='balance'?Number(a.balanceMillis??Number.MAX_SAFE_INTEGER)-Number(b.balanceMillis??Number.MAX_SAFE_INTEGER):sort==='sold'?Number(view==='tracked'?b.soldMillis:b.soldPeriodMillis)-Number(view==='tracked'?a.soldMillis:a.soldPeriodMillis):a.name.localeCompare(b.name,'ru'))
 function changeView(next:'tracked'|'all'){setView(next);setSelected(null);setHistoryOffset(0);if(next==='tracked')setPeriod('1')}
 function addProduct(){changeView('all');setQuery('');setLow(false)}
 function open(p:BeerProduct,nextKind:string){setSelected(p.productId);setHistoryOffset(0);setKind(nextKind);setAmount('');setNote('');setInvoice('');setRefund('');setNotInReceipts(false);setError('');setNotice('')}
 function actions(p:BeerProduct){return <div className="beer-inventory-actions">
  {!p.baseline?<button disabled={!p.supported||saving||Boolean(pending)||!canWrite} onClick={()=>open(p,'initial')}>Начать учёт</button>:<><button disabled={!p.supported||saving||Boolean(pending)||!canWrite} onClick={()=>open(p,'delivery')}>Привоз</button><button disabled={!p.supported||saving||Boolean(pending)||!canWrite} onClick={()=>open(p,'writeoff')}>Списание</button><button disabled={!p.supported||saving||Boolean(pending)||!canWrite} onClick={()=>open(p,'count')}>Инвентаризация</button></>}
  <button disabled={saving} onClick={()=>open(p,'history')}>История</button>
 </div>}
 async function submit(command?:Command){
  if(busy.current||!report?.writeEnabled)return
  let body=command
  if(!body){
   if(!product||quantity===null)return
   body={operationId:crypto.randomUUID(),productId:product.productId,kind,quantityMillis:quantity,baselineId:product.baseline?.operationId??null,note,invoice,reason:kind==='writeoff'?reason:'',returnDocumentId:kind==='physical_return'?refund:null,notInReceipts}
   // Persist before sending so a lost response/reload reuses the identical ID/body.
   try{sessionStorage.setItem(storage,JSON.stringify(body))}catch{setError('Не удалось сохранить ID операции. Разрешите хранилище браузера для безопасного повтора.');return}
   setPending(body)
  }
  busy.current=true;setSaving(true);setError('');setNotice('')
  try{
   const result=await apiPost<{ok:boolean;source:string;alreadyApplied:boolean;operationId:string}>(base,body)
   if(!result.ok||result.source!=='crm_calculated'||result.operationId!==body.operationId)throw new Error('Операция не подтверждена. Проверьте сохранение тем же ID.')
   sessionStorage.removeItem(storage);setPending(null);setSelected(null)
   if(body.kind==='initial')changeView('tracked')
   setNotice(result.alreadyApplied?'Операция уже сохранена. Повторного движения нет.':'Операция сохранена в CRM. Кассовые остатки не изменены.')
   await refresh()
  }catch(e){
   setError(text(e))
   if(e instanceof ApiError&&[400,401,403,404,409].includes(e.status)){
    sessionStorage.removeItem(storage);setPending(null)
   }
  }finally{busy.current=false;setSaving(false)}
 }
 return <div className="page beer-inventory">
  <PageHead eyebrow="MYCRM · РАСЧЁТНЫЙ УЧЁТ" title="Остатки пива" sub={venue.companyName+' → '+venue.name} actions={<button className="btn secondary" onClick={()=>void refresh()} disabled={loading||saving}>Обновить</button>}/>
  <p>Это расчёт по загруженным чекам, привозам и списаниям. Данные в кассу не отправляются.</p>
  <div className="segmented beer-inventory-tabs" role="tablist" aria-label="Списки остатков пива">
   {(['tracked','all'] as const).map(id=><button key={id} id={tabsId+'-'+id} type="button" role="tab" aria-selected={view===id} aria-controls={tabsId+'-panel'} tabIndex={view===id?0:-1} className={view===id?'active':''} onClick={()=>changeView(id)} onKeyDown={e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return
    e.preventDefault();const next=e.key==='Home'?'tracked':e.key==='End'?'all':id==='tracked'?'all':'tracked';changeView(next);document.getElementById(tabsId+'-'+next)?.focus()
   }}>{id==='tracked'?'На учёте':'Все товары'}{report&&<span>{id==='tracked'?tracked.length:report.products.length}</span>}</button>)}
  </div>
  <div id={tabsId+'-panel'} role="tabpanel" aria-labelledby={tabsId+'-'+view}>
  {view==='tracked'&&<>
   <div className="beer-inventory-overview"><div><h2>Пиво на учёте</h2><p>Только сорта с сохранённым остатком. Сначала показано то, что заканчивается.</p></div><button className="btn secondary" onClick={addProduct}>Добавить товар на учёт</button></div>
   {report&&<div className="beer-inventory-summary" aria-label="Сводка по пиву на учёте">
    <div className="card"><span>Сортов на учёте</span><strong>{tracked.length}</strong></div>
    <div className={'card'+(lowStock.length?' beer-inventory-low':'')}><span>Заканчиваются · ≤ 10 л</span><strong>{lowStock.length}</strong></div>
    <div className={'card'+(needsReview.length?' beer-inventory-warning':'')}><span>Требуют проверки</span><strong>{needsReview.length}</strong></div>
   </div>}
   <p>Остаток уменьшается после загрузки закрытых чеков. Проверка каждые 2 минуты; можно нажать «Обновить».</p>
  </>}
  <section className="card beer-inventory-controls">
   <label>Поиск товара<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <label>Сортировка<select value={sort} onChange={e=>setSort(e.target.value)}><option value="name">По названию</option><option value="balance">По остатку</option><option value="sold">{view==='tracked'?'По вычтенным продажам':'По продажам за период'}</option></select></label>
   <label className="beer-inventory-low-filter"><input type="checkbox" checked={low} onChange={e=>setLow(e.target.checked)}/>Остаток ≤ 10 л</label>
   {view==='all'&&<label>Период продаж<select value={period} onChange={e=>{setSelected(null);setHistoryOffset(0);setPeriod(e.target.value)}}><option value="1">Сегодня</option><option value="yesterday">Вчера</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="custom">Дата / диапазон</option></select></label>}
   {period==='custom'&&<><label>С даты<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>По дату<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></>}
  </section>
  {loading&&<p role="status">Считаю остатки по чекам…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {pending&&<div className="card"><p>Есть операция без подтверждённого ответа. Повторная проверка использует тот же ID и не создаст второе движение.</p><button className="btn" disabled={saving||loading||!report} onClick={()=>void submit(pending)}>Проверить сохранение</button></div>}
  {report&&<>
   {historical&&<p>Просмотр остатка на прошлую дату. Для новой операции выберите «Сегодня».</p>}
   <p>Расчётный остаток на {date(report.asOf)}. Последняя загрузка недавних чеков: {date(report.quality.recentSync.lastSuccessAt??null)}.</p>
   <details className="card beer-inventory-quality" aria-label="Достоверность расчёта"><summary>Загрузка чеков и достоверность расчёта</summary><p>Расчётный остаток на {date(report.asOf)}. Продажи за период показаны отдельно.</p>
    <p>Последняя полная историческая синхронизация: {date(report.quality.lastSuccessfulHistorySyncAt)}. Подтверждённый диапазон — до {date(report.quality.coveredUntil)}.</p>
    <p>Недавние чеки: последняя полная загрузка {date(report.quality.recentSync.lastSuccessAt??null)}; диапазон {date(report.quality.recentSync.from??null)} — {date(report.quality.recentSync.until??null)}.</p>
    {report.quality.recentSync.state==='not_recorded'&&<p>Подтверждение недавней синхронизации пока отсутствует.</p>}
    {['running','incomplete'].includes(report.quality.recentSync.state)&&<p>Загрузка недавних чеков не завершена. Страниц: {report.quality.recentSync.pages??0}.</p>}
    {report.quality.recentSync.errorCode&&<p role="alert">Ошибка недавней синхронизации: {report.quality.recentSync.errorCode}</p>}
    {report.quality.historyCursorPending&&<p>Историческая загрузка не завершена.</p>}{report.quality.errorCode&&<p role="alert">Ошибка синхронизации: {report.quality.errorCode}</p>}
    {report.quality.unknownPositions>0&&<p role="alert">Позиций без надёжного ID: {report.quality.unknownPositions}.</p>}
   </details>
   {view==='tracked'?<>
    <div className="card beer-inventory-table beer-inventory-tracked"><table aria-label="Пиво на учёте"><thead><tr><th>Товар</th><th>Зафиксировано</th><th>Привозы / возвраты</th><th>Вычтено продажами</th><th>Списано вручную</th><th>Осталось</th><th>Учёт продаж</th><th>Действия</th></tr></thead><tbody>
     {products.map(p=><tr key={p.productId}>
      <td data-label="Товар"><b>{p.name}</b><small>{p.productId}</small></td>
      <td data-label="Зафиксировано">{liters(p.baseline!.quantityMillis)}<small>{p.baseline!.kind==='count'?'Инвентаризация':'Начальный остаток'} · {date(p.baseline!.effectiveAt)}</small></td>
      <td data-label="Привозы / возвраты">+ {liters(p.deliveredMillis)}{p.returnedMillis!=='0'&&<small>Возвраты: + {liters(p.returnedMillis)}</small>}</td>
      <td data-label="Вычтено продажами">− {liters(p.soldMillis)}<small>После фиксации остатка</small></td>
      <td data-label="Списано вручную">− {liters(p.writtenOffMillis)}</td>
      <td data-label="Осталось" className={'beer-inventory-balance'+(p.balanceMillis!==null&&BigInt(p.balanceMillis)<=10000n?' beer-inventory-low':'')}><strong>{liters(p.balanceMillis)}</strong>{p.balanceMillis!==null&&BigInt(p.balanceMillis)<=10000n&&<small>{BigInt(p.balanceMillis)<=0n?'Закончился · проверьте остаток':'Заканчивается · пора заказать'}</small>}</td>
      <td data-label="Учёт продаж"><span className={'beer-inventory-status '+p.status}>{!p.supported?'Продажи учитываются не полностью':p.status==='incomplete'?'Нужна проверка данных':'Загруженные продажи вычитаются'}</span><small>{statusText[p.status]}</small>{p.warnings.map(w=><small className="beer-inventory-warning" key={w}>{w}</small>)}</td>
      <td data-label="Действия">{actions(p)}</td>
     </tr>)}
    </tbody></table>{products.length===0&&<div className="beer-inventory-empty"><p>{tracked.length===0?'Пока нет пива на учёте. Выберите товар и внесите фактический остаток — он появится здесь.':'Нет сортов с такими условиями поиска.'}</p>{tracked.length===0&&<button className="btn" onClick={addProduct}>Выбрать товар</button>}</div>}</div>
    {products.length>0&&<p>Осталось = зафиксировано + привозы + физические возвраты − продажи после фиксации − ручные списания. Полная история — в строке товара.</p>}
   </>:<div className="card beer-inventory-table"><table><thead><tr><th>Товар</th><th>Расчётный остаток</th><th>Продано сегодня</th><th>Продано за период</th><th>Статус</th><th>Действия</th></tr></thead><tbody>
    {products.map(p=><tr key={p.productId}><td><b>{p.name}</b><small>{p.productId}</small></td><td>{liters(p.balanceMillis)}</td><td>{liters(p.soldTodayMillis)}</td><td>{liters(p.soldPeriodMillis)}</td><td>{statusText[p.status]}{p.warnings.map(w=><small key={w}>{w}</small>)}</td><td>{actions(p)}</td></tr>)}
   </tbody></table>{products.length===0&&<p>Товары не найдены в загруженных чеках. Без подтверждённых ID и литров учёт не начинается.</p>}</div>}
   {product&&<section className="card beer-inventory-detail" aria-label="Карточка товара"><h3>{product.name} · {kindText[kind]||'История'}</h3>
    <p>Расчётный остаток: {liters(product.balanceMillis)}. Начальная точка: {date(product.baseline?.effectiveAt??null)}.</p>
    <p>С начала текущей точки: привозы {liters(product.deliveredMillis)}, продажи {liters(product.soldMillis)}, списания {liters(product.writtenOffMillis)}, физические возвраты {liters(product.returnedMillis)}.</p>
    {kind!=='history'&&<form onSubmit={e=>{e.preventDefault();void submit()}}>
     <label>{['initial','count'].includes(kind)?'Фактически, л':'Количество, л'}<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} disabled={saving||Boolean(pending)}/></label>
     {kind==='delivery'&&<label>Накладная (необязательно)<input value={invoice} maxLength={100} onChange={e=>setInvoice(e.target.value)}/></label>}
     <label>Комментарий<input value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label>
     {kind==='count'&&quantity!==null&&product.balanceMillis!==null&&<p>Расхождение: {liters(String(BigInt(quantity)-BigInt(product.balanceMillis)))}. Будет создана новая начальная точка; история сохранится.</p>}
     {kind==='initial'&&<p>Количество фиксируется на время сохранения. Чеки, закрытые до этого момента включительно, уже входят в фактический остаток и повторно не вычитаются.</p>}
     {kind==='writeoff'&&<><label>Причина<select value={reason} onChange={e=>setReason(e.target.value)}><option value="spill">Пролив</option><option value="staff">Бесплатное пиво сотруднику</option><option value="spoilage">Порча</option><option value="tasting">Дегустация</option><option value="other">Другое</option></select></label><label><input type="checkbox" checked={notInReceipts} onChange={e=>setNotInReceipts(e.target.checked)}/>Этот расход ещё не отражён в кассовых чеках</label><p>Расход из закрытого чека уже вычитается автоматически. Повторное списание уменьшит остаток дважды.</p></>}
     {kind==='physical_return'&&<label>Чек возврата<select value={refund} onChange={e=>setRefund(e.target.value)}><option value="">Выберите чек</option>{product.refunds.filter(r=>!r.restored).map(r=><option key={r.documentId} value={r.documentId}>{r.documentId} · {liters(r.quantityMillis)} · {date(r.closedAt)}</option>)}</select></label>}
     <button className="btn" disabled={saving||Boolean(pending)||!canWrite||quantity===null||(!['initial','count'].includes(kind)&&quantity==='0')||(kind==='writeoff'&&!notInReceipts)||(['count','writeoff','physical_return'].includes(kind)&&!note.trim())||(kind==='physical_return'&&!refund)}>{saving?'Сохраняю…':kind==='delivery'?'Добавить привоз':kind==='count'?'Подтвердить сверку':'Сохранить'}</button>
    </form>}
    {product.baseline&&<button disabled={saving||Boolean(pending)||!canWrite||!product.supported} onClick={()=>open(product,'physical_return')}>Подтвердить физический возврат</button>}
    <p>Денежный возврат сам по себе не добавляет пиво. Каждый чек физического возврата подтверждается один раз.</p>
    <ul>{product.refunds.map(r=><li key={r.documentId}>Возврат денег · {r.documentId} · исходный чек {r.baseDocumentId||'не указан'} · физический возврат {r.restored?'учтён':'не подтверждён'}</li>)}</ul>
    <details open={kind==='history'}><summary>История движений</summary><ul>{product.history.map((raw,i)=>{const m=raw as Record<string,unknown>;return <li key={i}>{date(String(m.effectiveAt))} · {kindText[String(m.kind)]||String(m.kind)} · {liters(String(m.quantityMillis))} · {m.source==='evotor'?'чек '+String(m.documentId):'CRM, автор '+String(m.actorId)} {String(m.note||'')}{m.invoice?' · накладная '+String(m.invoice):''}{m.included===false?' · до начальной точки, в расчёт не входит':''}</li>})}</ul><p>История: записи {historyOffset+1}–{historyOffset+product.history.length}.</p>{historyOffset>0&&<button disabled={loading||saving} onClick={()=>setHistoryOffset(v=>Math.max(0,v-100))}>Новее</button>}{product.historyTruncated&&<button disabled={loading||saving} onClick={()=>setHistoryOffset(v=>v+100)}>Ранее</button>}</details>
   </section>}
  </>}
  </div>
 </div>
}
