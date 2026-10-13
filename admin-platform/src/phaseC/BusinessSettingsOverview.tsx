import {Coins,Gift,LayoutGrid,ShieldCheck,Smartphone,Store,Trophy} from 'lucide-react'
import type {AdminSession,ApiVenue} from '../api'
import {CardTitle,PageHead,Status} from '../ui'
import {ErrorCard,LoadingCard,SourceNote,useResource} from './common'

type FeatureData=Record<string,boolean|null|string>

const featureRows=[
  ['wheelEnabled','Колесо','Призы и вероятности для гостей',Gift],
  ['shopEnabled','Магазин','Каталог наград за бонусы',Store],
  ['achievementsEnabled','Достижения','Награды за активность гостей',Trophy],
  ['referralsEnabled','Рекомендации','Приглашения друзей и бонусы',LayoutGrid],
  ['promotionsEnabled','Акции','Промо-механики и специальные предложения',Gift],
  ['brandingEnabled','Оформление','Фирменный стиль клиентского приложения',Smartphone],
] as const

function featureStatus(value:unknown){
  if(value===true)return 'Включено'
  if(value===false)return 'Выключено'
  return 'Как сейчас'
}

export function BusinessSettingsOverview({venue,session}:{venue:ApiVenue;session:AdminSession}){
  const {data,error,loading,reload}=useResource<FeatureData>(`/api/admin/venues/${venue.id}/features/manage`)
  return <div className="page">
    <PageHead eyebrow="НАСТРОЙКИ ЗАВЕДЕНИЯ" title="Настройки" sub={`${venue.companyName} → ${venue.name}`}/>
    {error&&<ErrorCard error={error} onRetry={reload}/>}
    {loading&&!data&&<LoadingCard/>}
    {data&&<div className="settings-grid business-settings-grid">
      <section className="card editor-card">
        <CardTitle title="Разделы приложения"/>
        <div className="business-settings-list">
          {featureRows.map(([key,label,description,Icon])=><div className="business-setting-row" key={key}>
            <div className="business-setting-icon"><Icon/></div>
            <div className="grow"><b>{label}</b><span>{description}</span></div>
            <Status value={featureStatus(data[key])}/>
          </div>)}
        </div>
        <SourceNote>Показано текущее поведение клиентского приложения. На controlled pilot изменение этих разделов из панели отключено.</SourceNote>
      </section>
      <section className="card editor-card">
        <CardTitle title="Доступ из панели"/>
        <div className="business-settings-list compact">
          <div className="business-setting-row"><div className="business-setting-icon"><Coins/></div><div className="grow"><b>Баланс гостей</b><span>Ручное начисление и списание с записью в журнале</span></div><Status value={session.capabilities.productionBonusWrites?'Доступно':'Только просмотр'}/></div>
          <div className="business-setting-row"><div className="business-setting-icon"><ShieldCheck/></div><div className="grow"><b>Настройки программы</b><span>Колесо, достижения, магазин, акции и оформление</span></div><Status value={session.capabilities.writes?'Доступно':'Только просмотр'}/></div>
          <div className="business-setting-row"><div className="business-setting-icon"><Smartphone/></div><div className="grow"><b>VK и Telegram</b><span>Клиентские приложения работают независимо от Admin Platform</span></div><Status value="Работают"/></div>
        </div>
        <SourceNote>Панель не включает новые возможности сама: опасные изменения остаются закрыты до отдельного подтверждения.</SourceNote>
      </section>
    </div>}
  </div>
}
