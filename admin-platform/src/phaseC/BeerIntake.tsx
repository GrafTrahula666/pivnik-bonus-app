import {useMemo, useState} from 'react'
import {ClipboardCopy, Download, PackagePlus, ShieldAlert} from 'lucide-react'
import type {ApiVenue} from '../api'
import {PageHead} from '../ui'
import {parseBeerIntake} from './beer-intake'
import './beer-intake.css'

const formatLiters = (value:number) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:3}).format(value)

/** Text intake draft only. No remote mutations until the provider authorization and idempotent write contract are verified. */
export function BeerIntake({venue}:{venue:ApiVenue}) {
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const result = useMemo(()=>parseBeerIntake(text),[text])
  const clean = result.rows.length > 0 && result.errors.length === 0
  const total = result.rows.reduce((sum,row)=>sum+row.liters,0)
  const summary = result.rows.map(row=>row.name + ': +' + formatLiters(row.liters) + ' л').join('\n')
  const onChange = (value:string) => {setText(value);setNotice('')}
  async function copySummary(){
    if(!clean)return
    try{await navigator.clipboard.writeText(summary);setNotice('Сводка скопирована. Остатки Эвотора не изменены.')}
    catch{setNotice('Не получилось скопировать. Выделите данные из таблицы вручную.')}
  }
  function exportCsv(){
    if(!clean)return
    const csv = '\uFEFFНазвание;Приход (л);Кег;Литров в кеге\r\n' + result.rows.map(row=>
      [row.name,row.liters,row.kegCount??'',row.litersPerKeg??''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')
    ).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const link = document.createElement('a')
    link.href=url;link.download='PIVNIK-prihod-chernovik.csv';link.click()
    URL.revokeObjectURL(url)
    setNotice('Черновик CSV выгружен. Он не является документом поступления Эвотора.')
  }
  return <div className="page beer-intake">
    <PageHead eyebrow="ПИВНИК · ПОСТУПЛЕНИЕ" title="Приход пива" sub={venue.companyName+' → '+venue.name}/>
    <section className="card beer-intake-card">
      <div className="beer-intake-heading"><PackagePlus size={22}/><div><h3>Введите привоз обычным текстом</h3><p>Один напиток на строку. Для кег обязательно указывайте литраж каждой кеги.</p></div></div>
      <label className="beer-intake-label" htmlFor="beer-intake-text">Список привоза</label>
      <textarea id="beer-intake-text" value={text} maxLength={3000} onChange={e=>onChange(e.target.value)} placeholder={'Хадыженское +2 кеги по 50 л\nПилснер +1 кега по 30 л\nБарное +15 л'} spellCheck={false}/>
      <div className="beer-intake-meta"><span>Позиций: {result.rows.length}</span><span>Общий привоз: {formatLiters(total)} л</span><span>Ошибок: {result.errors.length}</span></div>
      {result.errors.length>0&&<div className="beer-intake-errors" role="alert">{result.errors.map((error,index)=><p key={index}>Строка {error.line || '—'}: {error.message}</p>)}</div>}
      {result.rows.length>0&&<div className="beer-intake-table-wrap"><table className="beer-intake-table"><thead><tr><th>Напиток</th><th>Кег</th><th>Объём кеги</th><th>Приход</th></tr></thead><tbody>{result.rows.map(row=><tr key={row.line}><td>{row.name}</td><td>{row.kegCount??'—'}</td><td>{row.litersPerKeg===null?'—':formatLiters(row.litersPerKeg)+' л'}</td><td className="beer-intake-plus">+{formatLiters(row.liters)} л</td></tr>)}</tbody></table></div>}
      <div className="beer-intake-actions"><button type="button" className="btn secondary" disabled={!clean} onClick={()=>void copySummary()}><ClipboardCopy size={16}/>Скопировать сводку</button><button type="button" className="btn secondary" disabled={!clean} onClick={exportCsv}><Download size={16}/>Черновик CSV</button></div>
      {notice&&<p className="beer-intake-notice" role="status">{notice}</p>}
    </section>
    <div className="safety-note beer-intake-warning"><ShieldAlert size={18}/><span><b>Пока только подготовка поступления.</b> Эта форма ничего не записывает в Эвотор и не меняет товарные остатки. Автоматическое проведение будет доступно только после проверки прав доступа, сопоставления товаров, защиты от повторных отправок и серверного журнала.</span></div>
  </div>
}
