import { useState } from 'react'
import { CheckCircle2,RefreshCw,XCircle } from 'lucide-react'
import { CardTitle,PageHead } from '../ui'
import { ErrorCard,LoadingCard,SourceNote,dt,num,useResource } from './common'
import { SortTh,sortTableRows,type SortDirection } from './TableSort'

// Owner-only technical view of PIVNIK Business and the guest app. Read-only.

type Probe<T>={ok:true;value:T;ms:number}|{ok:false;error:string;ms:number}
interface DbInfo {name:string;bytes:number;version:string;connections:number;tables:Array<{table:string;rows:number;bytes:number}>}
interface Overview {
  service:{startedAt:string;uptimeSeconds:number;node:string;memoryMb:number;heapMb:number;commit:string|null;commitMessage:string|null;branch:string|null;environment:string;service:string|null;region:string|null}
  databases:{metadata:Probe<DbInfo>;production:Probe<DbInfo>;writer:Probe<boolean>}
  guestApp:{url:string|null}&({ok:true;value:{release:string|null;database:string};ms:number}|{ok:false;error:string;ms:number})
  switches:Array<{key:string;label:string;on:boolean}>
  recentErrors:Array<{at:string;method:string;path:string;code:string;message:string}>
  recentActions:Array<{action:string;at:string;admin:string|null}>
}

// The main Postgres volume on Railway is 5 GB; both the app data and the panel database live there.
const VOLUME_BYTES=5*1024**3
const mb=(b:number)=>b>=1024**3?`${(b/1024**3).toFixed(2)} ГБ`:`${(b/1048576).toFixed(1)} МБ`
const uptime=(s:number)=>{const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?`${d} д ${h} ч`:h?`${h} ч ${m} мин`:`${m} мин`}
function Light({ok,label,detail}:{ok:boolean;label:string;detail:string}){
  return <div className="setting-row"><div><b>{label}</b><span>{detail}</span></div>{ok?<CheckCircle2 className="dev-ok"/>:<XCircle className="dev-bad"/>}</div>
}
function DbCard({title,probe}:{title:string;probe:Probe<DbInfo>}){
  const [sort,setSort]=useState('table'),[direction,setDirection]=useState<SortDirection>('asc')
  const changeSort=(key:string,dir:SortDirection)=>{setSort(key);setDirection(dir)}
  if(!probe.ok)return <section className="card editor-card"><CardTitle title={title}/><div className="login-error">{probe.error}</div></section>
  const d=probe.value
  const rows=sortTableRows(d.tables,t=>sort==='rows'?t.rows:sort==='size'?t.bytes:t.table,direction)
  return <section className="card editor-card"><CardTitle title={title}/>
    <div className="setting-row"><div><b>{d.name}</b><span>PostgreSQL {d.version} · подключений {d.connections} · ответ {probe.ms} мс</span></div><strong>{mb(d.bytes)}</strong></div>
    <div className="table-scroll"><table><thead><tr><SortTh label="Таблица" column="table" sort={sort} direction={direction} onSort={changeSort} initialDirection="asc"/><SortTh label="Строк (примерно)" column="rows" sort={sort} direction={direction} onSort={changeSort}/><SortTh label="Размер" column="size" sort={sort} direction={direction} onSort={changeSort}/></tr></thead>
      <tbody>{rows.map(t=><tr key={t.table}><td>{t.table}</td><td>{num(t.rows)}</td><td>{mb(t.bytes)}</td></tr>)}</tbody></table></div>
  </section>
}

export function DeveloperPage(){
  const [errorSort,setErrorSort]=useState('date'),[errorDirection,setErrorDirection]=useState<SortDirection>('desc')
  const [actionSort,setActionSort]=useState('date'),[actionDirection,setActionDirection]=useState<SortDirection>('desc')
  const {data,error,loading,reload}=useResource<Overview>('/api/admin/developer')
  if(loading&&!data)return <LoadingCard text="Собираем состояние сервисов…"/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  const errors=sortTableRows(data.recentErrors,e=>errorSort==='request'?e.method+' '+e.path:errorSort==='error'?e.code+' '+e.message:e.at,errorDirection)
  const actions=sortTableRows(data.recentActions,a=>actionSort==='admin'?a.admin:actionSort==='action'?a.action:a.at,actionDirection)
  const s=data.service,db=data.databases
  const used=(db.metadata.ok?db.metadata.value.bytes:0)+(db.production.ok?db.production.value.bytes:0)
  return <div className="page">
    <PageHead eyebrow="ТОЛЬКО ДЛЯ ВЛАДЕЛЬЦА" title="Разработчик" sub="Состояние сервисов, баз данных и переключателей"
      actions={<button className="btn secondary" onClick={reload}><RefreshCw/>Обновить</button>}/>
    <div className="settings-grid dev-grid">
      <section className="card editor-card"><CardTitle title="Сервисы"/>
        <Light ok label="Панель PIVNIK Business" detail={`работает ${uptime(s.uptimeSeconds)} · версия ${s.commit||'—'}${s.branch?` (${s.branch})`:''} · Node ${s.node} · память ${s.memoryMb} МБ`}/>
        <Light ok={data.guestApp.ok} label="Приложение для гостей" detail={data.guestApp.ok?`отвечает за ${data.guestApp.ms} мс · версия ${data.guestApp.value.release||'—'}`:data.guestApp.error}/>
        <Light ok={db.production.ok} label="База приложения (чтение)" detail={db.production.ok?`отвечает за ${db.production.ms} мс`:db.production.error}/>
        <Light ok={db.writer.ok} label="База приложения (запись)" detail={db.writer.ok?`отвечает за ${db.writer.ms} мс`:db.writer.error}/>
        <Light ok={db.metadata.ok} label="База панели" detail={db.metadata.ok?`отвечает за ${db.metadata.ms} мс`:db.metadata.error}/>
        {s.commitMessage&&<SourceNote>Последняя выкладка панели: {s.commitMessage}. Запущена {dt(s.startedAt)}.</SourceNote>}
      </section>
      <section className="card editor-card"><CardTitle title="Диск базы данных"/>
        <div className="setting-row"><div><b>Занято</b><span>из {mb(VOLUME_BYTES)} на диске Railway</span></div><strong>{mb(used)}</strong></div>
        <div className="dev-meter"><i style={{width:`${Math.min(100,used/VOLUME_BYTES*100).toFixed(1)}%`}}/></div>
        <SourceNote>Свободно примерно {mb(Math.max(0,VOLUME_BYTES-used))}. Сюда входят данные приложения и панели.</SourceNote>
        <CardTitle title="Переключатели"/>
        {data.switches.map(x=><div className="setting-row" key={x.key}><div><b>{x.label}</b><span>{x.key}</span></div><strong className={x.on?'safe-word':'read-only-word'}>{x.on?'ВКЛ':'ВЫКЛ'}</strong></div>)}
        <SourceNote>Переключатели меняются в переменных сервиса admin-pilot в Railway.</SourceNote>
      </section>
    </div>
    <div className="settings-grid dev-grid">
      <DbCard title="База приложения" probe={db.production}/>
      <DbCard title="База панели" probe={db.metadata}/>
    </div>
    <div className="settings-grid dev-grid">
      <section className="card editor-card"><CardTitle title="Последние ошибки сервера"/>
        {!data.recentErrors.length?<p className="muted-copy">С момента запуска ошибок не было.</p>:
        <div className="table-scroll"><table><thead><tr><SortTh label="Когда" column="date" sort={errorSort} direction={errorDirection} onSort={(key,dir)=>{setErrorSort(key);setErrorDirection(dir)}}/><SortTh label="Запрос" column="request" sort={errorSort} direction={errorDirection} onSort={(key,dir)=>{setErrorSort(key);setErrorDirection(dir)}} initialDirection="asc"/><SortTh label="Ошибка" column="error" sort={errorSort} direction={errorDirection} onSort={(key,dir)=>{setErrorSort(key);setErrorDirection(dir)}} initialDirection="asc"/></tr></thead><tbody>
          {errors.map((e,i)=><tr key={i}><td>{dt(e.at)}</td><td>{e.method} {e.path}</td><td><b>{e.code}</b> {e.message}</td></tr>)}
        </tbody></table></div>}
      </section>
      <section className="card editor-card"><CardTitle title="Последние действия в панели"/>
        <div className="table-scroll"><table><thead><tr><SortTh label="Когда" column="date" sort={actionSort} direction={actionDirection} onSort={(key,dir)=>{setActionSort(key);setActionDirection(dir)}}/><SortTh label="Кто" column="admin" sort={actionSort} direction={actionDirection} onSort={(key,dir)=>{setActionSort(key);setActionDirection(dir)}} initialDirection="asc"/><SortTh label="Действие" column="action" sort={actionSort} direction={actionDirection} onSort={(key,dir)=>{setActionSort(key);setActionDirection(dir)}} initialDirection="asc"/></tr></thead><tbody>
          {actions.map((a,i)=><tr key={i}><td>{dt(a.at)}</td><td>{a.admin||'—'}</td><td>{a.action}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  </div>
}
