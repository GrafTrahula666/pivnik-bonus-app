import { SPACEVERSE_BRAND } from './branding'
import { useState,type FormEvent } from 'react'
import { LockKeyhole,ShieldCheck,Sparkles } from 'lucide-react'
import { login,type AdminSession } from './api'
import BlackHole from './BlackHole'

export function Login({onAuthenticated,onDemo,onInvite}:{onAuthenticated:(session:AdminSession)=>void;onDemo?:()=>void;onInvite?:()=>void}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{onAuthenticated(await login(email,password))}catch(e){setError(e instanceof Error?e.message:'Не удалось войти.')}finally{setBusy(false)}
  }
  return <main className="login-shell spaceverse-login">
    <BlackHole/>
    <div className="login-brand"><img src={SPACEVERSE_BRAND.logo} alt="SPACEVERSE" className="brand-mark" /><div><b>SPACEVERSE</b><span>ПРОСТРАНСТВО ВАШЕГО БИЗНЕСА</span></div></div>
    <section className="login-card card">
      <div className="login-icon"><LockKeyhole /></div><span className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</span>
      <h1>С возвращением.</h1>
      <p>Ваш бизнес. Под вашим контролем.</p>
      <form onSubmit={submit}>
        <label className="field"><span>Email</span><input aria-label="Email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field"><span>Пароль</span><input aria-label="Пароль" type="password" autoComplete="current-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {error&&<div className="login-error">{error}</div>}
        <button className="btn login-submit" disabled={busy}>{busy?'Проверяем…':'Войти'}</button>
      </form>
      {onDemo&&<button type="button" className="btn secondary login-demo" onClick={onDemo}><Sparkles/>Посмотреть демо-версию</button>}
      {onInvite&&<button type="button" className="btn secondary login-demo" onClick={onInvite}>Войти по приглашению</button>}
      <div className="login-safety"><ShieldCheck/><span>Приложения ваших гостей работают независимо от панели управления.</span></div>
    </section>
  </main>
}
