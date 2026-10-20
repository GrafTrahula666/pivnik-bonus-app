import type { SpaceverseResolvedRuntime } from './spaceverse-runtime-manifest.js'

export interface SpaceverseCustomerWallet {
  readonly customer: {
    readonly id: string
    readonly username: string | null
    readonly firstName: string | null
    readonly lastName: string | null
    readonly photoUrl: string | null
    readonly role: 'client'
  }
  readonly wallet: { readonly balance: string; readonly updatedAt: string | Date } | null
}

export function createSpaceverseCustomerWalletRepository(options: {
  query: (text: string, params?: unknown[]) => Promise<unknown>
  runtime: SpaceverseResolvedRuntime
}): (options: { userId: string }) => Promise<SpaceverseCustomerWallet | null>
