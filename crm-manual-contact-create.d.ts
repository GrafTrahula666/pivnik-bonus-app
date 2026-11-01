import type {PoolClient} from 'pg'
import type {SpaceverseResolvedRuntime} from './spaceverse-runtime-manifest.js'

export interface SpaceverseManualContactInput {
  requestKey:string
  contact:{
    firstName:string
    lastName?:string|null
    phone?:string|null
    email?:string|null
  }
}
export interface SpaceverseManualContactResult {
  contact:{
    id:string
    firstName:string
    lastName:string|null
    phone:string|null
    email:string|null
    identityStatus:'unlinked'
    walletStatus:'not_created'
  }
  requestKey:string
}
export function validateSpaceverseManualCrmContactInput(raw:unknown):Readonly<SpaceverseManualContactInput>
export function createSpaceverseManualCrmContactService(options:{
  connect:()=>Promise<Pick<PoolClient,'query'|'release'>>
  runtime:SpaceverseResolvedRuntime
  actorId:string
}): (raw:unknown)=>Promise<SpaceverseManualContactResult>
