// CHAT 03 / #24. Server-only bridge from signed Admin request to isolated,
// verified tenant manual-contact write. Default-off and not a publication grant.
import type {Pool} from 'pg'
import {createSpaceverseManualCrmContactService,validateSpaceverseManualCrmContactInput}
  from '../../crm-manual-contact-create.js'
import {resolveSpaceverseRuntime,SpaceverseRuntimeError} from '../../spaceverse-runtime-manifest.js'
import {config} from './config.js'
import {pool} from './db.js'
import {onboardingTargetRegistry} from './onboarding-database-registry.js'
import {createTenantCrmContactOwnerGate} from './tenant-crm-contact-owner-gate.js'
import {sha256} from './security.js'
import {HttpError,type AdminPrincipal} from './types.js'

type Target=Pick<Pool,'connect'>
const unavailable=()=>new HttpError(503,'TENANT_CRM_CONTACT_UNAVAILABLE',
  'Создание контакта не подтверждено. Повторите запрос с тем же ключом.')
const disabled=()=>new HttpError(403,'TENANT_CRM_CONTACT_CREATE_DISABLED',
  'Создание контактов CRM пока выключено.')

export function createTenantCrmContactCreateService(options:{
  metadata:Target
  resolveTargetDatabase:(runtimeKey:string)=>Promise<Target|null>
  enabled?:()=>boolean
}) {
  const enabled=options.enabled??(()=>config.enableTenantCrmContactCreate)
  const gate=createTenantCrmContactOwnerGate({metadata:options.metadata,enabled})
  return async (admin:AdminPrincipal,rawSessionToken:string,draftId:string,raw:unknown)=>{
    if(!enabled()||!config.enableWrites||!config.enableOnboardingDrafts)throw disabled()
    let input:ReturnType<typeof validateSpaceverseManualCrmContactInput>
    try {
      input=validateSpaceverseManualCrmContactInput(raw)
    } catch(error) {
      if(error instanceof TypeError || error instanceof SpaceverseRuntimeError)
        throw new HttpError(400,'TENANT_CRM_CONTACT_INVALID','Проверьте имя, телефон, email и ключ запроса.')
      throw unavailable()
    }
    const result=await gate(admin,sha256(rawSessionToken),draftId,input.requestKey,
      async ({manifest,actorId})=>{
        const target=await options.resolveTargetDatabase(manifest.runtimeKey)
        if(!target)throw new HttpError(409,'TENANT_CRM_CONTACT_SOURCE_NOT_CONFIGURED',
          'Выделенная база заведения ещё не подключена.')
        const client=await target.connect()
        try {
          const runtime=await resolveSpaceverseRuntime({
            query:(sql,params)=>client.query(sql,params),
            environment:{
              SPACEVERSE_RUNTIME_MODE:'tenant',
              SPACEVERSE_RUNTIME_MANIFEST_JSON:JSON.stringify(manifest),
            },
          })
          // This writer starts its own tenant transaction and checks the
          // same binding FOR SHARE before committing. Its request ledger is
          // actor-bound and guarantees idempotent replay after lost responses.
          const write=createSpaceverseManualCrmContactService({
            connect:()=>target.connect(),runtime,actorId,
          })
          try {
            return await write(input)
          } catch(error) {
            if(error instanceof SpaceverseRuntimeError){
              if(error.code==='SPACEVERSE_CRM_CONTACT_DUPLICATE')
                throw new HttpError(409,'TENANT_CRM_CONTACT_DUPLICATE','Телефон или email уже используется в этом заведении.')
              if(error.code==='SPACEVERSE_CRM_CONTACT_REPLAY_CONFLICT' ||
                 error.code==='SPACEVERSE_CRM_CONTACT_ACTOR_MISMATCH')
                throw new HttpError(409,'TENANT_CRM_CONTACT_REPLAY_CONFLICT','Ключ запроса уже использован.')
              if(error.code==='SPACEVERSE_CRM_CONTACT_SCOPE_REJECTED')
                throw new HttpError(409,'TENANT_CRM_CONTACT_SCOPE_REJECTED','Привязка базы заведения не подтверждена.')
              throw unavailable()
            }
            throw error
          }
        }finally{client.release()}
      })
    return {schemaVersion:1 as const,requestKey:result.requestKey,contact:result.contact,
      identityStatus:'unlinked' as const,walletStatus:'not_created' as const}
  }
}

export const createTenantCrmContact=createTenantCrmContactCreateService({
  metadata:pool,
  resolveTargetDatabase:key=>onboardingTargetRegistry.resolveTargetDatabase(key),
})
