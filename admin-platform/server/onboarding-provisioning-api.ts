import { config } from './config.js'
import { pool } from './db.js'
import { onboardingTargetRegistry } from './onboarding-database-registry.js'
import { createOnboardingProvisioningService } from './onboarding-provisioning.js'
import { requireOnboardingAccess } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal } from './types.js'
import {assembleApprovedRuntimeBundle} from './onboarding-runtime-release.js'

const provisioning=createOnboardingProvisioningService({
  metadata:pool,
  resolveTargetDatabase:runtimeKey=>onboardingTargetRegistry.resolveTargetDatabase(runtimeKey),
  assembleRuntimeBundle:assembleApprovedRuntimeBundle,
  requireCodeRelease:true,
  requireImageRelease:true,
})

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
