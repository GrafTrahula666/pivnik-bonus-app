import { config } from './config.js'
import { pool } from './db.js'
import { onboardingTargetRegistry } from './onboarding-database-registry.js'
import { createOnboardingProvisioningService } from './onboarding-provisioning.js'
import { requireOnboardingAccess } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal } from './types.js'
import {assembleApprovedRuntimeBundle} from './onboarding-runtime-release.js'
import {loadOnboardingPosProxyProjection} from './onboarding-pos-proxy.js'

const provisioning=createOnboardingProvisioningService({
  metadata:pool,
  resolveTargetDatabase:runtimeKey=>onboardingTargetRegistry.resolveTargetDatabase(runtimeKey),
  assembleRuntimeBundle:assembleApprovedRuntimeBundle,
  requireCodeRelease:true,
  requireImageRelease:true,
  readCrmProvider:(client,admin,draftId)=>config.enableOnboardingWorkflow&&config.enableOnboardingPosProxy
    ?loadOnboardingPosProxyProjection(client,admin,draftId,true):Promise.resolve(null),
})

async function requireCrmActivationCheckAccess(admin:AdminPrincipal){
  await requireOnboardingAccess(admin,true)
  if(!config.enableTenantCrmActivationChecks)throw new HttpError(403,'CRM_ACTIVATION_CHECK_DISABLED','Проверка запуска CRM пока выключена.')
}
const crmAdvice:Record<string,string>={
  CRM_MARKET_CONTRACT_REQUIRED:'Подписка Эвотор.Маркета ещё не подключена. Установка и оплата не подтверждены; CRM не запущена.',
  CRM_PROVIDER_VERIFICATION_REQUIRED:'Свежая связь с кассой не подтверждена. Отправьте тестовое событие с кассы и повторите проверку связи.',
  TARGET_DATABASE_NOT_REGISTERED:'База заведения ещё не подключена. Завершите подготовку базы в мастере.',
  TARGET_BINDING_CONFLICT:'Привязка базы не совпадает с заведением. Обратитесь в поддержку; данные другой точки использовать нельзя.',
  TARGET_TENANT_SCHEMA_REQUIRED:'Схема клиентской базы не готова. Обратитесь в поддержку для завершения подготовки.',
  TARGET_TENANT_DATA_OWNERSHIP_REQUIRED:'Не удалось подтвердить принадлежность всех данных заведению. Обратитесь в поддержку.',
  TARGET_DATABASE_UNAVAILABLE:'Нет связи с клиентской базой. Проверьте подключение и повторите попытку.',
}
function crmCheckView(operation:Awaited<ReturnType<typeof provisioning.getCrmActivationCheck>>){
  return {schemaVersion:1 as const,scope:operation.scope,operation,
    activationStatus:operation.status==='running'&&!operation.startAllowed?'verifying' as const:
      operation.status==='retryable_error'?'failed' as const:'pending' as const,
    activationAllowed:false as const,crmStatus:'not_provisioned' as const,guestApplicationRequired:false as const,
    nextAction:operation.errorCode?crmAdvice[operation.errorCode]??'Повторите проверку запуска CRM.':
      operation.status==='running'?(operation.startAllowed?'Предыдущая проверка не завершилась. Повторите проверку запуска CRM.':
        'Проверка запуска CRM ещё не завершена. Обновите её состояние.'):
      'Подготовьте клиентскую базу и проверьте возможность запуска CRM.'}
}
export async function getCrmActivationCheck(admin:AdminPrincipal,draftId:string){
  await requireCrmActivationCheckAccess(admin)
  return crmCheckView(await provisioning.getCrmActivationCheck(admin,draftId))
}
export async function runCrmActivationCheck(admin:AdminPrincipal,draftId:string,raw:unknown){
  await requireCrmActivationCheckAccess(admin)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==0)
    throw new HttpError(400,'CRM_ACTIVATION_COMMAND_INVALID','Проверка принимает только пустую команду. Область, подписку и статусы определяет сервер.')
  return crmCheckView(await provisioning.runCrmActivationCheck(admin,draftId))
}

export async function requireOnboardingProvisioningAccess(admin:AdminPrincipal):Promise<void> {
  await requireOnboardingAccess(admin,true)
  if(!config.enableOnboardingProvisioning) {
    throw new HttpError(403,'ONBOARDING_PROVISIONING_DISABLED','Подготовка приложения пока выключена.')
  }
}

export async function getOnboardingRuntimeDatabaseBinding(admin:AdminPrincipal,draftId:string) {
  await requireOnboardingProvisioningAccess(admin)
  return provisioning.getRuntimeDatabaseBinding(admin,draftId)
}

export async function runOnboardingRuntimeDatabaseBinding(admin:AdminPrincipal,draftId:string,raw:unknown) {
  await requireOnboardingProvisioningAccess(admin)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw as Record<string,unknown>).length!==0) {
    throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID',
      'Запуск не принимает URL, ключи или область заведения. Используется защищённая серверная регистрация.')
  }
  return provisioning.runRuntimeDatabaseBinding(admin,draftId)
}

export async function getOnboardingTenantSchemaReadiness(admin:AdminPrincipal,draftId:string) {
  await requireOnboardingProvisioningAccess(admin)
  return provisioning.getTenantSchemaReadiness(admin,draftId)
}

export async function runOnboardingTenantSchemaReadiness(admin:AdminPrincipal,draftId:string,raw:unknown) {
  await requireOnboardingProvisioningAccess(admin)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw as Record<string,unknown>).length!==0) {
    throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID',
      'Запуск не принимает URL, ключи или область заведения. Используется защищённая серверная регистрация.')
  }
  return provisioning.runTenantSchemaReadiness(admin,draftId)
}

export async function getOnboardingRuntimeBundleVerification(admin:AdminPrincipal,draftId:string) {
  await requireOnboardingProvisioningAccess(admin)
  return provisioning.getRuntimeBundleVerification(admin,draftId)
}

export async function runOnboardingRuntimeBundleVerification(admin:AdminPrincipal,draftId:string,raw:unknown) {
  await requireOnboardingProvisioningAccess(admin)
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw as Record<string,unknown>).length!==0) {
    throw new HttpError(400,'ONBOARDING_PROVISIONING_COMMAND_INVALID',
      'Запуск не принимает manifest, artifact, URL или область заведения. Используется сохранённая серверная конфигурация.')
  }
  return provisioning.runRuntimeBundleVerification(admin,draftId)
}
