import { useEffect,useState,type FormEvent } from 'react'
import { LockKeyhole,ShieldCheck,Sparkles } from 'lucide-react'
import { ApiError,apiGet,apiPost } from './api'

interface Preview {venueName:string;companyName:string}
const message=(error:unknown)=>error instanceof Error?error.message:'Приглашение недействительно, использовано или истекло.'

export function InviteClaim({token}:{token:string}){
  const [preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('')
  const [email,setEmail]=useState(''),[displayName,setDisplayName]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false)

  useEffect(()=>{let cancelled=false
    apiGet<Preview>('/api/admin/onboarding/invite/'+encodeURIComponent(token))
      .then(result=>{if(!cancelled)setPreview(result)})
      .catch(error=>{if(!cancelled)setLoadError(message(error))})
      .finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[token])

  async function submit(event:FormEvent){
    event.preventDefault();setError('')
    if(password!==confirm){setError('Пароли не совпадают.');return}
    setBusy(true)
    try{
      await apiPost('/api/admin/onboarding/invite/claim',{token,email,displayName,password})
      setDone(true)
      setTimeout(()=>{window.location.href='/'},1200)
    }catch(error){setError(error instanceof ApiError?error.message:message(error))}
    finally{setBusy(false)}
  }

  return <main className="login-shell">
    <section className="login-card card">
      <div className="login-brand"><div className="brand-mark">S</div><div><b>SPACEVERSE</b><span>ПАНЕЛЬ ВЛАДЕЛЬЦА</span></div></div>
      <div className="login-icon"><Sparkles/></div><span className="eyebrow">ПРИГЛАШЕНИЕ ВЛАДЕЛЬЦУ</span>
      {loading&&<p role="status">Проверяем ссылку…</p>}
      {!loading&&loadError&&<div className="login-error" role="alert">{loadError}</div>}
      {!loading&&!loadError&&preview&&!done&&<>
        <h1>Доступ к заведению «{preview.venueName}»</h1>
        <p>Организация: {preview.companyName}. Задайте email и пароль — это будет ваш вход в панель управления этим заведением.</p>
        <form onSubmit={submit}>
          <label className="field"><span>Email</span><input aria-label="Email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label className="field"><span>Ваше имя</span><input aria-label="Ваше имя" autoComplete="name" required maxLength={120} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
          <label className="field"><span>Пароль</span><input aria-label="Пароль" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></label>
          <label className="field"><span>Повторите пароль</span><input aria-label="Повторите пароль" type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
          {error&&<div className="login-error" role="alert">{error}</div>}
          <button className="btn login-submit" disabled={busy}><LockKeyhole size={16}/>{busy?'Создаём доступ…':'Получить доступ'}</button>
        </form>
      </>}
      {done&&<p role="status">Доступ создан. Входим в панель…</p>}
      <div className="login-safety"><ShieldCheck/><span>Ссылка одноразовая: после создания доступа она перестаёт действовать.</span></div>
    </section>
  </main>
}
