import type {OnboardingPosProxyView} from './onboarding-pos-proxy.js'
import {POS_EVENT_FRESH_MS} from '../../pos/onboarding-proxy.js'

// A saved provider check is evidence of that check, never a new live probe.
// Activation remains blocked until an actual Market adapter and activation
// operation exist. A database count of zero does not change these requirements.
export function tenantCrmReadiness(total:string,provider:OnboardingPosProxyView|null,now=Date.now()){
  const checkedAt=new Date(now).toISOString()
  let providerStatus=provider?.status??'not_configured'
  let providerCode=provider?.code??'provider_verifier_disabled'
  const advice:Record<string,string>={
    not_configured:'Добавьте кассу и её ключ в настройках подключения.',
    not_verified:'Отправьте тестовое событие с кассы и нажмите «Проверить связь».',
    proxy_not_registered:'Серверная связь с кассой ещё не настроена. Завершите подключение.',
    device_key_rejected:'Ключ кассы недействителен или отозван. Получите новый ключ в настройках подключения и повторите проверку.',
    proxy_response_invalid:'Ответ сервиса кассы не прошёл проверку. Проверьте выбранную точку и повторите подключение.',
    configuration_changed:'Выбрана другая точка или касса. Сохраните настройку подключения заново.',
  }
  let nextAction=(provider?advice[provider.code]??provider.nextAction:null)??'Проверка кассы в этом контуре ещё не включена.'
  if(!['not_configured','pending','verifying','active','degraded','suspended','failed'].includes(providerStatus)){
    providerStatus='failed';providerCode='provider_evidence_invalid'
    nextAction='Состояние проверки кассы не подтверждено. Повторите проверку связи.'
  }
  if(providerStatus==='active'){
    const timestamps=[provider?.checkedAt,provider?.lastDeviceActivityAt].map(value=>value?Date.parse(value):NaN)
    const report=provider?.report
    const reportAvailable=report?.state==='available'&&typeof report.empty==='boolean'&&
      typeof report.netCents==='string'&&/^-?\d+$/.test(report.netCents)&&
      typeof report.receiptCount==='number'&&Number.isSafeInteger(report.receiptCount)&&report.receiptCount>=0&&
      report.period&&Number.isFinite(Date.parse(report.period.from))&&Number.isFinite(Date.parse(report.period.until))&&
      Date.parse(report.period.from)<Date.parse(report.period.until)
    if(providerCode!=='confirmed'||!reportAvailable||timestamps.some(value=>!Number.isFinite(value)||now-value>POS_EVENT_FRESH_MS||value-now>5_000)){
      providerStatus='degraded';providerCode='provider_evidence_stale'
      nextAction='Свежая связь с кассой не подтверждена. Отправьте тестовое событие с кассы и повторите проверку связи.'
    }else nextAction='Последняя серверная проверка подтвердила кассу и получение документов. Перед запуском повторите проверку связи.'
  }
  const checks=[
    {id:'customer_data' as const,status:'active' as const,code:'customer_source_verified',checkedAt,
      nextAction:'Доступ к клиентской базе подтверждён.',customerCount:total,
      dataState:total==='0'?'empty' as const:'available' as const},
    {id:'provider' as const,status:providerStatus,code:providerCode,checkedAt:provider?.checkedAt??null,nextAction,
      evidence:'last_saved_verification' as const},
    {id:'subscription' as const,status:'not_configured' as const,code:'market_contract_not_configured',checkedAt:null,
      nextAction:'Подписка Эвотор.Маркета ещё не подключена. Подтверждение установки и оплаты пока недоступно.'},
    {id:'activation' as const,status:'pending' as const,code:'crm_activation_pending',checkedAt:null,
      nextAction:'Запуск CRM ожидает подтверждения подписки, связи с кассой и серверной активации.'},
  ]
  const status=checks.some(check=>check.status==='failed')?'failed' as const:
    checks.some(check=>check.status==='degraded')?'degraded' as const:
    checks.some(check=>check.status==='verifying')?'verifying' as const:'pending' as const
  return {checkedAt,status,activationAllowed:false as const,crmStatus:'not_provisioned' as const,
    guestApplicationRequired:false as const,checks}
}
