import { useEffect,useState } from 'react'
import { Megaphone,RefreshCw,Send } from 'lucide-react'
import type { AdminSession,ApiVenue } from '../api'
import { apiGet,apiPost } from '../api'
import { CardTitle,ConfirmModal,PageHead,cn } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,WriteGatePill,dt,num,useResource } from './common'
import { LinkedToAppNote,isPivnikAppVenue } from './AppContentManagers'

// Sends a message to guests through the PIVNIK app's Telegram and VK bots.

type Channel='telegram'|'vk'|'all'
type Audience='clients'|'all'|`seg:${SegmentKey}`
type SegmentKey='new'|'regular'|'active'|'lapsing'|'gone'|'never'
interface Preview {totalUsers:number;activeUsers:number;truncated:boolean;telegramRecipients:number;vkRecipients:number;telegramConfigured:boolean;vkConfigured:boolean;maxRecipients:number}
interface Delivery {attempted:number;delivered:number;failed:number;skipped?:string}
interface SendResult {deduplicated:boolean;totalUsers:number;truncated:boolean;telegram:Delivery;vk:Delivery}
interface HistoryItem {id:string;status:string;channel:Channel;audience:'clients'|'all';segment:SegmentKey|null;totalUsers:number;createdAt:string;telegramDelivered:number;telegramFailed:number;vkDelivered:number;vkFailed:number;message:string|null;sentBy:string|null}
interface History {configured:boolean;writesEnabled:boolean;items:HistoryItem[]}

const MAX=3000
const CHANNELS:Array<[Channel,string]>=[['all','Telegram и VK'],['telegram','Только Telegram'],['vk','Только VK']]
const AUDIENCES:Array<[Audience,string]>=[
  ['clients','Все гости'],['all','Гости и сотрудники'],
  ['seg:lapsing','Пропадают (не были 21–60 дней)'],['seg:gone','Ушли (не были больше 60 дней)'],['seg:never','Не покупали ни разу'],
  ['seg:new','Новые (за 14 дней)'],['seg:regular','Постоянные'],['seg:active','Заходят'],
]
const audienceLabel=(a:string)=>AUDIENCES.find(([k])=>k===a)?.[1]||a
const channelLabel=(c:string)=>CHANNELS.find(([k])=>k===c)?.[1]||c
const statusLabel=(s:string)=>s==='completed'?'Отправлена':s==='processing'?'Отправляется':'Ошибка'

export function BroadcastPage({venue,session,segment}:{venue:ApiVenue;session:AdminSession;segment?:string}){
  if(!isPivnikAppVenue(venue))return <div className="page"><PageHead eyebrow="КОММУНИКАЦИИ" title="Рассылки" sub={`${venue.companyName} → ${venue.name}`}/>
    <div className="empty card"><Megaphone/><h3>Рассылки пока недоступны</h3><p>Это заведение ещё не подключено к приложению для гостей.</p></div></div>
  return <PivnikBroadcast venue={venue} session={session} initialAudience={AUDIENCES.some(([k])=>k===`seg:${segment}`)?`seg:${segment}` as Audience:'clients'}/>
}

function PivnikBroadcast({venue,session,initialAudience}:{venue:ApiVenue;session:AdminSession;initialAudience:Audience}){
  const base=`/api/admin/venues/${venue.id}/broadcast`
  const history=useResource<History>(base)
  const [audience,setAudience]=useState<Audience>(initialAudience),[channel,setChannel]=useState<Channel>('all'),[message,setMessage]=useState('')
  const [preview,setPreview]=useState<Preview|null>(null),[previewError,setPreviewError]=useState('')
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<SendResult|null>(null)
  const configured=history.data?.configured
  useEffect(()=>{
    if(!configured)return
    let cancelled=false;setPreview(null);setPreviewError('')
    const query=audience.startsWith('seg:')?`segment=${audience.slice(4)}`:`audience=${audience}`
    apiGet<Preview>(`${base}/preview?${query}`).then(p=>{if(!cancelled)setPreview(p)}).catch(e=>{if(!cancelled)setPreviewError(e instanceof Error?e.message:'Не удалось посчитать получателей.')})
    return()=>{cancelled=true}
  },[base,audience,configured])

  if(history.loading&&!history.data)return <LoadingCard/>
  if(history.error&&!history.data)return <ErrorCard error={history.error} onRetry={history.reload}/>
  const canWrite=session.capabilities.writes&&Boolean(configured)
  const recipients=preview?(channel==='telegram'?preview.telegramRecipients:channel==='vk'?preview.vkRecipients:preview.telegramRecipients+preview.vkRecipients):0
  const channelMissing=preview&&((channel==='telegram'&&!preview.telegramConfigured)||(channel==='vk'&&!preview.vkConfigured))

  async function send(){
    setConfirm(false);setBusy(true);setError('');setResult(null)
    try{const target=audience.startsWith('seg:')?{segment:audience.slice(4)}:{audience}
      const r=await apiPost<SendResult>(base,{channel,message,...target});setResult(r);if(!r.deduplicated)setMessage('');history.reload()}
    catch(e){setError(e instanceof Error?e.message:'Не удалось отправить рассылку.')}
    finally{setBusy(false)}
  }

  return <div className="page">
    <PageHead eyebrow="КОММУНИКАЦИИ" title="Рассылки" sub={`${venue.companyName} → ${venue.name}`}
      actions={<><WriteGatePill enabled={canWrite}/><button className="btn" disabled={!canWrite||busy||!message.trim()||message.length>MAX||!recipients||Boolean(channelMissing)} onClick={()=>setConfirm(true)}><Send/>{busy?'Отправляем…':'Отправить'}</button></>}/>
    <LinkedToAppNote/>
    {!configured&&<div className="safety-note panel-only-note"><Megaphone/><span>Рассылки ещё не подключены к приложению. Нужны переменные PIVNIK_APP_URL и BUSINESS_INTERNAL_TOKEN.</span></div>}
    <div className="settings-grid">
      <section className="card editor-card"><CardTitle title="Сообщение"/>
        <label className="field"><span>Текст ({message.length}/{MAX})</span><textarea rows={8} maxLength={MAX} value={message} placeholder="Например: В пятницу с 18 до 20 каждое второе пиво со скидкой 50%" onChange={e=>setMessage(e.target.value)}/></label>
        <div className="form-grid two">
          <label className="field"><span>Кому</span><select value={audience} onChange={e=>setAudience(e.target.value as Audience)}>{AUDIENCES.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Куда</span><select value={channel} onChange={e=>setChannel(e.target.value as Channel)}>{CHANNELS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        {error&&<div className="login-error">{error}</div>}
        {result&&<div className="save-success">{result.deduplicated?'Такое же сообщение уже отправлялось в последние 10 минут, повтор не отправлен. ':''}Telegram: доставлено {num(result.telegram.delivered)} из {num(result.telegram.attempted)}. VK: доставлено {num(result.vk.delivered)} из {num(result.vk.attempted)}.</div>}
        <SourceNote>Сообщение получат гости, которые приняли правила и не отключили рекламные сообщения. Одинаковое сообщение нельзя отправить повторно в течение 10 минут.</SourceNote>
      </section>
      <section className="card editor-card"><CardTitle title="Получатели"/>
        {previewError&&<div className="login-error">{previewError}</div>}
        {!preview&&!previewError&&configured&&<div className="setting-row"><span>Считаем…</span></div>}
        {preview&&<>
          <div className="setting-row"><div><b>Получат сообщение</b><span>из {num(preview.activeUsers)} принявших правила</span></div><strong>{num(preview.totalUsers)}</strong></div>
          <div className="setting-row"><div><b>Telegram</b><span>{preview.telegramConfigured?'бот подключён':'бот не настроен'}</span></div><strong className={preview.telegramConfigured?'':'read-only-word'}>{num(preview.telegramRecipients)}</strong></div>
          <div className="setting-row"><div><b>VK</b><span>{preview.vkConfigured?'сообщество подключено':'сообщество не настроено'}</span></div><strong className={preview.vkConfigured?'':'read-only-word'}>{num(preview.vkRecipients)}</strong></div>
          {preview.truncated&&<div className="login-error">За один раз можно отправить не больше {num(preview.maxRecipients)} гостям: остальные не получат это сообщение.</div>}
        </>}
      </section>
    </div>
    <section className="card broadcast-history"><div className="card-title"><h3>История рассылок</h3><button className="btn secondary" onClick={history.reload}><RefreshCw/>Обновить</button></div>
      {!history.data?.items.length?<p className="muted-copy">Рассылок пока не было.</p>:
      <div className="table-scroll"><table><thead><tr><th>Когда</th><th>Текст</th><th>Кому</th><th>Куда</th><th>Telegram</th><th>VK</th><th>Статус</th></tr></thead><tbody>
        {history.data.items.map(x=><tr key={x.id}>
          <td>{dt(x.createdAt)}{x.sentBy&&<small className="broadcast-by">{x.sentBy}</small>}</td>
          <td className="broadcast-text">{x.message||<span className="muted-copy">из админки приложения</span>}</td>
          <td>{audienceLabel(x.segment?`seg:${x.segment}`:x.audience)}</td>
          <td>{channelLabel(x.channel)}</td>
          <td>{num(x.telegramDelivered)}{x.telegramFailed?` / ошибок ${num(x.telegramFailed)}`:''}</td>
          <td>{num(x.vkDelivered)}{x.vkFailed?` / ошибок ${num(x.vkFailed)}`:''}</td>
          <td><span className={cn(x.status==='completed'?'safe-word':x.status==='failed'?'broadcast-failed':'read-only-word')}>{statusLabel(x.status)}</span></td>
        </tr>)}
      </tbody></table></div>}
    </section>
    {confirm&&<ConfirmModal title="Отправить рассылку?" text={`Сообщение уйдёт примерно ${num(recipients)} гостям: ${audienceLabel(audience).toLowerCase()}, ${channelLabel(channel)}. Отменить отправку будет нельзя.`} onCancel={()=>setConfirm(false)} onConfirm={()=>void send()}/>}
  </div>
}
