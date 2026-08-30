import { useEffect,useState,type ReactNode } from 'react'
import { AlertTriangle,Database,LoaderCircle,ShieldCheck } from 'lucide-react'
import { apiGet } from '../api'

export function useResource<T>(path:string, deps:readonly unknown[]=[]){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0)
  useEffect(()=>{let cancelled=false;setLoading(true);setError('')
    apiGet<T>(path).then(v=>{if(!cancelled)setData(v)}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Ошибка загрузки')}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[path,reload,...deps])
  return {data,error,loading,reload:()=>setReload(v=>v+1),setData}
}
export function LivePill({write=false}:{write?:boolean}){return <div className={write?'write-live-pill':'live-source-pill'}><span/><Database/>{write?'ИЗМЕНЕНИЯ ДОСТУПНЫ':'ДАННЫЕ ОБНОВЛЕНЫ'}</div>}
export function WriteGatePill({enabled,label='ИЗМЕНЕНИЯ'}:{enabled:boolean;label?:string}){return <div className={enabled?'write-live-pill':'read-only-button'}>{enabled?<ShieldCheck/>:<AlertTriangle/>}{label} · {enabled?'ДОСТУПНЫ':'ТОЛЬКО ПРОСМОТР'}</div>}
export function LoadingCard({text='Загрузка реальных данных…'}:{text?:string}){return <div className="card phase-loading"><LoaderCircle/><b>{text}</b></div>}
export function ErrorCard({error,onRetry}:{error:string;onRetry?:()=>void}){return <div className="error-state card"><AlertTriangle/><h3>Не удалось выполнить запрос</h3><p>{error}</p>{onRetry&&<button className="btn secondary" onClick={onRetry}>Повторить</button>}</div>}
export function SourceNote({children}:{children:ReactNode}){return <div className="safety-note"><ShieldCheck/><span>{children}</span></div>}
export const money=(n:number|null|undefined)=>n===null||n===undefined?'Нет данных':`₽ ${new Intl.NumberFormat('ru-RU').format(Math.round(n))}`
export const num=(n:number|null|undefined)=>n===null||n===undefined?'Нет данных':new Intl.NumberFormat('ru-RU').format(Math.round(n))
export const dt=(v:string|null|undefined)=>{if(!v)return '—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU'):'—'}


export async function imageFileToDataUrl(file:File):Promise<string>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Разрешены JPG, PNG или WEBP.')
  if(file.size>2_300_000)throw new Error('Изображение должно быть не больше 2.3 МБ до base64-кодирования.')
  return await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error('Не удалось прочитать файл.'))
    reader.onerror=()=>reject(reader.error||new Error('Не удалось прочитать файл.'))
    reader.readAsDataURL(file)
  })
}
