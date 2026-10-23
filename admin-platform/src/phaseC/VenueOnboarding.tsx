import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, Check, Copy, Database, Link2, MapPinned, Plus, RefreshCw, Save, ShieldCheck, Smartphone, XCircle } from 'lucide-react'
import { ApiError, apiDelete, apiGet, apiPost, apiPut, type AdminSession } from '../api'
import './venue-onboarding.css'
import { OnboardingProgress } from './OnboardingProgress'
import { OnboardingPosProxy } from './OnboardingPosProxy'
import { TenantCustomerDirectory } from './TenantCustomerDirectory'
import {OnboardingSupport} from './OnboardingSupport'
import { TenantCrmReadiness } from './TenantCrmReadiness'
import { TenantCrmActivationCheck } from './TenantCrmActivationCheck'

export interface OnboardingData {
  companyId: string | null
  companyName: string
  venueName: string
  address: string
  timeZone: string
  venueType: 'bar' | 'cafe' | 'restaurant' | 'shop' | 'other'
  ownerEmail: string
}
interface Draft {
  id: string
  requestKey: string
  data: OnboardingData
  status: 'draft'
  revision: number
  updatedAt: string
  permissions?:{canWrite:boolean;role:string}
}
interface Index {drafts: Draft[]; companies: {id:string;name:string}[]}
type Command = {id:string;revision:number;data:OnboardingData} | {requestKey:string;data:OnboardingData}
interface ApplicationConfig {
  displayName:string
  theme:'premium-dark'|'dark'|'light'
  primaryColor:string
  secondaryColor:string
  shopEnabled:boolean
  loyaltyEnabled:boolean
}
interface ApplicationContract {
  template:'standard'
  qrEnabled:true
  isolationPolicy:'dedicated_database'
  legacyDataAccess:false
  runtimeStatus:'not_provisioned'
  published:false
}
interface Application {
  draftId:string
  tenantKey:string
  config:ApplicationConfig
  revision:number
  updatedAt:string
  contract:ApplicationContract
}
type ApplicationCommand={revision:number;config:ApplicationConfig}
interface ScopeContract {
  status:'prepared'
  venueActive:false
  runtimeStatus:'not_provisioned'
  staffAccessGranted:false
  providerConnectionsCreated:false
}
interface PreparedScope {
  draftId:string
  company:{id:string;code:string;createdByOnboarding:boolean;active:boolean}
  venue:{id:string;code:string;active:false}
  source:{draftRevision:number;applicationRevision:number}
  revision:1
  updatedAt:string
  contract:ScopeContract
}
type ScopeCommand={draftRevision:number;applicationRevision?:number}
type IntegrationStatus='configured'|'verified'|'action_required'|'error'
interface IntegrationContract {
  provider:'evotor'
  credentialStorage:'server_encrypted'
  credentialExposure:'masked_only'
  verificationMethod:'documents_read'
  externalAccountCreated:false
  posBindingCreated:false
  runtimeStatus:'not_provisioned'
}
interface Integration {
  draftId:string
  provider:'evotor'
  storeId:string
  credential:{present:true;masked:'••••••••'}
  status:IntegrationStatus
  verification:{code:string;checkedAt:string|null;verifiedAt:string|null;nextAction:string}
  revision:number
  updatedAt:string
  contract:IntegrationContract
}
type IntegrationCommand={requestKey:string;revision:number;storeId:string;token:string}
interface Invite {id:string;draftId:string;status:'pending'|'revoked'|'claimed';expiresAt:string;createdAt:string;revokedAt:string|null;claimedAt:string|null}
type ProvisioningStatus='not_started'|'running'|'retryable_error'|'action_required'|'succeeded'
type ProvisioningErrorCode='TARGET_DATABASE_NOT_REGISTERED'|'TARGET_BINDING_SCHEMA_REQUIRED'|'TARGET_BINDING_CONFLICT'|'TARGET_DATABASE_UNAVAILABLE'|'TARGET_CONFIRMATION_UNCERTAIN'
type SchemaReadinessErrorCode='TARGET_DATABASE_NOT_REGISTERED'|'TARGET_BINDING_CONFLICT'|'TARGET_DATABASE_UNAVAILABLE'|'TARGET_TENANT_SCHEMA_REQUIRED'|'TARGET_TENANT_DATA_OWNERSHIP_REQUIRED'
type RuntimeBundleErrorCode='RUNTIME_ARTIFACT_INCOMPATIBLE'|'RUNTIME_RELEASE_NOT_REGISTERED'|'RUNTIME_RELEASE_INVALID'|'RUNTIME_RELEASE_UNAVAILABLE'|'RUNTIME_RELEASE_MISMATCH'|'RUNTIME_IMAGE_NOT_REGISTERED'|'RUNTIME_IMAGE_MISMATCH'|'RUNTIME_IMAGE_CONTRACT_INVALID'
interface ProvisioningStep {
  draftId:string
  step:'runtime_database_binding'
  runtimeKey:string
  manifestSha256:string
  applicationRevision:number
  scope:{companyId:string;venueId:string}
  status:ProvisioningStatus
  attemptCount:number
  errorCode:ProvisioningErrorCode|null
  result:{binding:'created'|'verified_existing'}|null
  updatedAt:string|null
  startAllowed:boolean
}
interface SchemaReadinessStep {
  draftId:string
  step:'tenant_schema_readiness'
  runtimeKey:string
  manifestSha256:string
  applicationRevision:number
  scope:{companyId:string;venueId:string}
  status:ProvisioningStatus
  attemptCount:number
  errorCode:SchemaReadinessErrorCode|null
  result:{schema:'verified';migrationSet:'009,017-020';ownershipBoundary:'verified'}|null
  updatedAt:string|null
  startAllowed:boolean
}
interface RuntimeBundleStep {
  draftId:string
  step:'runtime_bundle_verification'
  runtimeKey:string
  manifestSha256:string
  applicationRevision:number
  scope:{companyId:string;venueId:string}
  status:ProvisioningStatus
  attemptCount:number
  errorCode:RuntimeBundleErrorCode|null
  result:{
    bundle:'verified'
    artifact:'pivnik-bonus-app'
    artifactContract:'tenant-runtime-v1'
    bundleSha256:string
    manifestSchemaVersion:2
    runtimeStatus:'not_provisioned'
    codeRelease?:{sourceSha:string;fingerprint:string;coverage:'node_literal_import_closure';moduleCount:number}
    imageRelease?:{imageId:string;platform:'linux/amd64';contract:'tenant-runtime-v1'}
    published:false
  }|null
  updatedAt:string|null
  startAllowed:boolean
}
const base = '/api/admin/onboarding/drafts'
const empty = ():OnboardingData=>({companyId:null,companyName:'',venueName:'',address:'',timeZone:'Europe/Moscow',venueType:'bar',ownerEmail:''})
const defaultContract:ApplicationContract={template:'standard',qrEnabled:true,isolationPolicy:'dedicated_database',legacyDataAccess:false,runtimeStatus:'not_provisioned',published:false}
const defaultIntegrationContract:IntegrationContract={provider:'evotor',credentialStorage:'server_encrypted',credentialExposure:'masked_only',verificationMethod:'documents_read',externalAccountCreated:false,posBindingCreated:false,runtimeStatus:'not_provisioned'}
const emptyApplication=(displayName=''):ApplicationConfig=>({displayName,theme:'premium-dark',primaryColor:'#46d8e2',secondaryColor:'#173336',shopEnabled:true,loyaltyEnabled:true})
const message = (error:unknown)=>error instanceof Error?error.message:'Не удалось загрузить черновики.'

// A damaged successful response is uncertain, never a reason to create a new request key.
function draftResponse(raw: unknown): Draft {
  const draft=raw as Partial<Draft>|null
  if(!draft||typeof draft.id!=='string'||typeof draft.requestKey!=='string'||draft.status!=='draft'||
    !Number.isInteger(draft.revision)||Number(draft.revision)<1||!draft.data||
    typeof draft.updatedAt!=='string'||!['companyName','venueName','address','timeZone','venueType','ownerEmail'].every(key=>typeof (draft.data as unknown as Record<string,unknown>)[key]==='string')) {
    throw new Error('Результат сохранения не подтверждён. Повторите сохранение или откройте список черновиков.')
  }
  return draft as Draft
}
function contractResponse(raw:unknown):ApplicationContract {
  const value=raw as Partial<ApplicationContract>|null
  if(!value||value.template!=='standard'||value.qrEnabled!==true||value.isolationPolicy!=='dedicated_database'||
    value.legacyDataAccess!==false||value.runtimeStatus!=='not_provisioned'||value.published!==false) {
    throw new Error('Статус приложения не подтверждён. Откройте сохранённую конфигурацию.')
  }
  return value as ApplicationContract
}
function applicationResponse(raw:unknown):Application {
  const value=raw as Partial<Application>|null,config=value?.config as Partial<ApplicationConfig>|undefined
  if(!value||typeof value.draftId!=='string'||typeof value.tenantKey!=='string'||!/^sv-[0-9a-f]{32}$/.test(value.tenantKey)||
    !Number.isInteger(value.revision)||Number(value.revision)<1||typeof value.updatedAt!=='string'||!config||
    typeof config.displayName!=='string'||!['premium-dark','dark','light'].includes(String(config.theme))||
    !/^#[0-9a-f]{6}$/.test(String(config.primaryColor))||!/^#[0-9a-f]{6}$/.test(String(config.secondaryColor))||
    typeof config.shopEnabled!=='boolean'||typeof config.loyaltyEnabled!=='boolean') {
    throw new Error('Результат настройки приложения не подтверждён. Откройте сохранённую конфигурацию.')
  }
  return {...value,contract:contractResponse(value.contract)} as Application
}
function scopeContractResponse(raw:unknown):ScopeContract {
  const value=raw as Partial<ScopeContract>|null
  if(!value||value.status!=='prepared'||value.venueActive!==false||value.runtimeStatus!=='not_provisioned'||
    value.staffAccessGranted!==false||value.providerConnectionsCreated!==false) {
    throw new Error('Статус области заведения не подтверждён. Откройте сохранённую область.')
  }
  return value as ScopeContract
}
function scopeResponse(raw:unknown):PreparedScope {
  const value=raw as Partial<PreparedScope>|null,company=value?.company,venue=value?.venue,source=value?.source
  if(!value||typeof value.draftId!=='string'||!company||!venue||!source||
    !/^[1-9]\d*$/.test(String(company.id))||typeof company.code!=='string'||typeof company.createdByOnboarding!=='boolean'||typeof company.active!=='boolean'||
    (company.createdByOnboarding&&company.active)||!/^[1-9]\d*$/.test(String(venue.id))||typeof venue.code!=='string'||venue.active!==false||
    !Number.isInteger(source.draftRevision)||Number(source.draftRevision)<1||!Number.isInteger(source.applicationRevision)||Number(source.applicationRevision)<1||
    value.revision!==1||typeof value.updatedAt!=='string') {
    throw new Error('Подготовленная область заведения не подтверждена. Откройте её повторно.')
  }
  return {...value,contract:scopeContractResponse(value.contract)} as PreparedScope
}

function integrationContractResponse(raw:unknown):IntegrationContract {
  const value=raw as Partial<IntegrationContract>|null
  const allowed=['provider','credentialStorage','credentialExposure','verificationMethod','externalAccountCreated','posBindingCreated','runtimeStatus']
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||value.provider!=='evotor'||value.credentialStorage!=='server_encrypted'||
    value.credentialExposure!=='masked_only'||value.verificationMethod!=='documents_read'||value.externalAccountCreated!==false||
    value.posBindingCreated!==false||value.runtimeStatus!=='not_provisioned') {
    throw new Error('Статус защищённого подключения не подтверждён. Откройте настройку повторно.')
  }
  return value as IntegrationContract
}
function integrationResponse(raw:unknown):Integration {
  const value=raw as Partial<Integration>|null,credential=value?.credential,verification=value?.verification
  const allowed=['draftId','provider','storeId','credential','status','verification','revision','updatedAt','contract']
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||typeof value.draftId!=='string'||value.provider!=='evotor'||
    typeof value.storeId!=='string'||!value.storeId||!credential||Object.keys(credential).some(key=>!['present','masked'].includes(key))||
    credential.present!==true||credential.masked!=='••••••••'||!['configured','verified','action_required','error'].includes(String(value.status))||
    !verification||Object.keys(verification).some(key=>!['code','checkedAt','verifiedAt','nextAction'].includes(key))||
    typeof verification.code!=='string'||!/^[a-z0-9_]{1,64}$/.test(verification.code)||typeof verification.nextAction!=='string'||
    !(verification.checkedAt===null||typeof verification.checkedAt==='string')||!(verification.verifiedAt===null||typeof verification.verifiedAt==='string')||
    !Number.isInteger(value.revision)||Number(value.revision)<1||typeof value.updatedAt!=='string') {
    throw new Error('Результат подключения Эвотора не подтверждён. Откройте сохранённую настройку.')
  }
  if((value.status==='configured'&&(verification.code!=='not_verified'||verification.checkedAt!==null||verification.verifiedAt!==null))||
    (value.status==='verified'&&(verification.code!=='documents_readable'||typeof verification.checkedAt!=='string'||typeof verification.verifiedAt!=='string'))||
    (['action_required','error'].includes(String(value.status))&&typeof verification.checkedAt!=='string')) {
    throw new Error('Состояние проверки Эвотора противоречиво. Откройте сохранённую настройку.')
  }
  return {...value,contract:integrationContractResponse(value.contract)} as Integration
}
const integrationStatusLabel=(integration:Integration|null)=>!integration?'Не настроено':integration.status==='configured'?'Настроено · не проверено':
  integration.status==='verified'?'Проверено':integration.status==='action_required'?'Нужно действие':'Ошибка проверки'

function inviteResponse(raw:unknown):Invite {
  const value=raw as Partial<Invite>|null
  if(!value||typeof value.id!=='string'||typeof value.draftId!=='string'||!['pending','revoked','claimed'].includes(String(value.status))||
    typeof value.expiresAt!=='string'||typeof value.createdAt!=='string'||!(value.revokedAt===null||typeof value.revokedAt==='string')||
    !(value.claimedAt===null||typeof value.claimedAt==='string')) {
    throw new Error('Приглашение не подтверждено. Обновите список приглашений.')
  }
  return value as Invite
}

const provisioningErrors:ProvisioningErrorCode[]=[
  'TARGET_DATABASE_NOT_REGISTERED','TARGET_BINDING_SCHEMA_REQUIRED','TARGET_BINDING_CONFLICT',
  'TARGET_DATABASE_UNAVAILABLE','TARGET_CONFIRMATION_UNCERTAIN',
]
function provisioningResponse(raw:unknown):ProvisioningStep {
  const value=raw as Partial<ProvisioningStep>|null,scope=value?.scope,result=value?.result
  const allowed=['draftId','step','runtimeKey','manifestSha256','applicationRevision','scope','status','attemptCount','errorCode','result','updatedAt','startAllowed']
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||typeof value.draftId!=='string'||value.step!=='runtime_database_binding'||
    !/^sv-[0-9a-f]{32}$/.test(String(value.runtimeKey))||!/^[0-9a-f]{64}$/.test(String(value.manifestSha256))||
    !Number.isSafeInteger(value.applicationRevision)||Number(value.applicationRevision)<1||!scope||Object.keys(scope).some(key=>!['companyId','venueId'].includes(key))||
    typeof scope.companyId!=='string'||typeof scope.venueId!=='string'||!/^[1-9]\d*$/.test(scope.companyId)||!/^[1-9]\d*$/.test(scope.venueId)||
    !['not_started','running','retryable_error','action_required','succeeded'].includes(String(value.status))||
    !Number.isSafeInteger(value.attemptCount)||Number(value.attemptCount)<0||typeof value.startAllowed!=='boolean'||
    !(value.updatedAt===null||typeof value.updatedAt==='string')||!(value.errorCode===null||provisioningErrors.includes(value.errorCode as ProvisioningErrorCode))||
    !(result===null||(result&&Object.keys(result).length===1&&['created','verified_existing'].includes(String(result.binding))))) {
    throw new Error('Состояние подготовки базы не подтверждено. Обновите его с сервера.')
  }
  const noOutcome=value.errorCode===null&&result===null
  if((value.status==='not_started'&&(value.attemptCount!==0||value.updatedAt!==null||!value.startAllowed||!noOutcome))||
    (value.status==='running'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!noOutcome))||
    (['retryable_error','action_required'].includes(String(value.status))&&
      (Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!value.errorCode||result!==null||!value.startAllowed))||
    (value.status==='succeeded'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||value.errorCode!==null||!result||value.startAllowed))) {
    throw new Error('Состояние подготовки базы противоречиво. Обновите его с сервера.')
  }
  return value as ProvisioningStep
}
const provisioningStatusLabel=(value:ProvisioningStep)=>value.status==='not_started'?'Ожидает запуска':
  value.status==='running'?(value.startAllowed?'Можно продолжить':'Проверяем'):
  value.status==='retryable_error'?'Ошибка проверки':value.status==='action_required'?'Нужно действие':'Привязка подготовлена'
const provisioningGuidance=(value:ProvisioningStep)=>{
  if(value.status==='not_started')return 'Запуск ещё не выполнялся. Целевая база выбирается только по защищённой серверной регистрации.'
  if(value.status==='running')return value.startAllowed?'Срок предыдущей попытки истёк. Можно безопасно продолжить тот же шаг.':'Сервер выполняет проверку. Повторный запуск заблокирован, пока действует серверная блокировка.'
  if(value.status==='succeeded')return value.result?.binding==='verified_existing'?'Существующая точная привязка повторно подтверждена.':'Точная привязка создана в выделенной базе.'
  const actions:Record<ProvisioningErrorCode,string>={
    TARGET_DATABASE_NOT_REGISTERED:'Администратору инфраструктуры нужно зарегистрировать выделенную базу для этой точки. URL в браузере не вводится.',
    TARGET_BINDING_SCHEMA_REQUIRED:'В выделенной базе нужно вручную применить миграции 017 и 018, затем повторить шаг.',
    TARGET_BINDING_CONFLICT:'Выделенная база уже связана с другой областью. Не перезаписывайте привязку — проверьте защищённый реестр.',
    TARGET_DATABASE_UNAVAILABLE:'Выделенная база недоступна. Проверьте серверную регистрацию и повторите после восстановления.',
    TARGET_CONFIRMATION_UNCERTAIN:'Запись могла сохраниться. Повтор безопасно сверит ту же привязку без создания дубля.',
  }
  return actions[value.errorCode!]
}
const schemaReadinessErrors:SchemaReadinessErrorCode[]=[
  'TARGET_DATABASE_NOT_REGISTERED','TARGET_BINDING_CONFLICT','TARGET_DATABASE_UNAVAILABLE',
  'TARGET_TENANT_SCHEMA_REQUIRED','TARGET_TENANT_DATA_OWNERSHIP_REQUIRED',
]
function schemaReadinessResponse(raw:unknown):SchemaReadinessStep {
  const value=raw as Partial<SchemaReadinessStep>|null,scope=value?.scope,result=value?.result
  const allowed=['draftId','step','runtimeKey','manifestSha256','applicationRevision','scope','status','attemptCount','errorCode','result','updatedAt','startAllowed']
  const validResult=result!==null&&Boolean(result)&&Object.keys(result!).length===3&&result?.schema==='verified'&&
    result.migrationSet==='009,017-020'&&result.ownershipBoundary==='verified'
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||typeof value.draftId!=='string'||value.step!=='tenant_schema_readiness'||
    !/^sv-[0-9a-f]{32}$/.test(String(value.runtimeKey))||!/^[0-9a-f]{64}$/.test(String(value.manifestSha256))||
    !Number.isSafeInteger(value.applicationRevision)||Number(value.applicationRevision)<1||!scope||Object.keys(scope).some(key=>!['companyId','venueId'].includes(key))||
    typeof scope.companyId!=='string'||typeof scope.venueId!=='string'||!/^[1-9]\d*$/.test(scope.companyId)||!/^[1-9]\d*$/.test(scope.venueId)||
    !['not_started','running','retryable_error','action_required','succeeded'].includes(String(value.status))||
    !Number.isSafeInteger(value.attemptCount)||Number(value.attemptCount)<0||typeof value.startAllowed!=='boolean'||
    !(value.updatedAt===null||typeof value.updatedAt==='string')||!(value.errorCode===null||schemaReadinessErrors.includes(value.errorCode as SchemaReadinessErrorCode))||
    !(result===null||validResult)) {
    throw new Error('Состояние проверки схемы не подтверждено. Обновите его с сервера.')
  }
  const noOutcome=value.errorCode===null&&result===null
  if((value.status==='not_started'&&(value.attemptCount!==0||value.updatedAt!==null||!value.startAllowed||!noOutcome))||
    (value.status==='running'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!noOutcome))||
    (['retryable_error','action_required'].includes(String(value.status))&&
      (Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!value.errorCode||result!==null||!value.startAllowed))||
    (value.status==='succeeded'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||value.errorCode!==null||!validResult||value.startAllowed))) {
    throw new Error('Состояние проверки схемы противоречиво. Обновите его с сервера.')
  }
  return value as SchemaReadinessStep
}
const schemaReadinessStatusLabel=(value:SchemaReadinessStep)=>value.status==='not_started'?'Ожидает проверки':
  value.status==='running'?(value.startAllowed?'Можно продолжить':'Проверяем'):
  value.status==='retryable_error'?'Ошибка проверки':value.status==='action_required'?'Нужно действие':'Схема проверена'
const schemaReadinessGuidance=(value:SchemaReadinessStep)=>{
  if(value.status==='not_started')return 'Проверка ещё не выполнялась. Сервер прочитает только структуру и ownership-границы выделенной базы.'
  if(value.status==='running')return value.startAllowed?'Срок предыдущей попытки истёк. Можно безопасно продолжить ту же проверку.':'Сервер выполняет read-only проверку. Повторный запуск временно заблокирован.'
  if(value.status==='succeeded')return 'Схема и ownership-границы проверены. Приложение всё ещё не запущено и не опубликовано.'
  const actions:Record<SchemaReadinessErrorCode,string>={
    TARGET_DATABASE_NOT_REGISTERED:'Защищённая регистрация выделенной базы больше недоступна. URL в браузере не вводится.',
    TARGET_BINDING_CONFLICT:'Привязка базы больше не совпадает с сохранённой областью. Не перезаписывайте её — проверьте защищённый реестр.',
    TARGET_DATABASE_UNAVAILABLE:'Выделенная база недоступна. После восстановления повторите read-only проверку.',
    TARGET_TENANT_SCHEMA_REQUIRED:'Нужно вручную подготовить базовую схему и миграции 009, 017–020, затем повторить проверку. Мастер миграции не применяет.',
    TARGET_TENANT_DATA_OWNERSHIP_REQUIRED:'Обнаружены исторические или чужие данные без точного ownership. Не подключайте эту базу: подготовьте чистую выделенную базу либо отдельно докажите принадлежность данных.',
  }
  return actions[value.errorCode!]
}
function runtimeBundleResponse(raw:unknown):RuntimeBundleStep {
  const value=raw as Partial<RuntimeBundleStep>|null,scope=value?.scope,result=value?.result
  const allowed=['draftId','step','runtimeKey','manifestSha256','applicationRevision','scope','status','attemptCount','errorCode','result','updatedAt','startAllowed']
  const codeRelease=result?.codeRelease
  const imageRelease=result?.imageRelease
  const validImage=!imageRelease||(Boolean(codeRelease)&&Object.keys(imageRelease).length===3
    &&/^sha256:[0-9a-f]{64}$/.test(imageRelease.imageId)&&imageRelease.platform==='linux/amd64'&&imageRelease.contract==='tenant-runtime-v1')
  const validRelease=!codeRelease||(Object.keys(codeRelease).length===4&&/^[0-9a-f]{40}$/.test(codeRelease.sourceSha)
    &&/^[0-9a-f]{64}$/.test(codeRelease.fingerprint)&&codeRelease.coverage==='node_literal_import_closure'
    &&Number.isSafeInteger(codeRelease.moduleCount)&&codeRelease.moduleCount>=5&&codeRelease.moduleCount<=200)
  const validResult=result!==null&&Boolean(result)&&Object.keys(result!).length===7+Number(Boolean(codeRelease))+Number(Boolean(imageRelease))&&validRelease&&validImage&&result?.bundle==='verified'&&
    result.artifact==='pivnik-bonus-app'&&result.artifactContract==='tenant-runtime-v1'&&
    /^[0-9a-f]{64}$/.test(String(result.bundleSha256))&&result.manifestSchemaVersion===2&&
    result.runtimeStatus==='not_provisioned'&&result.published===false
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||typeof value.draftId!=='string'||value.step!=='runtime_bundle_verification'||
    !/^sv-[0-9a-f]{32}$/.test(String(value.runtimeKey))||!/^[0-9a-f]{64}$/.test(String(value.manifestSha256))||
    !Number.isSafeInteger(value.applicationRevision)||Number(value.applicationRevision)<1||!scope||Object.keys(scope).some(key=>!['companyId','venueId'].includes(key))||
    typeof scope.companyId!=='string'||typeof scope.venueId!=='string'||!/^[1-9]\d*$/.test(scope.companyId)||!/^[1-9]\d*$/.test(scope.venueId)||
    !['not_started','running','retryable_error','action_required','succeeded'].includes(String(value.status))||
    !Number.isSafeInteger(value.attemptCount)||Number(value.attemptCount)<0||typeof value.startAllowed!=='boolean'||
    !(value.updatedAt===null||typeof value.updatedAt==='string')||!(value.errorCode===null||['RUNTIME_ARTIFACT_INCOMPATIBLE','RUNTIME_RELEASE_NOT_REGISTERED','RUNTIME_RELEASE_INVALID','RUNTIME_RELEASE_UNAVAILABLE','RUNTIME_RELEASE_MISMATCH','RUNTIME_IMAGE_NOT_REGISTERED','RUNTIME_IMAGE_MISMATCH','RUNTIME_IMAGE_CONTRACT_INVALID'].includes(String(value.errorCode)))||
    !(result===null||validResult)) {
    throw new Error('Состояние runtime bundle не подтверждено. Обновите его с сервера.')
  }
  const noOutcome=value.errorCode===null&&result===null
  if((value.status==='not_started'&&(value.attemptCount!==0||value.updatedAt!==null||!value.startAllowed||!noOutcome))||
    (value.status==='running'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!noOutcome))||
    (['retryable_error','action_required'].includes(String(value.status))&&
      (Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||!value.errorCode||result!==null||!value.startAllowed))||
    (value.status==='succeeded'&&(Number(value.attemptCount)<1||typeof value.updatedAt!=='string'||value.errorCode!==null||!validResult||value.startAllowed))) {
    throw new Error('Состояние runtime bundle противоречиво. Обновите его с сервера.')
  }
  return value as RuntimeBundleStep
}
const runtimeBundleStatusLabel=(value:RuntimeBundleStep)=>value.status==='not_started'?'Ожидает сборки':
  value.status==='running'?(value.startAllowed?'Можно продолжить':'Проверяем'):
  value.status==='retryable_error'?'Ошибка проверки':value.status==='action_required'?'Нужно действие':'Bundle проверен'
const runtimeBundleGuidance=(value:RuntimeBundleStep)=>{
  if(value.status==='not_started')return 'Сервер проверит сохранённую конфигурацию, утверждённые файлы и образ приложения.'
  if(value.status==='running')return value.startAllowed?'Срок предыдущей попытки истёк. Можно безопасно повторить сборку.':'Сервер проверяет checksum и совместимость bundle. Повторный запуск временно заблокирован.'
  if(value.status==='succeeded')return value.result?.imageRelease?'Конфигурация, файлы и образ приложения проверены. Приложение ещё не запущено.':value.result?.codeRelease?'Конфигурация и файлы утверждённой версии подтверждены. Образ ещё не подтверждён; приложение не запущено.':'Описание конфигурации проверено. Неизменяемая версия кода пока не подтверждена; приложение не запущено.'
  if(value.errorCode==='RUNTIME_RELEASE_NOT_REGISTERED')return 'Версия приложения ещё не зарегистрирована платформой. Для продолжения нужна утверждённая сборка; запуск остаётся закрыт.'
  if(value.errorCode?.startsWith('RUNTIME_RELEASE_'))return 'Файлы или утверждённая версия приложения не совпадают. Требуется проверить сборку; запуск остаётся закрыт.'
  if(value.errorCode==='RUNTIME_IMAGE_NOT_REGISTERED')return 'Образ приложения ещё не зарегистрирован платформой. Файлы проверены, но для запуска нужен утверждённый образ.'
  if(value.errorCode?.startsWith('RUNTIME_IMAGE_'))return 'Образ приложения не совпадает с утверждённой версией или требованиями запуска. Требуется проверить сборку; запуск остаётся закрыт.'
  return 'Текущий артефакт не подтвердил tenant-runtime-v1. Не запускайте его: требуется совместимая версия существующего приложения.'
}

export function VenueOnboarding({session,initialDraftId,openRequest=0,onChanged}:{session:AdminSession;initialDraftId?:string|null;openRequest?:number;onChanged?:()=>void}) {
  const allowed=(session.admin.role==='SUPER_ADMIN'||session.capabilities.onboardingAccess===true)&&session.capabilities.onboardingDrafts===true
  const crmMode=allowed&&session.capabilities.crmOnboarding===true
  const integrationsAllowed=allowed&&session.capabilities.onboardingIntegrations===true
  const provisioningAllowed=allowed&&session.capabilities.onboardingProvisioning===true&&session.capabilities.onboardingWrite!==false
  const legacyInvitesAllowed=allowed&&session.admin.role==='SUPER_ADMIN'&&!session.capabilities.onboardingInvitations
  const [index,setIndex]=useState<Index>({drafts:[],companies:[]})
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false),[current,setCurrent]=useState<Draft|null>(null)
  const [connectionRefresh,setConnectionRefresh]=useState(0)
  const canWrite=current?.permissions?.canWrite??session.capabilities.onboardingWrite!==false
  const [data,setData]=useState<OnboardingData>(empty)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
  const [application,setApplication]=useState<Application|null>(null),[appData,setAppData]=useState<ApplicationConfig>(emptyApplication)
  const [appContract,setAppContract]=useState<ApplicationContract>(defaultContract)
  const [appLoading,setAppLoading]=useState(false),[appBusy,setAppBusy]=useState(false),[appUncertain,setAppUncertain]=useState(false)
  const [appError,setAppError]=useState(''),[appNotice,setAppNotice]=useState('')
  const [scope,setScope]=useState<PreparedScope|null>(null),[scopeLoading,setScopeLoading]=useState(false),[scopeBusy,setScopeBusy]=useState(false),[scopeUncertain,setScopeUncertain]=useState(false)
  const [scopeError,setScopeError]=useState(''),[scopeNotice,setScopeNotice]=useState('')
  const [integration,setIntegration]=useState<Integration|null>(null),[integrationStoreId,setIntegrationStoreId]=useState(''),[integrationToken,setIntegrationToken]=useState('')
  const [integrationContract,setIntegrationContract]=useState<IntegrationContract>(defaultIntegrationContract)
  const [integrationLoading,setIntegrationLoading]=useState(false),[integrationBusy,setIntegrationBusy]=useState(false),[integrationUncertain,setIntegrationUncertain]=useState(false)
  const [integrationError,setIntegrationError]=useState(''),[integrationNotice,setIntegrationNotice]=useState('')
  const [provisioning,setProvisioning]=useState<ProvisioningStep|null>(null)
  const [provisioningLoading,setProvisioningLoading]=useState(false),[provisioningBusy,setProvisioningBusy]=useState(false),[provisioningUncertain,setProvisioningUncertain]=useState(false)
  const [provisioningError,setProvisioningError]=useState(''),[provisioningNotice,setProvisioningNotice]=useState('')
  const [schemaReadiness,setSchemaReadiness]=useState<SchemaReadinessStep|null>(null)
  const [schemaReadinessLoading,setSchemaReadinessLoading]=useState(false),[schemaReadinessBusy,setSchemaReadinessBusy]=useState(false),[schemaReadinessUncertain,setSchemaReadinessUncertain]=useState(false)
  const [schemaReadinessError,setSchemaReadinessError]=useState(''),[schemaReadinessNotice,setSchemaReadinessNotice]=useState('')
  const [runtimeBundle,setRuntimeBundle]=useState<RuntimeBundleStep|null>(null)
  const [runtimeBundleLoading,setRuntimeBundleLoading]=useState(false),[runtimeBundleBusy,setRuntimeBundleBusy]=useState(false),[runtimeBundleUncertain,setRuntimeBundleUncertain]=useState(false)
  const [runtimeBundleError,setRuntimeBundleError]=useState(''),[runtimeBundleNotice,setRuntimeBundleNotice]=useState('')
  const [invites,setInvites]=useState<Invite[]>([]),[inviteLoading,setInviteLoading]=useState(false),[inviteBusy,setInviteBusy]=useState(false)
  const [inviteError,setInviteError]=useState(''),[inviteToken,setInviteToken]=useState('')
  const [inviteCopied,setInviteCopied]=useState(false)
  const command=useRef<Command|null>(null),appCommand=useRef<ApplicationCommand|null>(null),scopeCommand=useRef<ScopeCommand|null>(null),integrationCommand=useRef<IntegrationCommand|null>(null),createKey=useRef('')
  const busyRef=useRef(false),appBusyRef=useRef(false),scopeBusyRef=useRef(false),integrationBusyRef=useRef(false),provisioningBusyRef=useRef(false),schemaReadinessBusyRef=useRef(false),runtimeBundleBusyRef=useRef(false),inviteBusyRef=useRef(false)
  const sequence=useRef(0),appSequence=useRef(0),scopeSequence=useRef(0),integrationSequence=useRef(0),provisioningSequence=useRef(0),schemaReadinessSequence=useRef(0),runtimeBundleSequence=useRef(0),inviteSequence=useRef(0)
  const checkpoint=`spaceverse:onboarding:create:${session.admin.id}`
  function clearCheckpoint() {
    // An already confirmed server save stays successful even if tab storage becomes unavailable.
    try {sessionStorage.removeItem(checkpoint)} catch { /* recovery UUID is harmless */ }
  }

  const loadApplication=useCallback(async(draft:Draft)=>{
    const run=++appSequence.current
    setAppLoading(true);setAppError('')
    try {
      const result=await apiGet<{application:unknown;contract:unknown}>(base+'/'+draft.id+'/application')
      const contract=contractResponse(result.contract)
      const saved=result.application?applicationResponse(result.application):null
      if(run!==appSequence.current)return
      if(saved&&saved.draftId!==draft.id)throw new Error('Конфигурация относится к другому черновику.')
      setAppContract(contract);setApplication(saved);setAppData(saved?.config||emptyApplication(draft.data.venueName))
      setAppUncertain(false);appCommand.current=null
    } catch(error) {if(run===appSequence.current)setAppError(message(error))}
    finally {if(run===appSequence.current)setAppLoading(false)}
  },[])
  const loadIntegration=useCallback(async(draft:Draft)=>{
    if(!integrationsAllowed)return
    const run=++integrationSequence.current
    setIntegrationLoading(true);setIntegrationError('')
    try {
      const result=await apiGet<{integration:unknown;contract:unknown}>(base+'/'+draft.id+'/integrations/evotor')
      const contract=integrationContractResponse(result.contract)
      const saved=result.integration?integrationResponse(result.integration):null
      if(run!==integrationSequence.current)return
      if(saved&&saved.draftId!==draft.id)throw new Error('Подключение относится к другому черновику.')
      setIntegrationContract(contract);setIntegration(saved);setIntegrationStoreId(saved?.storeId||'');setIntegrationToken('')
      setIntegrationUncertain(false);integrationCommand.current=null
    } catch(error) {if(run===integrationSequence.current)setIntegrationError(message(error))}
    finally {if(run===integrationSequence.current)setIntegrationLoading(false)}
  },[integrationsAllowed])
  const loadInvites=useCallback(async(draft:Draft)=>{
    if(!legacyInvitesAllowed)return
    const run=++inviteSequence.current
    setInviteLoading(true);setInviteError('')
    try {
      const result=await apiGet<{invites:unknown[]}>(base+'/'+draft.id+'/invites')
      if(!Array.isArray(result.invites)) throw new Error('Не удалось прочитать приглашения.')
      const checked=result.invites.map(inviteResponse)
      if(run!==inviteSequence.current)return
      if(checked.some(invite=>invite.draftId!==draft.id))throw new Error('Приглашение относится к другому черновику.')
      setInvites(checked)
    } catch(error) {if(run===inviteSequence.current)setInviteError(message(error))}
    finally {if(run===inviteSequence.current)setInviteLoading(false)}
  },[legacyInvitesAllowed])
  const loadRuntimeBundle=useCallback(async(draft:Draft)=>{
    if(!provisioningAllowed)return
    const run=++runtimeBundleSequence.current
    setRuntimeBundleLoading(true);setRuntimeBundleError('')
    try {
      const saved=runtimeBundleResponse(await apiGet(base+'/'+draft.id+'/provisioning/runtime-bundle'))
      if(run!==runtimeBundleSequence.current)return
      if(saved.draftId!==draft.id)throw new Error('Runtime bundle относится к другому черновику.')
      setRuntimeBundle(saved);setRuntimeBundleUncertain(false)
    } catch(error) {if(run===runtimeBundleSequence.current)setRuntimeBundleError(message(error))}
    finally {if(run===runtimeBundleSequence.current)setRuntimeBundleLoading(false)}
  },[provisioningAllowed])
  const loadSchemaReadiness=useCallback(async(draft:Draft)=>{
    if(!provisioningAllowed)return
    const run=++schemaReadinessSequence.current
    setSchemaReadinessLoading(true);setSchemaReadinessError('')
    try {
      const saved=schemaReadinessResponse(await apiGet(base+'/'+draft.id+'/provisioning/tenant-schema-readiness'))
      if(run!==schemaReadinessSequence.current)return
      if(saved.draftId!==draft.id)throw new Error('Проверка схемы относится к другому черновику.')
      setSchemaReadiness(saved);setSchemaReadinessUncertain(false)
      if(saved.status==='succeeded')void loadRuntimeBundle(draft)
      else {
        runtimeBundleSequence.current++;setRuntimeBundle(null);setRuntimeBundleLoading(false)
        setRuntimeBundleError('');setRuntimeBundleNotice('');setRuntimeBundleUncertain(false)
      }
    } catch(error) {if(run===schemaReadinessSequence.current)setSchemaReadinessError(message(error))}
    finally {if(run===schemaReadinessSequence.current)setSchemaReadinessLoading(false)}
  },[loadRuntimeBundle,provisioningAllowed])
  const loadProvisioning=useCallback(async(draft:Draft)=>{
    if(!provisioningAllowed)return
    const run=++provisioningSequence.current
    setProvisioningLoading(true);setProvisioningError('')
    try {
      const saved=provisioningResponse(await apiGet(base+'/'+draft.id+'/provisioning/runtime-database-binding'))
      if(run!==provisioningSequence.current)return
      if(saved.draftId!==draft.id)throw new Error('Подготовка базы относится к другому черновику.')
      setProvisioning(saved);setProvisioningUncertain(false)
      if(saved.status==='succeeded')void loadSchemaReadiness(draft)
      else {
        schemaReadinessSequence.current++;setSchemaReadiness(null);setSchemaReadinessLoading(false)
        setSchemaReadinessError('');setSchemaReadinessNotice('');setSchemaReadinessUncertain(false)
        runtimeBundleSequence.current++;setRuntimeBundle(null);setRuntimeBundleLoading(false)
        setRuntimeBundleError('');setRuntimeBundleNotice('');setRuntimeBundleUncertain(false)
      }
    } catch(error) {if(run===provisioningSequence.current)setProvisioningError(message(error))}
    finally {if(run===provisioningSequence.current)setProvisioningLoading(false)}
  },[loadSchemaReadiness,provisioningAllowed])
  const loadScope=useCallback(async(draft:Draft)=>{
    const run=++scopeSequence.current
    setScopeLoading(true);setScopeError('')
    try {
      const result=await apiGet<{scope:unknown;contract:unknown}>(base+'/'+draft.id+'/scope')
      scopeContractResponse(result.contract)
      const saved=result.scope?scopeResponse(result.scope):null
      if(run!==scopeSequence.current)return
      if(saved&&saved.draftId!==draft.id)throw new Error('Область относится к другому черновику.')
      setScope(saved);setScopeUncertain(false);scopeCommand.current=null
      if(saved) {void loadInvites(draft);void loadIntegration(draft);void loadProvisioning(draft)}
    } catch(error) {if(run===scopeSequence.current)setScopeError(message(error))}
    finally {if(run===scopeSequence.current)setScopeLoading(false)}
  },[loadIntegration,loadInvites,loadProvisioning])
  const showDraft=useCallback((draft:Draft)=>{
    setCurrent(draft);setData(draft.data);setEditing(true);command.current=null
    setUncertain(false);setError('');setNotice('Черновик сохранён. Заведение ещё не подключено.')
    setApplication(null);setAppData(emptyApplication(draft.data.venueName));setAppContract(defaultContract)
    setAppError('');setAppNotice('');setAppUncertain(false);appCommand.current=null
    setScope(null);setScopeError('');setScopeNotice('');setScopeUncertain(false);scopeCommand.current=null
    setIntegration(null);setIntegrationStoreId('');setIntegrationToken('');setIntegrationContract(defaultIntegrationContract)
    setIntegrationError('');setIntegrationNotice('');setIntegrationUncertain(false);integrationCommand.current=null
    setProvisioning(null);setProvisioningError('');setProvisioningNotice('');setProvisioningUncertain(false)
    setSchemaReadiness(null);setSchemaReadinessError('');setSchemaReadinessNotice('');setSchemaReadinessUncertain(false)
    setRuntimeBundle(null);setRuntimeBundleError('');setRuntimeBundleNotice('');setRuntimeBundleUncertain(false)
    setInvites([]);setInviteError('');setInviteToken('')
    void loadApplication(draft);void loadScope(draft)
  },[loadApplication,loadScope])
  const load=useCallback(async(recover=false)=>{
    const run=++sequence.current
    setLoading(true);setError('')
    try {
      const result=await apiGet<Index>(base)
      if(!Array.isArray(result.drafts)||!Array.isArray(result.companies)) throw new Error('Не удалось прочитать список черновиков.')
      const checked={...result,drafts:result.drafts.map(draftResponse)}
      if(run!==sequence.current) return
      setIndex(checked)
      if(recover&&session.admin.role!=='SUPER_ADMIN'&&checked.drafts.length===1)showDraft(checked.drafts[0]!)
      if(recover) {
        // Only a non-secret request UUID is kept in this tab; names/contacts/keys stay on the server.
        const key=sessionStorage.getItem(checkpoint)
        let saved=checked.drafts.find(draft=>draft.requestKey===key)
        if(key&&!saved) {
          const result=await apiGet<{draft:unknown}>(base+'?requestKey='+encodeURIComponent(key))
          if(run!==sequence.current) return
          if(result.draft) saved=draftResponse(result.draft)
        }
        if(saved) {showDraft(saved);try {sessionStorage.removeItem(checkpoint)} catch { /* server result is authoritative */ }}
        else if(key) setNotice('Предыдущее сохранение ещё не подтверждено. Обновите список перед созданием нового черновика.')
      }
    } catch(error) {if(run===sequence.current)setError(message(error))}
    finally {if(run===sequence.current)setLoading(false)}
  },[checkpoint,showDraft,session.admin.role])

  const invalidateAppLoads=useCallback(()=>{appSequence.current++},[])
  const invalidateIntegrationLoads=useCallback(()=>{integrationSequence.current++},[])
  const invalidateRuntimeBundleLoads=useCallback(()=>{runtimeBundleSequence.current++},[])
  const invalidateSchemaReadinessLoads=useCallback(()=>{schemaReadinessSequence.current++;invalidateRuntimeBundleLoads()},[invalidateRuntimeBundleLoads])
  const invalidateProvisioningLoads=useCallback(()=>{provisioningSequence.current++;invalidateSchemaReadinessLoads()},[invalidateSchemaReadinessLoads])
  const invalidateInviteLoads=useCallback(()=>{inviteSequence.current++},[])
  const invalidateScopeLoads=useCallback(()=>{scopeSequence.current++;invalidateIntegrationLoads();invalidateProvisioningLoads();invalidateInviteLoads()},[invalidateIntegrationLoads,invalidateInviteLoads,invalidateProvisioningLoads])
  const invalidateLoads=useCallback(()=>{sequence.current++;invalidateAppLoads();invalidateScopeLoads()},[invalidateAppLoads,invalidateScopeLoads])

  useEffect(()=>{
    if(allowed) void load(true)
    return invalidateLoads
  },[allowed,invalidateLoads,load])
  useEffect(()=>{
    let cancelled=false
    if(allowed&&initialDraftId)void apiGet<unknown>(base+'/'+initialDraftId).then(value=>{if(!cancelled)showDraft(draftResponse(value))}).catch(error=>{if(!cancelled)setError(message(error))})
    return()=>{cancelled=true}
  },[allowed,initialDraftId,openRequest,showDraft])
  useEffect(()=>{onChanged?.()},[current?.revision,scope?.revision,application?.revision,integration?.revision,provisioning?.updatedAt,schemaReadiness?.updatedAt,runtimeBundle?.updatedAt,connectionRefresh,onChanged])

  useEffect(()=>{
    if(!inviteCopied)return
    const timer=setTimeout(()=>setInviteCopied(false),2000)
    return ()=>clearTimeout(timer)
  },[inviteCopied])

  useEffect(()=>{
    if(!provisioningAllowed||!current||provisioning?.status!=='running'||provisioning.startAllowed||provisioningBusy)return
    const timer=setTimeout(()=>void loadProvisioning(current),2000)
    return ()=>clearTimeout(timer)
  },[current,loadProvisioning,provisioning,provisioningAllowed,provisioningBusy])

  useEffect(()=>{
    if(!provisioningAllowed||!current||schemaReadiness?.status!=='running'||schemaReadiness.startAllowed||schemaReadinessBusy)return
    const timer=setTimeout(()=>void loadSchemaReadiness(current),2000)
    return ()=>clearTimeout(timer)
  },[current,loadSchemaReadiness,provisioningAllowed,schemaReadiness,schemaReadinessBusy])

  useEffect(()=>{
    if(!provisioningAllowed||!current||runtimeBundle?.status!=='running'||runtimeBundle.startAllowed||runtimeBundleBusy)return
    const timer=setTimeout(()=>void loadRuntimeBundle(current),2000)
    return ()=>clearTimeout(timer)
  },[current,loadRuntimeBundle,provisioningAllowed,runtimeBundle,runtimeBundleBusy])

  function begin() {
    if(busyRef.current) return
    try {createKey.current=sessionStorage.getItem(checkpoint)||crypto.randomUUID()}
    catch {setError('Не удалось подготовить безопасное сохранение. Разрешите хранилище вкладки и повторите.');return}
    invalidateAppLoads();invalidateScopeLoads();setData({...empty(),companyId:session.admin.role==='SUPER_ADMIN'?null:index.companies[0]?.id||null});setCurrent(null);setEditing(true);setError('');setNotice('');setUncertain(false);command.current=null
    setApplication(null);setAppData(emptyApplication());setAppContract(defaultContract);setAppError('');setAppNotice('');setAppUncertain(false);appCommand.current=null
    setScope(null);setScopeError('');setScopeNotice('');setScopeUncertain(false);scopeCommand.current=null
    setIntegration(null);setIntegrationStoreId('');setIntegrationToken('');setIntegrationContract(defaultIntegrationContract)
    setIntegrationError('');setIntegrationNotice('');setIntegrationUncertain(false);integrationCommand.current=null
    setProvisioning(null);setProvisioningError('');setProvisioningNotice('');setProvisioningUncertain(false)
    setSchemaReadiness(null);setSchemaReadinessError('');setSchemaReadinessNotice('');setSchemaReadinessUncertain(false)
    setRuntimeBundle(null);setRuntimeBundleError('');setRuntimeBundleNotice('');setRuntimeBundleUncertain(false)
    setInvites([]);setInviteError('');setInviteToken('')
  }
  async function open(id:string) {
    if(busyRef.current||appBusyRef.current||scopeBusyRef.current||integrationBusyRef.current||provisioningBusyRef.current||schemaReadinessBusyRef.current||runtimeBundleBusyRef.current) return
    busyRef.current=true;setBusy(true);setError('')
    try {showDraft(draftResponse(await apiGet(base+'/'+id)))}
    catch(error) {setError(message(error))}
    finally {busyRef.current=false;setBusy(false)}
  }
  async function save() {
    if(busyRef.current||appBusyRef.current||scopeBusyRef.current||integrationBusyRef.current) return
    const body=command.current||(current?{id:current.id,revision:current.revision,data}:{requestKey:createKey.current,data})
    command.current=body
    busyRef.current=true;setBusy(true);setError('');setNotice('')
    try {
      if('requestKey' in body) {
        try {sessionStorage.setItem(checkpoint,body.requestKey)}
        catch {throw new ApiError(400,'ONBOARDING_TAB_STORAGE','Не удалось подготовить сохранение. Разрешите хранилище вкладки и повторите.')}
      }
      const raw='id' in body?await apiPut(base+'/'+body.id,{revision:body.revision,data:body.data}):await apiPost(base,body)
      const saved=draftResponse(raw)
      showDraft(saved)
      setIndex(previous=>({...previous,drafts:[saved,...previous.drafts.filter(draft=>draft.id!==saved.id)].slice(0,50)}))
      clearCheckpoint()
    } catch(error) {
      setError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408) {
        command.current=null;setUncertain(false)
      } else setUncertain(true)
    } finally {busyRef.current=false;setBusy(false)}
  }
  async function saveApplication() {
    if(!current||scope||appBusyRef.current||busyRef.current||scopeBusyRef.current||integrationBusyRef.current)return
    const body=appCommand.current||{revision:application?.revision||0,config:appData}
    appCommand.current=body;appBusyRef.current=true;setAppBusy(true);setAppError('');setAppNotice('')
    try {
      const saved=applicationResponse(await apiPut(base+'/'+current.id+'/application',body))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул конфигурацию другого черновика.')
      setApplication(saved);setAppData(saved.config);setAppContract(saved.contract);setAppUncertain(false);appCommand.current=null
      setAppNotice('Настройка приложения сохранена. Приложение ещё не опубликовано.')
    } catch(error) {
      setAppError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){appCommand.current=null;setAppUncertain(false)}
      else setAppUncertain(true)
    } finally {appBusyRef.current=false;setAppBusy(false)}
  }
  async function prepareScope() {
    if(!canWrite||!current||(!crmMode&&!application)||scopeBusyRef.current||busyRef.current||appBusyRef.current||integrationBusyRef.current)return
    const run=++scopeSequence.current
    const body=scopeCommand.current||(crmMode?{draftRevision:current.revision}:{draftRevision:current.revision,applicationRevision:application!.revision})
    scopeCommand.current=body;scopeBusyRef.current=true;setScopeBusy(true);setScopeError('');setScopeNotice('')
    try {
      const saved=scopeResponse(await (crmMode?apiPost(base+'/'+current.id+'/crm/prepare',body):apiPut(base+'/'+current.id+'/scope',body)))
      if(run!==scopeSequence.current)return
      if(saved.draftId!==current.id)throw new Error('Сервер вернул область другого черновика.')
      setScope(saved);setScopeUncertain(false);scopeCommand.current=null
      setScopeNotice(crmMode?'Данные CRM подготовлены. CRM ещё не запущена; подключение базы и кассы проверяется отдельно.':'Каноническая область подготовлена. Заведение остаётся выключенным, приложение не запущено.')
      if(crmMode)void loadApplication(current)
      void loadInvites(current);void loadIntegration(current);void loadProvisioning(current)
    } catch(error) {
      if(run!==scopeSequence.current)return
      setScopeError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){scopeCommand.current=null;setScopeUncertain(false)}
      else setScopeUncertain(true)
    } finally {scopeBusyRef.current=false;setScopeBusy(false)}
  }
  async function startProvisioning() {
    if(!canWrite||!provisioningAllowed||!current||!scope||!provisioning?.startAllowed||provisioningBusyRef.current)return
    provisioningSequence.current++;provisioningBusyRef.current=true;setProvisioningBusy(true);setProvisioningError('');setProvisioningNotice('')
    try {
      const saved=provisioningResponse(await apiPost(base+'/'+current.id+'/provisioning/runtime-database-binding/run',{}))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул подготовку базы другого черновика.')
      setProvisioning(saved);setProvisioningUncertain(false);setProvisioningNotice(provisioningGuidance(saved))
      if(saved.status==='succeeded')void loadSchemaReadiness(current)
    } catch(error) {
      setProvisioningError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)setProvisioningUncertain(false)
      else setProvisioningUncertain(true)
    } finally {provisioningBusyRef.current=false;setProvisioningBusy(false)}
  }
  async function startSchemaReadiness() {
    if(!canWrite||!provisioningAllowed||!current||!scope||provisioning?.status!=='succeeded'||
      !schemaReadiness?.startAllowed||schemaReadinessBusyRef.current)return
    schemaReadinessSequence.current++;schemaReadinessBusyRef.current=true;setSchemaReadinessBusy(true);setSchemaReadinessError('');setSchemaReadinessNotice('')
    try {
      const saved=schemaReadinessResponse(await apiPost(base+'/'+current.id+'/provisioning/tenant-schema-readiness/run',{}))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул проверку схемы другого черновика.')
      setSchemaReadiness(saved);setSchemaReadinessUncertain(false);setSchemaReadinessNotice(schemaReadinessGuidance(saved))
      if(saved.status==='succeeded')void loadRuntimeBundle(current)
    } catch(error) {
      setSchemaReadinessError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)setSchemaReadinessUncertain(false)
      else setSchemaReadinessUncertain(true)
    } finally {schemaReadinessBusyRef.current=false;setSchemaReadinessBusy(false)}
  }
  async function startRuntimeBundle() {
    if(!canWrite||!provisioningAllowed||!current||!scope||schemaReadiness?.status!=='succeeded'||
      !runtimeBundle?.startAllowed||runtimeBundleBusyRef.current)return
    runtimeBundleSequence.current++;runtimeBundleBusyRef.current=true;setRuntimeBundleBusy(true);setRuntimeBundleError('');setRuntimeBundleNotice('')
    try {
      const saved=runtimeBundleResponse(await apiPost(base+'/'+current.id+'/provisioning/runtime-bundle/run',{}))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул runtime bundle другого черновика.')
      setRuntimeBundle(saved);setRuntimeBundleUncertain(false);setRuntimeBundleNotice(runtimeBundleGuidance(saved))
    } catch(error) {
      setRuntimeBundleError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408)setRuntimeBundleUncertain(false)
      else setRuntimeBundleUncertain(true)
    } finally {runtimeBundleBusyRef.current=false;setRuntimeBundleBusy(false)}
  }
  async function saveIntegration() {
    if(!canWrite||!integrationsAllowed||!current||!scope||integrationBusyRef.current||busyRef.current||scopeBusyRef.current)return
    const body=integrationCommand.current||{requestKey:crypto.randomUUID(),revision:integration?.revision||0,storeId:integrationStoreId,token:integrationToken}
    integrationCommand.current=body;integrationBusyRef.current=true;setIntegrationBusy(true);setIntegrationError('');setIntegrationNotice('')
    try {
      const saved=integrationResponse(await apiPut(base+'/'+current.id+'/integrations/evotor',body))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул подключение другого черновика.')
      setIntegration(saved);setIntegrationContract(saved.contract);setIntegrationStoreId(saved.storeId);setIntegrationToken('')
      setIntegrationUncertain(false);integrationCommand.current=null
      setIntegrationNotice('Настройка зашифрована на сервере. Доступ к магазину ещё нужно проверить.')
    } catch(error) {
      setIntegrationError(message(error))
      if(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408){integrationCommand.current=null;setIntegrationUncertain(false)}
      else setIntegrationUncertain(true)
    } finally {integrationBusyRef.current=false;setIntegrationBusy(false)}
  }
  async function verifyIntegration() {
    if(!canWrite||!integrationsAllowed||!current||!integration||integrationBusyRef.current||integrationUncertain)return
    integrationBusyRef.current=true;setIntegrationBusy(true);setIntegrationError('');setIntegrationNotice('')
    try {
      const saved=integrationResponse(await apiPost(base+'/'+current.id+'/integrations/evotor/verify',{revision:integration.revision}))
      if(saved.draftId!==current.id)throw new Error('Сервер вернул проверку другого черновика.')
      setIntegration(saved);setIntegrationContract(saved.contract);setIntegrationStoreId(saved.storeId);setIntegrationToken('')
      setIntegrationNotice(saved.status==='verified'?'Чтение документов магазина подтверждено. POS ещё не привязан, приложение не опубликовано.':saved.verification.nextAction)
    } catch(error) {
      setIntegrationError(message(error))
      if(!(error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==408))setIntegrationUncertain(true)
    } finally {integrationBusyRef.current=false;setIntegrationBusy(false)}
  }
  async function createInvite() {
    if(!current||!scope||inviteBusyRef.current||busyRef.current||appBusyRef.current||scopeBusyRef.current||integrationBusyRef.current)return
    inviteBusyRef.current=true;setInviteBusy(true);setInviteError('');setInviteToken('');setInviteCopied(false)
    try {
      const result=await apiPost<{token:string}&Invite>(base+'/'+current.id+'/invites',undefined)
      const saved=inviteResponse(result)
      if(saved.draftId!==current.id)throw new Error('Сервер вернул приглашение другого черновика.')
      setInviteToken(result.token)
      setInvites(previous=>[saved,...previous.map(invite=>invite.status==='pending'?{...invite,status:'revoked' as const,revokedAt:saved.createdAt}:invite)])
    } catch(error) {setInviteError(message(error))}
    finally {inviteBusyRef.current=false;setInviteBusy(false)}
  }
  async function copyInviteLink() {
    if(!inviteToken)return
    try {
      await navigator.clipboard.writeText(window.location.origin+'/invite/'+inviteToken)
      setInviteCopied(true)
    } catch {setInviteError('Не удалось скопировать ссылку. Скопируйте текст вручную.')}
  }
  async function revokeInvite(id:string) {
    if(!current||inviteBusyRef.current||busyRef.current)return
    inviteBusyRef.current=true;setInviteBusy(true);setInviteError('')
    try {
      const saved=inviteResponse(await apiDelete(base+'/'+current.id+'/invites/'+id))
      setInvites(previous=>previous.map(invite=>invite.id===saved.id?saved:invite))
      if(inviteToken&&saved.id===invites.find(invite=>invite.status==='pending')?.id) setInviteToken('')
    } catch(error) {setInviteError(message(error))}
    finally {inviteBusyRef.current=false;setInviteBusy(false)}
  }
  function change<K extends keyof OnboardingData>(key:K,value:OnboardingData[K]) {
    setData(previous=>({...previous,[key]:value}));setNotice('')
  }
  function changeApplication<K extends keyof ApplicationConfig>(key:K,value:ApplicationConfig[K]) {
    setAppData(previous=>({...previous,[key]:value}));setAppNotice('')
  }
  if(!allowed) return null
  const draftDirty=Boolean(current)&&JSON.stringify(data)!==JSON.stringify(current?.data)
  const appDirty=Boolean(application)&&JSON.stringify(appData)!==JSON.stringify(application?.config)
  const integrationDirty=Boolean(integration)&&(integrationStoreId!==integration?.storeId||Boolean(integrationToken))
  const provisioningButtonLabel=provisioningBusy?'Проверяем…':provisioningUncertain?'Сначала обновите состояние':!provisioning?'Загрузите состояние':
    provisioning.status==='not_started'?'Подготовить привязку':provisioning.status==='running'?(provisioning.startAllowed?'Продолжить подготовку':'Подготовка выполняется…'):
    provisioning.status==='action_required'?'Повторить после исправления':provisioning.status==='retryable_error'?'Повторить подготовку':'Привязка подготовлена'
  const schemaReadinessButtonLabel=schemaReadinessBusy?'Проверяем…':schemaReadinessUncertain?'Сначала обновите состояние':!schemaReadiness?'Загрузите состояние':
    schemaReadiness.status==='not_started'?'Проверить схему':schemaReadiness.status==='running'?(schemaReadiness.startAllowed?'Продолжить проверку':'Проверка выполняется…'):
    schemaReadiness.status==='action_required'?'Повторить после исправления':schemaReadiness.status==='retryable_error'?'Повторить проверку':'Схема проверена'
  const runtimeBundleButtonLabel=runtimeBundleBusy?'Проверяем…':runtimeBundleUncertain?'Сначала обновите состояние':!runtimeBundle?'Загрузите состояние':
    runtimeBundle.status==='not_started'?'Собрать и проверить bundle':runtimeBundle.status==='running'?(runtimeBundle.startAllowed?'Продолжить проверку':'Проверка выполняется…'):
    runtimeBundle.status==='action_required'?'Повторить после обновления':runtimeBundle.status==='retryable_error'?'Повторить проверку':'Bundle проверен'

  return <section className="card onboarding" aria-label="Подключение заведений">
    <div className="onboarding-head">
      <div><span className="eyebrow">ПОДКЛЮЧЕНИЕ ЗАВЕДЕНИЙ</span><h2>Новое заведение</h2><p>Сохраните данные сейчас и продолжите настройку позже.</p></div>
      {canWrite&&<button className="btn" disabled={busy||loading||editing} onClick={begin}><Plus size={16}/>Добавить заведение</button>}
    </div>
    {error&&<div className="onboarding-feedback error" role="alert">{error}</div>}
    {notice&&<p className="onboarding-feedback" role="status">{notice}</p>}
    {!canWrite&&<p className="onboarding-feedback">Вам доступен просмотр. Изменения выполняет владелец или управляющий этой точки.</p>}
    {editing&&current&&session.capabilities.onboardingWorkflow&&<OnboardingProgress key={'progress:'+current.id} draftId={current.id} canWrite={canWrite}
      onSaved={()=>setConnectionRefresh(value=>value+1)} refreshKey={[current.revision,application?.revision,scope?.revision,integration?.revision,provisioning?.updatedAt,schemaReadiness?.updatedAt,runtimeBundle?.updatedAt,connectionRefresh].join(':')}/>}
    {editing&&<form onSubmit={event=>{event.preventDefault();void save()}}>
      <div className="onboarding-step"><Building2 size={18}/><b>Данные заведения</b><span>Черновик · ещё не подключено</span></div>
      <fieldset className="onboarding-fields" disabled={!canWrite||busy||uncertain||appBusy||scopeBusy||scopeLoading||integrationBusy||Boolean(scope)}>
        <label className="field"><span>Название заведения</span><input required maxLength={120} value={data.venueName} onChange={event=>{
          const venueName=event.target.value
          setData(previous=>({...previous,venueName,companyName:!previous.companyId&&(!previous.companyName||previous.companyName===previous.venueName)?venueName:previous.companyName}));setNotice('')
        }}/></label>
        <label className="field"><span>Организация</span><select aria-label="Организация" value={data.companyId||'new'} onChange={event=>{
          const companyId=event.target.value==='new'?null:event.target.value
          setData(previous=>({...previous,companyId,companyName:companyId?'':previous.venueName}));setNotice('')
        }}>{session.admin.role==='SUPER_ADMIN'&&<option value="new">Новая организация</option>}{index.companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}
          {data.companyId&&!index.companies.some(company=>company.id===data.companyId)&&<option value={data.companyId} disabled>Организация недоступна</option>}
        </select></label>
        {!data.companyId&&<label className="field"><span>Название организации</span><input required maxLength={120} value={data.companyName} onChange={event=>change('companyName',event.target.value)}/></label>}
        <label className="field"><span>Тип заведения</span><select value={data.venueType} onChange={event=>change('venueType',event.target.value as OnboardingData['venueType'])}>
          <option value="bar">Бар</option><option value="cafe">Кафе</option><option value="restaurant">Ресторан</option><option value="shop">Магазин</option><option value="other">Другое</option>
        </select></label>
        <label className="field"><span>Адрес</span><input maxLength={300} value={data.address} onChange={event=>change('address',event.target.value)}/></label>
        <label className="field"><span>Часовой пояс</span><input required list="onboarding-timezones" maxLength={64} value={data.timeZone} onChange={event=>change('timeZone',event.target.value)}/>
          <datalist id="onboarding-timezones"><option value="Europe/Moscow"/><option value="Europe/Kaliningrad"/><option value="Asia/Yekaterinburg"/><option value="Asia/Novosibirsk"/><option value="Asia/Vladivostok"/></datalist>
        </label>
        <label className="field"><span>Email владельца</span><input aria-label="Email владельца" aria-describedby="onboarding-owner-note" type="email" maxLength={254} value={data.ownerEmail} onChange={event=>change('ownerEmail',event.target.value)}/><small id="onboarding-owner-note">Приглашение на этом шаге не отправляется.</small></label>
      </fieldset>
      <div className="onboarding-actions">
        <button className="btn" type="submit" disabled={!canWrite||busy||appBusy||scopeBusy||scopeLoading||integrationBusy||Boolean(scope)}><Save size={16}/>{scope?'Область зафиксирована':busy?'Сохраняем…':uncertain?'Повторить сохранение':'Сохранить черновик'}</button>
        <button className="btn secondary" type="button" disabled={busy||appBusy||scopeBusy||integrationBusy||provisioningBusy||schemaReadinessBusy||runtimeBundleBusy} onClick={()=>current?void open(current.id):void load(true)}><RefreshCw size={16}/>Открыть сохранённую версию</button>
        <button className="btn secondary" type="button" disabled={busy||uncertain||appBusy||appUncertain||scopeBusy||scopeUncertain||integrationBusy||integrationUncertain||provisioningBusy||provisioningUncertain||schemaReadinessBusy||schemaReadinessUncertain||runtimeBundleBusy||runtimeBundleUncertain} onClick={()=>{invalidateAppLoads();invalidateScopeLoads();setIntegrationToken('');setEditing(false);setNotice('');setError('');setAppError('');setAppNotice('');setScopeError('');setScopeNotice('');setIntegrationError('');setIntegrationNotice('');setProvisioningError('');setProvisioningNotice('');setSchemaReadinessError('');setSchemaReadinessNotice('');setRuntimeBundleError('');setRuntimeBundleNotice('')}}>Закрыть</button>
      </div>
    </form>}
    {editing&&current&&scope&&scope.draftId===current.id&&!scopeLoading&&!scopeUncertain&&canWrite&&session.capabilities.onboardingSupport&&
      <OnboardingSupport actorId={session.admin.id} draftId={current.id} scope={{companyId:scope.company.id,venueId:scope.venue.id}}/>}
    {editing&&current&&scope&&scope.draftId===current.id&&!scopeLoading&&!scopeUncertain&&canWrite&&session.capabilities.tenantCrmReads&&
      <div className="tenant-crm-sections">
        <TenantCrmReadiness actorId={session.admin.id} draftId={current.id} scope={{companyId:scope.company.id,venueId:scope.venue.id}}/>
        <TenantCustomerDirectory actorId={session.admin.id} draftId={current.id} scope={{companyId:scope.company.id,venueId:scope.venue.id}}/>
      </div>}
    {editing&&current&&scope&&scope.draftId===current.id&&!scopeLoading&&!scopeUncertain&&canWrite&&session.capabilities.tenantCrmActivationChecks&&
      <TenantCrmActivationCheck actorId={session.admin.id} draftId={current.id} scope={{companyId:scope.company.id,venueId:scope.venue.id}}/>}
    {editing&&current&&!crmMode&&<form className="onboarding-application" onSubmit={event=>{event.preventDefault();void saveApplication()}}>
      <div className="onboarding-step"><Smartphone size={18}/><b>Приложение</b><span>{application?'Конфигурация сохранена':'Не настроено'} · приложение ещё не опубликовано</span></div>
      {appError&&<div className="onboarding-feedback error" role="alert">{appError}</div>}
      {appNotice&&<p className="onboarding-feedback" role="status">{appNotice}</p>}
      <div className="onboarding-contract" aria-label="Статус приложения">
        <div><ShieldCheck size={17}/><span><b>Изоляция данных</b><small>{appContract.isolationPolicy==='dedicated_database'?'Данные гостей будут храниться отдельно':'Не подтверждена'}</small></span></div>
        <div><span><b>Шаблон</b><small>{appContract.template==='standard'?'Стандартный':'Не подтверждён'} · {appContract.qrEnabled?'QR включён':'QR не настроен'}</small></span></div>
        <div><span><b>Публикация</b><small>{appContract.published?'Опубликовано':appContract.runtimeStatus==='not_provisioned'?'Не запускалась':'Не подтверждена'}</small></span></div>
        {application&&<div><span><b>Tenant ID</b><small className="tenant-key">{application.tenantKey}</small></span></div>}
      </div>
      <fieldset className="onboarding-fields" disabled={!canWrite||appBusy||appLoading||appUncertain||busy||scopeBusy||scopeLoading||Boolean(scope)}>
        <label className="field"><span>Название приложения</span><input required maxLength={120} value={appData.displayName} onChange={event=>changeApplication('displayName',event.target.value)}/></label>
        <label className="field"><span>Тема</span><select value={appData.theme} onChange={event=>changeApplication('theme',event.target.value as ApplicationConfig['theme'])}>
          <option value="premium-dark">Тёмная премиальная</option><option value="dark">Тёмная</option><option value="light">Светлая</option>
        </select></label>
        <label className="field"><span>Основной цвет</span><div className="onboarding-color"><input aria-label="Основной цвет палитра" type="color" value={appData.primaryColor} onChange={event=>changeApplication('primaryColor',event.target.value)}/><input aria-label="Основной цвет" pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={appData.primaryColor} onChange={event=>changeApplication('primaryColor',event.target.value)}/></div></label>
        <label className="field"><span>Дополнительный цвет</span><div className="onboarding-color"><input aria-label="Дополнительный цвет палитра" type="color" value={appData.secondaryColor} onChange={event=>changeApplication('secondaryColor',event.target.value)}/><input aria-label="Дополнительный цвет" pattern="#[0-9A-Fa-f]{6}" maxLength={7} value={appData.secondaryColor} onChange={event=>changeApplication('secondaryColor',event.target.value)}/></div></label>
        <label className="onboarding-check"><input type="checkbox" checked={appData.shopEnabled} onChange={event=>changeApplication('shopEnabled',event.target.checked)}/><span><b>Магазин</b><small>Подготовить раздел стандартного шаблона</small></span></label>
        <label className="onboarding-check"><input type="checkbox" checked={appData.loyaltyEnabled} onChange={event=>changeApplication('loyaltyEnabled',event.target.checked)}/><span><b>Лояльность</b><small>Только поддерживаемая базовая конфигурация</small></span></label>
      </fieldset>
      <p className="onboarding-note">Сохраните оформление и нужные модули. Касса подключается отдельным шагом. Настройка приложения ещё не означает его запуск.</p>
      <div className="onboarding-actions">
        <button className="btn" type="submit" disabled={!canWrite||appBusy||appLoading||busy||scopeBusy||scopeLoading||Boolean(scope)}><Save size={16}/>{scope?'Область зафиксирована':appBusy?'Сохраняем…':appUncertain?'Повторить сохранение приложения':'Сохранить приложение'}</button>
        <button className="btn secondary" type="button" disabled={appBusy||appLoading||scopeBusy} onClick={()=>void loadApplication(current)}><RefreshCw size={16}/>Открыть сохранённую конфигурацию</button>
      </div>
    </form>}
    {editing&&current&&<section className="onboarding-scope" aria-label="Область заведения">
      <div className="onboarding-step"><MapPinned size={18}/><b>Организация и заведение</b><span>{scope?'Подготовлено · выключено':'Не подготовлено'}</span></div>
      {scopeError&&<div className="onboarding-feedback error" role="alert">{scopeError}</div>}
      {scopeNotice&&<p className="onboarding-feedback" role="status">{scopeNotice}</p>}
      {scope&&<div className="onboarding-contract" aria-label="Статус области заведения">
        <div><ShieldCheck size={17}/><span><b>Организация</b><small>ID {scope.company.id} · {scope.company.createdByOnboarding?'создана выключенной':'существующая'}</small></span></div>
        <div><ShieldCheck size={17}/><span><b>Заведение</b><small>ID {scope.venue.id} · выключено</small></span></div>
        <div><span><b>Доступ</b><small>Сотрудники не назначены · подключения не созданы</small></span></div>
      </div>}
      <p className="onboarding-note">{crmMode?'Для CRM-сайта не нужно настраивать оформление гостевого приложения. После подготовки подключите базу и кассу; CRM ещё не запущена.':'Заведение сохранено для дальнейшего подключения. Его приложение ещё не запущено; связь с кассой проверяется отдельно.'}</p>
      <div className="onboarding-actions">
        {!scope&&<button className="btn" type="button" disabled={!canWrite||(!crmMode&&!application)||draftDirty||(!crmMode&&appDirty)||scopeBusy||scopeLoading||scopeUncertain||busy||appBusy||appLoading||appUncertain} onClick={()=>void prepareScope()}><MapPinned size={16}/>{scopeBusy?'Подготавливаем…':scopeUncertain?'Повторить подготовку':draftDirty||(!crmMode&&appDirty)?'Сначала сохраните изменения':crmMode?'Подготовить CRM':'Подготовить область'}</button>}
        <button className="btn secondary" type="button" disabled={scopeBusy||scopeLoading} onClick={()=>void loadScope(current)}><RefreshCw size={16}/>Открыть сохранённую область</button>
      </div>
    </section>}
    {editing&&current&&scope&&<section className="onboarding-provisioning" aria-label="Подготовка базы приложения">
      <div className="onboarding-step"><Database size={18}/><b>База приложения</b><span>{provisioningAllowed?(provisioning?provisioningStatusLabel(provisioning):provisioningLoading?'Загружаем…':'Состояние недоступно'):'Недоступно в этой среде'}</span></div>
      {!provisioningAllowed?<p className="onboarding-note">Серверная подготовка выключена или недоступна для этой учётной записи. Область и остальные необязательные шаги остаются сохранены.</p>:<>
        {provisioningError&&<div className="onboarding-feedback error" role="alert">{provisioningError}</div>}
        {provisioningNotice&&<p className="onboarding-feedback" role="status">{provisioningNotice}</p>}
        {provisioning&&<div className="onboarding-contract" aria-label="Статус подготовки базы">
          <div><ShieldCheck size={17}/><span><b>Состояние</b><small>{provisioningGuidance(provisioning)}</small></span></div>
          <div><span><b>Попытки</b><small>{provisioning.attemptCount===0?'Запусков ещё не было':'Попытка '+provisioning.attemptCount}</small></span></div>
          <div><span><b>Приложение</b><small>Не запущено · не опубликовано</small></span></div>
        </div>}
        <p className="onboarding-note">Шаг создаёт или сверяет только точную привязку уже подготовленной выделенной базы. Он не создаёт базу, не запускает миграции, не включает заведение и не публикует приложение.</p>
        <div className="onboarding-actions">
          <button className="btn" type="button" disabled={!canWrite||provisioningBusy||provisioningLoading||provisioningUncertain||!provisioning?.startAllowed} onClick={()=>void startProvisioning()}><Database size={16}/>{provisioningButtonLabel}</button>
          <button className="btn secondary" type="button" disabled={provisioningBusy||provisioningLoading} onClick={()=>void loadProvisioning(current)}><RefreshCw size={16}/>Обновить состояние</button>
        </div>
        <div className="onboarding-readiness" aria-label="Проверка схемы приложения">
          <div className="onboarding-step"><ShieldCheck size={18}/><b>Схема и границы данных</b><span>{provisioning?.status!=='succeeded'?'Сначала подготовьте привязку':schemaReadiness?schemaReadinessStatusLabel(schemaReadiness):schemaReadinessLoading?'Загружаем…':'Состояние недоступно'}</span></div>
          {provisioning?.status!=='succeeded'?<>
            <p className="onboarding-note">Read-only проверка станет доступна после точной привязки выделенной базы. До этого мастер не обращается к её схеме.</p>
            <div className="onboarding-actions"><button className="btn" type="button" disabled><ShieldCheck size={16}/>Сначала подготовьте привязку</button></div>
          </>:<>
            {schemaReadinessError&&<div className="onboarding-feedback error" role="alert">{schemaReadinessError}</div>}
            {schemaReadinessNotice&&<p className="onboarding-feedback" role="status">{schemaReadinessNotice}</p>}
            {schemaReadiness&&<div className="onboarding-contract" aria-label="Статус проверки схемы">
              <div><ShieldCheck size={17}/><span><b>Состояние</b><small>{schemaReadinessGuidance(schemaReadiness)}</small></span></div>
              <div><span><b>Попытки</b><small>{schemaReadiness.attemptCount===0?'Проверок ещё не было':'Попытка '+schemaReadiness.attemptCount}</small></span></div>
              <div><span><b>Приложение</b><small>Не запущено · не опубликовано</small></span></div>
            </div>}
            <p className="onboarding-note">Шаг только читает структуру миграций 009 и 017–020, точную привязку и ownership-границы. Он не применяет миграции, не переносит исторические данные и не включает runtime.</p>
            <div className="onboarding-actions">
              <button className="btn" type="button" disabled={!canWrite||schemaReadinessBusy||schemaReadinessLoading||schemaReadinessUncertain||!schemaReadiness?.startAllowed} onClick={()=>void startSchemaReadiness()}><ShieldCheck size={16}/>{schemaReadinessButtonLabel}</button>
              <button className="btn secondary" type="button" disabled={schemaReadinessBusy||schemaReadinessLoading} onClick={()=>void loadSchemaReadiness(current)}><RefreshCw size={16}/>Обновить проверку</button>
            </div>
          </>}
          <div className="onboarding-readiness" role="region" aria-label="Проверка runtime bundle">
            <div className="onboarding-step"><Smartphone size={18}/><b>Runtime bundle</b><span>{schemaReadiness?.status!=='succeeded'?'Сначала проверьте схему':runtimeBundle?runtimeBundleStatusLabel(runtimeBundle):runtimeBundleLoading?'Загружаем…':'Состояние недоступно'}</span></div>
            {schemaReadiness?.status!=='succeeded'?<>
              <p className="onboarding-note">Сборка станет доступна после read-only проверки схемы и ownership-границ. До этого сервер не формирует launch-конфигурацию.</p>
              <div className="onboarding-actions"><button className="btn" type="button" disabled><Smartphone size={16}/>Сначала проверьте схему</button></div>
            </>:<>
              {runtimeBundleError&&<div className="onboarding-feedback error" role="alert">{runtimeBundleError}</div>}
              {runtimeBundleNotice&&<p className="onboarding-feedback" role="status">{runtimeBundleNotice}</p>}
              {runtimeBundle&&<div className="onboarding-contract" aria-label="Статус runtime bundle">
                <div><ShieldCheck size={17}/><span><b>Состояние</b><small>{runtimeBundleGuidance(runtimeBundle)}</small></span></div>
                <div><span><b>Контракт</b><small>{runtimeBundle.result?.artifactContract??'tenant-runtime-v1'} · manifest v2</small></span></div>
                <div><span><b>Запуск</b><small>Не выполнялся · приложение не опубликовано</small></span></div>
              </div>}
              <p className="onboarding-note">Шаг проверяет конфигурацию и файлы утверждённой версии серверных модулей. Отсутствующая или изменённая версия требует исправления. Это ещё не запуск приложения.</p>
              <div className="onboarding-actions">
                <button className="btn" type="button" disabled={!canWrite||runtimeBundleBusy||runtimeBundleLoading||runtimeBundleUncertain||!runtimeBundle?.startAllowed} onClick={()=>void startRuntimeBundle()}><Smartphone size={16}/>{runtimeBundleButtonLabel}</button>
                <button className="btn secondary" type="button" disabled={runtimeBundleBusy||runtimeBundleLoading} onClick={()=>void loadRuntimeBundle(current)}><RefreshCw size={16}/>Обновить bundle</button>
              </div>
            </>}
          </div>
        </div>
      </>}
    </section>}
    {editing&&current&&scope&&<form className="onboarding-integration" aria-label="Подключение Эвотора" onSubmit={event=>{event.preventDefault();void saveIntegration()}}>
      <div className="onboarding-step"><Link2 size={18}/><b>Касса · Эвотор</b><span>{integrationsAllowed?integrationStatusLabel(integration):'Недоступно в этой среде'}</span></div>
      {!integrationsAllowed?<p className="onboarding-note">Защищённые подключения выключены. Черновик и остальные шаги можно продолжить без кассы.</p>:<>
        {integrationError&&<div className="onboarding-feedback error" role="alert">{integrationError}</div>}
        {integrationNotice&&<p className="onboarding-feedback" role="status">{integrationNotice}</p>}
        <div className="onboarding-contract" aria-label="Статус подключения Эвотора">
          <div><ShieldCheck size={17}/><span><b>Секрет</b><small>{integration?integration.credential.masked:'Не сохранён'} · {integrationContract.credentialStorage==='server_encrypted'?'зашифрован на сервере':'не подтверждено'}</small></span></div>
          <div><span><b>Проверка доступа</b><small>{integration?integration.verification.nextAction:'Сначала сохраните ID магазина и токен.'}</small></span></div>
          <div><span><b>Запуск</b><small>{integrationContract.posBindingCreated?'POS привязан':'POS не привязан'} · приложение не опубликовано</small></span></div>
        </div>
        <fieldset className="onboarding-fields" disabled={!canWrite||integrationBusy||integrationLoading||integrationUncertain||busy||scopeBusy}>
          <label className="field"><span>ID магазина Эвотора</span><input required maxLength={200} autoComplete="off" value={integrationStoreId} onChange={event=>{setIntegrationStoreId(event.target.value);setIntegrationNotice('')}}/></label>
          <label className="field"><span>Токен Эвотора</span><input aria-label="Токен Эвотора" aria-describedby="onboarding-evotor-token-note" required={!integration} type="password" minLength={16} maxLength={4096} autoComplete="new-password" spellCheck={false} value={integrationToken} placeholder={integration?'Введите только для замены':'Вставьте токен'} onChange={event=>{setIntegrationToken(event.target.value);setIntegrationNotice('')}}/><small id="onboarding-evotor-token-note">После сохранения поле очистится. Токен обратно не показывается.</small></label>
        </fieldset>
        <p className="onboarding-note">Проверка читает одну страницу документов через существующий адаптер. Она не создаёт аккаунт Эвотора, не ставит приложение на кассу и не включает импорт чеков.</p>
        <div className="onboarding-actions">
          <button className="btn" type="submit" disabled={!canWrite||integrationBusy||integrationLoading||busy||!integrationStoreId||!integrationToken}><Save size={16}/>{integrationBusy?'Сохраняем…':integrationUncertain?'Повторить сохранение':integration?'Заменить настройку':'Сохранить настройку'}</button>
          <button className="btn secondary" type="button" disabled={!canWrite||!integration||integrationDirty||integrationBusy||integrationLoading||integrationUncertain} onClick={()=>void verifyIntegration()}><ShieldCheck size={16}/>Проверить доступ</button>
          <button className="btn secondary" type="button" disabled={integrationBusy||integrationLoading} onClick={()=>void loadIntegration(current)}><RefreshCw size={16}/>Открыть сохранённую настройку</button>
        </div>
      </>}
    </form>}
    {editing&&current&&scope&&session.capabilities.onboardingPosProxy&&<OnboardingPosProxy key={'proxy:'+current.id} draftId={current.id} canWrite={canWrite} refreshKey={String(connectionRefresh)} onChanged={()=>setConnectionRefresh(value=>value+1)}/>}
    {legacyInvitesAllowed&&editing&&current&&scope&&<section className="onboarding-invite" aria-label="Приглашение владельцу">
      <div className="onboarding-step"><Link2 size={18}/><b>Приглашение владельцу</b><span>{invites.some(invite=>invite.status==='pending')?'Активная ссылка есть':'Ссылки нет'}</span></div>
      {inviteError&&<div className="onboarding-feedback error" role="alert">{inviteError}</div>}
      {inviteToken&&<div className="onboarding-contract" aria-label="Новая ссылка приглашения">
        <div><Link2 size={17}/><span><b>Ссылка показана один раз</b><small className="tenant-key">{window.location.origin}/invite/{inviteToken}</small></span></div>
        <button className="btn secondary" type="button" onClick={()=>void copyInviteLink()} aria-label="Скопировать ссылку приглашения">
          {inviteCopied?<Check size={16}/>:<Copy size={16}/>}{inviteCopied?'Скопировано':'Скопировать'}
        </button>
      </div>}
      <p className="onboarding-note">Ссылка одноразовая, с ограниченным сроком действия и может быть отозвана. Перейдя по ней, человек сам задаёт email и пароль и получает доступ владельца только к этому заведению. Отправьте ссылку сами — письма и SMS этот шаг не рассылает.</p>
      <div className="onboarding-actions">
        <button className="btn" type="button" disabled={inviteBusy||inviteLoading||busy||appBusy||scopeBusy} onClick={()=>void createInvite()}><Link2 size={16}/>{inviteBusy?'Создаём…':invites.some(invite=>invite.status==='pending')?'Создать новую ссылку':'Создать ссылку'}</button>
        <button className="btn secondary" type="button" disabled={inviteBusy||inviteLoading} onClick={()=>void loadInvites(current)}><RefreshCw size={16}/>Обновить список</button>
      </div>
      {invites.length>0&&<ul className="onboarding-list">{invites.map(invite=><li key={invite.id}>
        <div><b>{invite.status==='pending'?'Активна':invite.status==='claimed'?'Использована':'Отозвана'}</b><small>{invite.status==='pending'?'до '+new Date(invite.expiresAt).toLocaleString('ru-RU'):invite.status==='claimed'?new Date(invite.claimedAt!).toLocaleString('ru-RU'):new Date(invite.revokedAt!).toLocaleString('ru-RU')}</small></div>
        {invite.status==='pending'&&<button className="btn secondary" disabled={inviteBusy||inviteLoading} onClick={()=>void revokeInvite(invite.id)} aria-label="Отозвать ссылку"><XCircle size={16}/>Отозвать</button>}
      </li>)}</ul>}
    </section>}
    <div className="onboarding-list-head"><b>Черновики подключения</b><button className="btn secondary" disabled={busy||appBusy||scopeBusy||integrationBusy||provisioningBusy||schemaReadinessBusy||runtimeBundleBusy||loading} onClick={()=>void load()}><RefreshCw size={14}/>Обновить</button></div>
    {loading?<p role="status">Загружаем черновики…</p>:<>
      {!index.drafts.length&&<p>Сохранённых черновиков пока нет.</p>}
      <ul className="onboarding-list">{index.drafts.map(draft=><li key={draft.id}>
        <div><b>{draft.data.venueName}</b><small>{draft.data.companyName||index.companies.find(company=>company.id===draft.data.companyId)?.name||'Организация недоступна'} · Черновик</small></div>
        <button className="btn secondary" disabled={busy||appBusy||scopeBusy||integrationBusy||provisioningBusy||schemaReadinessBusy||runtimeBundleBusy||uncertain||appUncertain||scopeUncertain||integrationUncertain||provisioningUncertain||schemaReadinessUncertain||runtimeBundleUncertain} onClick={()=>void open(draft.id)} aria-label={'Открыть черновик '+draft.data.venueName}>Открыть</button>
      </li>)}</ul>
      {index.drafts.length===50&&<small>Показаны последние 50 черновиков.</small>}
    </>}
  </section>
}
