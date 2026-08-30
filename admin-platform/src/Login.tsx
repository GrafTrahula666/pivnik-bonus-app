import { useState,type FormEvent } from 'react'
import { LockKeyhole,ShieldCheck } from 'lucide-react'
import { login,type AdminSession } from './api'

export function Login({onAuthenticated}:{onAuthenticated:(session:AdminSession)=>void}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('')
    try{onAuthenticated(await login(email,password))}catch(e){setError(e instanceof Error?e.message:'Не удалось войти.')}finally{setBusy(false)}
  }
  return <main className="login-shell">
    <section className="login-card card">
      <div className="login-brand"><div className="brand-mark">P</div><div><b>PIVNIK</b><span>BUSINESS</span></div></div>
      <div className="login-icon"><LockKeyhole /></div><span className="eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</span>
      <h1>Вход в панель управления</h1>
      <p>Безопасный доступ к показателям, клиентам и настройкам ваших заведений.</p>
      <form onSubmit={submit}>
        <label className="field"><span>Email</span><input aria-label="Email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="field"><span>Пароль</span><input aria-label="Пароль" type="password" autoComplete="current-password" required minLength={12} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {error&&<div className="login-error">{error}</div>}
        <button className="btn login-submit" disabled={busy}>{busy?'Проверяем…':'Войти'}</button>
      </form>
      <div className="login-safety"><ShieldCheck/><span>Клиентские приложения VK и Telegram работают независимо от панели управления.</span></div>
    </section>
  </main>
}
