import { useEffect,useState } from 'react'
import { Link,ShieldCheck } from 'lucide-react'
import { acceptInvitation,apiPost,logout,type AdminSession } from '../api'
import { Login } from '../Login'
import './venue-onboarding.css'

interface Preview{companyName:string;venueName:string|null;role:string;status:string;expiresAt:string}
export function InviteAcceptance({initialToken,session,onAccepted,onClose}:{initialToken:string;session:AdminSession|null;onAccepted:(session:AdminSession,draftId:string|null)=>void;onClose:()=>void}){
  const [token,setToken]=useState(initialToken),[preview,setPreview]=useState<Preview|null>(null)
  const [email,setEmail]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState('')
  const [activeSession,setActiveSession]=useState(session),[loginMode,setLoginMode]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{
    let cancelled=false
    setPreview(null);setError('')
    if(/^SVI-[A-Za-z0-9_-]{43}$/.test(token))apiPost<{invitation:Preview}>('/api/admin/onboarding/invitations/preview',{token})
      .then(result=>{if(!cancelled)setPreview(result.invitation)}).catch(error=>{if(!cancelled)setError(error instanceof Error?error.message:'Не удалось проверить приглашение.')})
    return()=>{cancelled=true}
  },[token])
  async function accept(current=activeSession){
    if(busy)return
    setBusy(true);setError('')
    try{
      const result=await acceptInvitation(current?{token}:{token,email,displayName:name,password})
      setPassword('');window.history.replaceState(null,'',window.location.pathname+window.location.search)
      onAccepted(result,result.draftId)
    }catch(error){setError(error instanceof Error?error.message:'Приглашение не подтверждено. Повторите вход.')}
    finally{setBusy(false)}
  }
  if(loginMode&&!activeSession)return <><Login onAuthenticated={value=>{setActiveSession(value);setLoginMode(false);void accept(value)}}/><button className="btn secondary invitation-back" onClick={()=>setLoginMode(false)}>Назад к приглашению</button></>
  return <main className="login-shell"><section className="login-card card">
    <div className="login-icon"><Link/></div><span className="eyebrow">SPACEVERSE</span><h1>Подключение по приглашению</h1>
    <form onSubmit={event=>{event.preventDefault();void accept()}}>
      <label className="field"><span>Код приглашения</span><input required autoComplete="off" value={token} onChange={event=>setToken(event.target.value.trim())} readOnly={Boolean(initialToken)} maxLength={47}/></label>
      {preview&&<div className="onboarding-feedback"><b>{preview.companyName}{preview.venueName?' · '+preview.venueName:''}</b><p>Доступ: {preview.role==='viewer'?'только просмотр':preview.role==='owner'?'владелец выбранной области':'управляющий'}.</p>
        {preview.status==='active'?<p>Создайте учётную запись или войдите в существующую. Затем продолжите настройку заведения.</p>:<p>{preview.status==='consumed'?'Приглашение принято. Войдите в принявшую его учётную запись.':preview.status==='expired'?'Срок приглашения истёк. Попросите владельца создать новое.':'Приглашение отозвано. Попросите владельца создать новое.'}</p>}
      </div>}
      {activeSession?<p>Вы вошли как <b>{activeSession.admin.email}</b>.</p>:<>
        <label className="field"><span>Ваше имя</span><input required maxLength={80} autoComplete="name" value={name} onChange={event=>setName(event.target.value)}/></label>
        <label className="field"><span>Email</span><input required type="email" maxLength={254} autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)}/></label>
        <label className="field"><span>Новый пароль</span><input required type="password" minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
      </>}
      {error&&<div className="login-error" role="alert">{error}</div>}
      <button className="btn login-submit" disabled={busy||!preview||['expired','revoked'].includes(preview.status)}>{busy?'Проверяем…':activeSession?'Принять и открыть мастер':'Создать учётную запись и открыть мастер'}</button>
    </form>
    {!activeSession&&<button className="btn secondary login-demo" onClick={()=>setLoginMode(true)}>У меня уже есть учётная запись</button>}
    {activeSession&&<button className="btn secondary login-demo" onClick={()=>void logout().then(()=>{setActiveSession(null);setLoginMode(true)})}>Войти другой учётной записью</button>}
    <button className="btn secondary login-demo" onClick={onClose}>Вернуться к панели</button>
    <div className="login-safety"><ShieldCheck/><span>Приглашение не включает заведение автоматически. Статус подключения подтвердит сервер.</span></div>
  </section></main>
}
