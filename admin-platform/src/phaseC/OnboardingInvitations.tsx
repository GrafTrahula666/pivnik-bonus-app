import { useCallback,useEffect,useRef,useState } from 'react'
import { Copy,Link,RefreshCw } from 'lucide-react'
import { ApiError,apiGet,apiPost,type AdminSession } from '../api'
import './venue-onboarding.css'

interface Invitation{id:string;companyId:string;venueId:string|null;role:string;status:string;expiresAt:string;singleUse:true;companyName?:string|null;venueName?:string|null}
interface Targets{invitations:Invitation[];companies:{id:string;name:string}[];venues:{id:string;companyId:string;name:string}[]}
const base='/api/admin/onboarding/invitations'
const roleLabel:Record<string,string>={owner:'Владелец',manager:'Управляющий',viewer:'Только просмотр'}
const statusLabel:Record<string,string>={active:'Ожидает принятия',consumed:'Принято',expired:'Срок истёк',revoked:'Отозвано'}
const date=(value:string)=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'}).format(new Date(value))
const target=(invitation:Invitation)=>invitation.companyName?(invitation.venueName?invitation.companyName+' · '+invitation.venueName:invitation.companyName):invitation.venueId?'Выбранная точка':'Вся организация'
export function OnboardingInvitations({session}:{session:AdminSession}){
  const allowed=session.capabilities.onboardingInvitations&&session.capabilities.onboardingInvitationOwner
  const [index,setIndex]=useState<Targets>({invitations:[],companies:[],venues:[]})
  const [companyId,setCompanyId]=useState(''),[venueId,setVenueId]=useState(''),[role,setRole]=useState('owner'),[hours,setHours]=useState(24)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[link,setLink]=useState('')
  const command=useRef<Record<string,unknown>|null>(null),inFlight=useRef(false)
  const load=useCallback(async()=>{
    try{const result=await apiGet<Targets>(base);setIndex(result);setCompanyId(value=>value||result.companies[0]?.id||result.venues[0]?.companyId||'')}
    catch(error){setError(error instanceof Error?error.message:'Не удалось загрузить приглашения.')}
  },[])
  useEffect(()=>{if(allowed)void load()},[allowed,load])
  useEffect(()=>{if(companyId&&!index.companies.some(company=>company.id===companyId)&&!venueId)setVenueId(index.venues.find(venue=>venue.companyId===companyId)?.id||'')},[companyId,index,venueId])
  async function create(){
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setError('');setNotice('')
    command.current??={requestKey:crypto.randomUUID(),companyId,venueId:venueId||null,role,expiresInHours:hours}
    try{
      const result=await apiPost<{invitation:Invitation;linkPath:string}>(base,command.current)
      if(result.invitation.status!=='active'){command.current=null;throw new Error('Приглашение уже недоступно. Создайте новое.')}
      setLink(new URL(result.linkPath,window.location.origin).toString());command.current=null
      setNotice(role==='owner'?'Приглашение владельца создано. Отправьте ссылку; письмо автоматически не отправляется.':'Приглашение создано. Отправьте ссылку приглашённому; письмо автоматически не отправляется.');await load()
    }catch(error){if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)command.current=null;setError(error instanceof Error?error.message:'Результат выдачи не подтверждён. Повторите тот же запрос.')}
    finally{setBusy(false);inFlight.current=false}
  }
  async function reopen(id:string){
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setError('')
    try{const result=await apiPost<{linkPath:string}>(base+'/'+id+'/link',{});setLink(new URL(result.linkPath,window.location.origin).toString());command.current=null;setNotice('Сохранённое приглашение открыто. Новое приглашение не создавалось.')}
    catch(error){setError(error instanceof Error?error.message:'Не удалось открыть приглашение.')}
    finally{setBusy(false);inFlight.current=false}
  }
  async function revoke(id:string){
    if(inFlight.current)return
    inFlight.current=true;setBusy(true);setError('')
    try{await apiPost(base+'/'+id+'/revoke',{});setNotice('Приглашение и выданный им доступ отозваны.');setLink('');await load()}
    catch(error){setError(error instanceof Error?error.message:'Не удалось подтвердить отзыв.')}
    finally{setBusy(false);inFlight.current=false}
  }
  if(!allowed)return null
  const organizationName=index.companies.find(company=>company.id===companyId)?.name
    ??index.venues.find(venue=>venue.companyId===companyId)?.name??'выбранная организация'
  const selectedTarget=venueId?index.venues.find(venue=>venue.id===venueId)?.name??'выбранная точка':organizationName
  const inviteMessage=link?`Здравствуйте! Это одноразовая ссылка SPACEVERSE для доступа ${role==='owner'?'владельца':'сотрудника'} к ${selectedTarget}. Перейдите по ссылке и задайте пароль: ${link}`:''
  return <section className="card onboarding" aria-label="Приглашения">
    <div className="onboarding-head"><div><span className="eyebrow">ВЛАДЕЛЬЦЫ И КОМАНДА</span><h2>Пригласить владельца заведения</h2><p>Одноразовая ссылка на выбранную компанию и точку. Владелец задаст пароль и получит доступ только к своей области.</p></div><Link/></div>
    <form onSubmit={event=>{event.preventDefault();void create()}}>
      <fieldset className="onboarding-fields" disabled={busy||Boolean(command.current)}>
        <label className="field"><span>Организация приглашения</span><select required value={companyId} onChange={event=>{setCompanyId(event.target.value);setVenueId('')}}>
          <option value="" disabled>Выберите организацию</option>{[...new Map([...index.venues.map(venue=>({id:venue.companyId,name:'Организация точки '+venue.name})),...index.companies].map(company=>[company.id,company])).values()].map(company=><option key={company.id} value={company.id}>{company.name}</option>)}
        </select></label>
        <label className="field"><span>Область приглашения</span><select value={venueId} onChange={event=>setVenueId(event.target.value)}>
          {index.companies.some(company=>company.id===companyId)&&<option value="">Вся организация · новая точка в мастере</option>}
          {index.venues.filter(venue=>venue.companyId===companyId).map(venue=><option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select></label>
        <label className="field"><span>Роль приглашённого</span><select value={role} onChange={event=>setRole(event.target.value)}><option value="owner">Владелец выбранной области</option><option value="manager">Управляющий</option><option value="viewer">Только просмотр</option></select></label>
        <label className="field"><span>Срок действия</span><select value={hours} onChange={event=>setHours(Number(event.target.value))}><option value={1}>1 час</option><option value={24}>24 часа</option><option value={72}>3 дня</option><option value={168}>7 дней</option></select></label>
      </fieldset>
      <p className="onboarding-note">{role==='owner'?'Владелец получает доступ только к выбранной компании и точке.':'Приглашённый получает доступ только к выбранной области.'} Ссылка одноразовая; после принятия доступ можно отозвать.</p>
      <div className="onboarding-actions"><button className="btn" disabled={busy||!companyId}>{busy?'Создаём…':command.current?'Повторить выдачу':'Создать приглашение'}</button>
      </div>
    </form>
    {error&&<p className="onboarding-feedback error" role="alert">{error}</p>}{notice&&<p className="onboarding-feedback" role="status">{notice}</p>}
    {link&&<div className="onboarding-invite-link"><label className="field"><span>Ссылка приглашения</span><input readOnly value={link}/></label><div className="onboarding-actions"><button className="btn secondary" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('Ссылка скопирована.')).catch(()=>setNotice('Выделите ссылку и скопируйте её вручную.'))}><Copy size={16}/>Скопировать ссылку</button><button className="btn secondary" onClick={()=>void navigator.clipboard.writeText(inviteMessage).then(()=>setNotice('Текст приглашения скопирован.')).catch(()=>setNotice('Скопируйте ссылку вручную.'))}><Copy size={16}/>Скопировать текст</button></div></div>}
    <div className="onboarding-list-head"><b>Выданные приглашения</b><button className="btn secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={14}/>Обновить</button></div>
    {!index.invitations.length&&<p>Приглашений пока нет.</p>}
    <ul className="onboarding-list">{index.invitations.map(invitation=><li key={invitation.id}><div><b>{roleLabel[invitation.role]} · {statusLabel[invitation.status]}</b><small>{target(invitation)} · до {date(invitation.expiresAt)}</small></div><div className="onboarding-actions">{invitation.status==='active'&&<button className="btn secondary" disabled={busy} onClick={()=>void reopen(invitation.id)}>Открыть ссылку</button>}{['active','consumed'].includes(invitation.status)&&<button className="btn secondary" disabled={busy} onClick={()=>void revoke(invitation.id)}>Отозвать</button>}</div></li>)}</ul>
  </section>
}
