import {useCallback,useEffect,useRef,useState} from 'react'
import {apiGet} from '../api'

interface Ticket {id:string;draftId:string;topic:string;status:'recorded';createdAt:string;scope:{companyId:string;venueId:string}}
interface Page {schemaVersion:1;requests:Ticket[];nextOffset:number|null}
const topics:Record<string,string>={connection:'Подключение кассы',customer_data:'Клиентские данные',access:'Доступ',activation:'Запуск CRM'}
export function OnboardingSupportQueue(){
  const [result,setResult]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const sequence=useRef(0)
  const load=useCallback(async(offset=0)=>{
    const current=++sequence.current;setBusy(true);setError('')
    try{
      const value=await apiGet<Page>('/api/admin/onboarding/support?offset='+offset)
      if(value.schemaVersion!==1||!Array.isArray(value.requests)||value.requests.length>25||
        (value.nextOffset!==null&&value.nextOffset!==offset+25)||value.requests.some(row=>!row||row.status!=='recorded'||
          !Object.hasOwn(topics,row.topic)||!row.scope||!/^[1-9]\d*$/.test(row.scope.companyId)||!/^[1-9]\d*$/.test(row.scope.venueId)||
          typeof row.id!=='string'||!/^[0-9a-f-]{36}$/.test(row.id)||typeof row.draftId!=='string'||!/^[0-9a-f-]{36}$/.test(row.draftId)||
          !Number.isFinite(Date.parse(row.createdAt))))throw new Error('Unconfirmed queue')
      if(current===sequence.current)setResult(previous=>({...value,requests:offset&&previous?
        [...previous.requests,...value.requests].filter((row,index,rows)=>rows.findIndex(item=>item.id===row.id)===index):value.requests}))
    }catch{if(current===sequence.current){setResult(null);setError('Не удалось получить очередь обращений. Повторите запрос.')}}
    finally{if(current===sequence.current)setBusy(false)}
  },[])
  const invalidate=useCallback(()=>{sequence.current++},[])
  useEffect(()=>{void load();return invalidate},[load,invalidate])
  return <section className="card onboarding" aria-label="Очередь обращений платформы" aria-busy={busy}>
    <h2>Обращения о подключении</h2><p>Внутренняя очередь оператора. Чтение списка не подтверждает начало работы над обращением.</p>
    <button className="btn secondary" disabled={busy} onClick={()=>void load()}>Обновить очередь</button>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Получаем обращения…</p>}
    {result&&<>{!result.requests.length?<p>Очередь пуста.</p>:<ul>{result.requests.map(row=><li key={row.id}>
      <b>{topics[row.topic]}</b><p className="support-reference">Номер: {row.id}</p>
      <p className="support-reference">Подключение: {row.draftId}</p><p>Компания {row.scope.companyId} · точка {row.scope.venueId}</p>
      <p>Сохранено · прочтение не подтверждено</p><small>{new Date(row.createdAt).toLocaleString('ru-RU')}</small>
    </li>)}</ul>}
    {result.nextOffset!==null&&<button className="btn secondary" disabled={busy} onClick={()=>void load(result.nextOffset!)}>Ещё обращения</button>}</>}
  </section>
}
