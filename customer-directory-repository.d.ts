import type { SpaceverseResolvedRuntime } from './spaceverse-runtime-manifest.js'
import type { SpaceverseCustomerWallet } from './customer-wallet-repository.js'

export interface SpaceverseCustomerDirectoryQuery {q?:string;limit?:number;offset?:number}
export interface SpaceverseCustomerDirectory {
  readonly q:string
  readonly total:string
  readonly limit:number
  readonly offset:number
  readonly hasMore:boolean
  readonly items:readonly SpaceverseCustomerWallet[]
}
export function createSpaceverseCustomerDirectoryRepository(options:{
  query:(text:string,params?:unknown[])=>Promise<unknown>
  runtime:SpaceverseResolvedRuntime
}):(options?:SpaceverseCustomerDirectoryQuery)=>Promise<SpaceverseCustomerDirectory>
