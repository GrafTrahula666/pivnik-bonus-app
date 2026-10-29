import { useState } from 'react'
import { KeyRound,ShieldCheck } from 'lucide-react'
import type { AdminSession } from '../api'
import { apiPost } from '../api'
import { CardTitle } from '../ui'
import { SourceNote } from './common'

export function AccountSecurityPanel({session}:{session:AdminSession}){
  const [currentPassword,setCurrentPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [repeatPassword,setRepeatPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [ok,setOk]=useState('')

  const mismatch=Boolean(repeatPassword)&&newPassword!==repeatPassword
  const weak=Boolean(newPassword)&&newPassword.length<12
  const disabled=busy||!currentPassword||newPassword.length<12||newPassword!==repeatPassword

  async function submit(){
    if(disabled)return
    setBusy(true);setError('');setOk('')
    try{
      const result=await apiPost<{ok:true;revokedSessions:number}>('/api/admin/auth/password',{currentPassword,newPassword})
      setCurrentPassword('');setNewPassword('');setRepeatPassword('')
      setOk(result.revokedSessions>0
        ? `Пароль изменён. Завершено других сессий: ${result.revokedSessions}.`
        : 'Пароль изменён. Других активных сессий не было.')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить пароль.')}
    finally{setBusy(false)}
  }

  return <div className="page">
    <section className="card editor-card">
      <CardTitle title="Безопасность аккаунта"/>
      <div className="setting-row"><div><b>{session.admin.displayName}</b><span>{session.admin.email}</span></div><ShieldCheck/></div>
      <div className="form-grid two">
        <label className="field"><span>Текущий пароль</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} placeholder="Введите текущий пароль"/></label>
        <span/>
        <label className="field"><span>Новый пароль</span><input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Минимум 12 символов"/></label>
        <label className="field"><span>Повторите новый пароль</span><input type="password" autoComplete="new-password" value={repeatPassword} onChange={e=>setRepeatPassword(e.target.value)} placeholder="Повторите новый пароль"/></label>
      </div>
      {weak&&<div className="login-error">Новый пароль должен содержать минимум 12 символов.</div>}
      {mismatch&&<div className="login-error">Новые пароли не совпадают.</div>}
      {error&&<div className="login-error">{error}</div>}
      {ok&&<div className="save-success">{ok}</div>}
      <div className="modal-actions"><button className="btn" disabled={disabled} onClick={()=>void submit()}><KeyRound/>{busy?'Меняем…':'Сменить пароль'}</button></div>
      <SourceNote>Для смены требуется текущий пароль. Новый пароль не сохраняется в открытом виде; после смены остальные активные сессии аккаунта закрываются.</SourceNote>
    </section>
  </div>
}
