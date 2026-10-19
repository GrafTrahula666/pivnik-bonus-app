import { config } from './config.js'
import { pool } from './db.js'
import { onboardingTargetRegistry } from './onboarding-database-registry.js'
import { createOnboardingProvisioningService } from './onboarding-provisioning.js'
import { requireOnboardingAccess } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal } from './types.js'
import {assembleApprovedRuntimeBundle} from './onboarding-runtime-release.js'
import {crmCheckView,crmActivationSummary} from './tenant-crm-activation-state.js'
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
export async function getCrmActivationCheck(admin:AdminPrincipal,draftId:string){
  await requireCrmActivationCheckAccess(admin)
  return crmCheckView(await provisioning.getCrmActivationCheck(admin,draftId))
}
export async function readCrmActivationSummary(admin:AdminPrincipal,draftId:string){
  await requireOnboardingAccess(admin)
  if(!config.enableTenantCrmActivationChecks)throw new HttpError(403,'CRM_ACTIVATION_CHECK_DISABLED','Проверка запуска CRM пока выключена.')
  return crmActivationSummary(await provisioning.readCrmActivationState(admin,draftId))
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
