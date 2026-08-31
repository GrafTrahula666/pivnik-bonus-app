import {Gift,ShieldCheck,Trophy} from 'lucide-react'
import type {ApiVenue} from '../api'
import {CardTitle,PageHead} from '../ui'
import {ErrorCard,LoadingCard,SourceNote,WriteGatePill,useResource} from './common'

interface WheelPrize {
  code:string;title:string;rewardType:string;rewardValue:Record<string,unknown>;probability:string;enabled:boolean;sortOrder:number
}
interface WheelData {
  source:string;editable?:boolean;runtimeCommit?:string;enabled:boolean|null;cooldownMinutes:number|null;retryCost:number|null
  retryCostPolicy?:{firstPaid:number;subsequentPaid:number};prizes:WheelPrize[]
}

const number=(value:unknown)=>Number(value||0)
function wheelReward(prize:WheelPrize){
  if(prize.rewardType==='bonus')return `+${number(prize.rewardValue.amount)} бонусов`
  if(prize.rewardType==='beer_ml')return `${number(prize.rewardValue.amount)/1000} л пива`
  if(prize.code==='annual-beer')return 'Годовой запас пива'
  return prize.title
}

export function PivnikLegacyWheelManager({venue}:{venue:ApiVenue}){
  const path=`/api/admin/venues/${venue.id}/wheel/manage`
  const {data,error,loading,reload}=useResource<WheelData>(path)
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  const total=data.prizes.filter(x=>x.enabled).reduce((sum,x)=>sum+Number(x.probability||0),0)
  const legacy=data.source==='legacy-production-runtime'
  const firstPaid=data.retryCostPolicy?.firstPaid??data.retryCost??0
  const subsequentPaid=data.retryCostPolicy?.subsequentPaid??data.retryCost??0
  return <div className="page">
    <PageHead eyebrow="РАБОЧАЯ КОНФИГУРАЦИЯ" title="Колесо" sub={`${venue.companyName} → ${venue.name}`}
      actions={<WriteGatePill enabled={false}/>}/>
    <div className="wheel-top">
      <section className="card wheel-visual">
        <div className="wheel-ring"><div className="wheel-center"><Gift/><b>ПРИЗЫ</b></div></div>
        <div className="prob-total"><span>Сумма вероятностей</span><strong>{total.toFixed(4).replace(/\.0+$/,'')}%</strong><small>{Math.abs(total-100)<1e-9?'Текущая рабочая таблица':'Требуется проверка'}</small></div>
      </section>
      <section className="card editor-card">
        <CardTitle title="Механика"/>
        <div className="setting-row"><div><b>Колесо включено</b><span>{data.enabled===false?'Нет':'Да'}</span></div><ShieldCheck/></div>
        <div className="kpi-grid compact">
          <div className="kpi"><span>Бесплатный спин</span><strong>{Math.round((data.cooldownMinutes??1440)/60)} ч</strong><small>интервал</small></div>
          <div className="kpi"><span>Первый платный повтор</span><strong>{firstPaid}</strong><small>бонусов</small></div>
          <div className="kpi"><span>Следующие повторы</span><strong>{subsequentPaid}</strong><small>бонусов</small></div>
        </div>
        <SourceNote>{legacy
          ? `Показана фактическая конфигурация текущего runtime ПИВНИКА (${data.runtimeCommit?.slice(0,8)||'production'}). Редактирование намеренно отключено: эта страница пока только читает рабочую механику.`
          : 'Показана сохранённая конфигурация Admin Platform. Редактирование на controlled pilot отключено.'}</SourceNote>
      </section>
    </div>
    <section className="card editor-card">
      <CardTitle title={`Призы · ${data.prizes.length}`}/>
      <div className="prize-list">
        <div className="prize-head"><span>Приз</span><span>Тип</span><span>Награда</span><span>Вероятность</span><span/><span>Статус</span><span/></div>
        {[...data.prizes].sort((a,b)=>a.sortOrder-b.sortOrder).map(prize=><div className="prize-row" key={prize.code}>
          <div className="prize-name"><div className="prize-icon"><Gift/></div><b>{prize.title}</b></div>
          <span>{prize.code}</span><strong>{wheelReward(prize)}</strong><strong>{prize.probability}%</strong><span/>
          <span>{prize.enabled?'Активен':'Выключен'}</span><ShieldCheck/>
        </div>)}
      </div>
    </section>
  </div>
}

interface AchievementItem {
  code:string;title:string;description:string;rarity?:string;legacyMetric?:string;legacyTarget?:number;legacyUnit?:string
  rewardValue?:{bonus?:number;beerMl?:number};enabled:boolean;special?:boolean;recurring?:string|null
}
interface AchievementData {source:string;editable?:boolean;runtimeCommit?:string;items:AchievementItem[]}

function achievementCondition(item:AchievementItem){
  const target=number(item.legacyTarget)
  switch(item.legacyMetric){
    case 'purchaseCount':return `${target} покупок`
    case 'maxCheckCents':return `один чек от ${(target/100).toLocaleString('ru-RU')} ₽`
    case 'paidBeerMl':return `${target/1000} л оплаченного разливного пива`
    case 'redemptionCount':return 'использовать бонусы при покупке'
    case 'shopPurchaseCount':return 'покупка в бонусном магазине'
    case 'totalSpendCents':return `суммарно ${(target/100).toLocaleString('ru-RU')} ₽`
    case 'purchaseDays':return `покупки в ${target} разных дней`
    case 'bonusSpent':return `использовать ${target} бонусов`
    case 'previousMonthWinner':return '1-е место по покупкам за завершившийся месяц'
    case 'ownerIdentity':return 'уникальная награда создателя'
    case 'specialGrant':return 'специальная ручная награда'
    default:return 'условие текущего runtime'
  }
}
function achievementReward(item:AchievementItem){
  const bonus=number(item.rewardValue?.bonus),beer=number(item.rewardValue?.beerMl)
  if(beer)return `${beer/1000} л пива${bonus?` + ${bonus} бонусов`:''}`
  return bonus?`+${bonus} бонусов`:'без бонусной выплаты'
}

export function PivnikLegacyAchievementManager({venue}:{venue:ApiVenue}){
  const path=`/api/admin/venues/${venue.id}/achievements/manage`
  const {data,error,loading,reload}=useResource<AchievementData>(path)
  if(loading&&!data)return <LoadingCard/>
  if(error&&!data)return <ErrorCard error={error} onRetry={reload}/>
  if(!data)return null
  const legacy=data.source==='legacy-production-runtime'
  return <div className="page">
    <PageHead eyebrow="РАБОЧИЙ КАТАЛОГ" title="Достижения" sub={`${venue.companyName} → ${venue.name}`}
      actions={<WriteGatePill enabled={false}/>}/>
    <section className="card editor-card">
      <CardTitle title={`Достижения · ${data.items.length}`}/>
      <SourceNote>{legacy
        ? `Показан текущий production-каталог ПИВНИКА (${data.runtimeCommit?.slice(0,8)||'production'}): автоматические достижения и специальные легендарные награды. Редактирование пока отключено.`
        : 'Показана сохранённая конфигурация Admin Platform. Редактирование на controlled pilot отключено.'}</SourceNote>
      <div className="achievement-config-grid">
        {data.items.map(item=><article className="achievement-config-card" key={item.code}>
          <div className="achievement-config-head"><div className="achievement-icon"><Trophy/></div><div><b>{item.title}</b><span>{item.code}</span></div></div>
          <p>{item.description}</p>
          <div className="achievement-meta">
            <span>{item.rarity||'achievement'}</span>
            <span>{achievementCondition(item)}</span>
            <strong>{achievementReward(item)}</strong>
            {item.recurring&&<span>повторяется: {item.recurring}</span>}
            {item.special&&<span>специальное</span>}
          </div>
        </article>)}
      </div>
    </section>
  </div>
}
