import type { SpaceverseResolvedRuntime } from './spaceverse-runtime-manifest.js'
import type { SpaceverseCustomerWallet } from './customer-wallet-repository.js'

export interface SpaceverseCustomerDirectoryQuery {
  q?:string;limit?:number;offset?:number
  sort?:'id'|'name'|'username';direction?:'asc'|'desc';wallet?:'all'|'present'|'missing'
}
export interface SpaceverseCustomerDirectory {
  readonly q:string
  readonly total:string
  readonly limit:number
  readonly offset:number
  readonly sort:'id'|'name'|'username'
  readonly direction:'asc'|'desc'
  readonly wallet:'all'|'present'|'missing'
  readonly hasMore:boolean
  readonly items:readonly SpaceverseCustomerWallet[]
}
export function createSpaceverseCustomerDirectoryRepository(options:{
  query:(text:string,params?:unknown[])=>Promise<unknown>
  runtime:SpaceverseResolvedRuntime
}):(options?:SpaceverseCustomerDirectoryQuery)=>Promise<SpaceverseCustomerDirectory>
