import type {createOnboardingProvisioningService} from './onboarding-provisioning.js'

type CrmOperation=Awaited<ReturnType<ReturnType<typeof createOnboardingProvisioningService>['getCrmActivationCheck']>>

const crmAdvice:Record<string,string>={
  CRM_MARKET_CONTRACT_REQUIRED:'Подписка Эвотор.Маркета ещё не подключена. Установка и оплата не подтверждены; CRM не запущена.',
  CRM_PROVIDER_VERIFICATION_REQUIRED:'Свежая связь с кассой не подтверждена. Отправьте тестовое событие с кассы и повторите проверку связи.',
  TARGET_DATABASE_NOT_REGISTERED:'База заведения ещё не подключена. Завершите подготовку базы в мастере.',
  TARGET_BINDING_CONFLICT:'Привязка базы не совпадает с заведением. Обратитесь в поддержку; данные другой точки использовать нельзя.',
  TARGET_TENANT_SCHEMA_REQUIRED:'Схема клиентской базы не готова. Обратитесь в поддержку для завершения подготовки.',
  TARGET_TENANT_DATA_OWNERSHIP_REQUIRED:'Не удалось подтвердить принадлежность всех данных заведению. Обратитесь в поддержку.',
  TARGET_DATABASE_UNAVAILABLE:'Нет связи с клиентской базой. Проверьте подключение и повторите попытку.',
}
export function crmCheckView<Operation extends CrmOperation>(operation:Operation){
  return {schemaVersion:1 as const,scope:operation.scope,operation,
    activationStatus:operation.status==='running'&&!operation.startAllowed?'verifying' as const:
      operation.status==='retryable_error'?'failed' as const:'pending' as const,
    activationAllowed:false as const,crmStatus:'not_provisioned' as const,guestApplicationRequired:false as const,
    nextAction:operation.errorCode?crmAdvice[operation.errorCode]??'Повторите проверку запуска CRM.':
      operation.status==='running'?(operation.startAllowed?'Предыдущая проверка не завершилась. Повторите проверку запуска CRM.':
        'Проверка запуска CRM ещё не завершена. Обновите её состояние.'):
      'Подготовьте клиентскую базу и проверьте возможность запуска CRM.'}
}

export function crmActivationSummary(operation:CrmOperation){
  const check=crmCheckView(operation)
  return {schemaVersion:1 as const,draftId:operation.draftId,scope:operation.scope,
    status:operation.status==='not_started'?'not_configured' as const:
      operation.status==='running'&&operation.startAllowed?'degraded' as const:check.activationStatus,
    code:operation.errorCode??(operation.status==='not_started'?'CRM_ACTIVATION_CHECK_NOT_STARTED':
      operation.status==='running'?(operation.startAllowed?'CRM_ACTIVATION_CHECK_EXPIRED':'CRM_ACTIVATION_CHECK_RUNNING'):'CRM_ACTIVATION_CHECK_PENDING'),
    nextAction:check.nextAction,attemptCount:operation.attemptCount,updatedAt:operation.updatedAt,
    evidence:operation.status==='not_started'?'not_checked' as const:'saved_activation_check' as const,
    crmStatus:check.crmStatus,activationAllowed:check.activationAllowed,guestApplicationRequired:check.guestApplicationRequired}
}

export function unavailableCrmActivationSummary(draftId:string,scope:{companyId:string|null;venueId:string|null},unprepared=false){
  return {schemaVersion:1 as const,draftId,scope,
    status:unprepared?'not_configured' as const:'degraded' as const,
    code:unprepared?'CRM_SCOPE_REQUIRED':'CRM_ACTIVATION_STATE_UNAVAILABLE',
    nextAction:unprepared?'Подготовьте заведение и клиентскую базу в мастере.':
      'Не удалось подтвердить состояние запуска CRM. Откройте мастер и обновите проверку.',
    attemptCount:null,updatedAt:null,evidence:unprepared?'not_checked' as const:'unavailable' as const,
    crmStatus:'not_provisioned' as const,activationAllowed:false as const,guestApplicationRequired:false as const}
}
