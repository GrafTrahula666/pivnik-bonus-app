export interface SpaceverseApplicationConfig {
  displayName: string
  theme: 'premium-dark' | 'dark' | 'light'
  primaryColor: string
  secondaryColor: string
  shopEnabled: boolean
  loyaltyEnabled: boolean
}

export interface SpaceverseRuntimeManifest {
  schemaVersion: 2
  runtimeKey: string
  source: {
    kind: 'onboarding'
    draftId: string
    draftRevision: number
    applicationRevision: number
    scopeRevision: 1
  }
  scope: {
    companyId: string
    venueId: string
  }
  application: SpaceverseApplicationConfig & {
    template: 'standard'
    qrEnabled: true
  }
  isolation: {
    policy: 'dedicated_database'
    legacyDataAccess: false
  }
  release: {
    runtimeStatus: 'not_provisioned'
    published: false
  }
  manifestSha256: string
}

export interface SpaceverseRuntimeBinding {
  runtimeKey: string
  manifestSha256: string
  manifestRevision: number
  companyId: string
  venueId: string
  isolationPolicy: 'dedicated_database'
  status: 'prepared'
}

export type SpaceverseResolvedRuntime =
  | { mode: 'legacy-pivnik'; manifest: null; binding: null; context: null; startAllowed: true }
  | {
      mode: 'tenant'
      manifest: SpaceverseRuntimeManifest
      binding: SpaceverseRuntimeBinding
      context: SpaceverseTenantContext
      startAllowed: false
    }

export interface SpaceverseTenantContext {
  companyId: string
  venueId: string
  tenantId: string
  locationId: string
}

export const SPACEVERSE_RUNTIME_BINDING_SQL: string

export class SpaceverseRuntimeError extends Error {
  code: string
}

export function createSpaceverseRuntimeManifest(input: {
  draftId: string
  runtimeKey: string
  draftRevision: number
  applicationRevision: number
  scopeRevision: 1
  scope: { companyId: string; venueId: string }
  config: SpaceverseApplicationConfig
}): SpaceverseRuntimeManifest

export function parseSpaceverseRuntimeManifest(raw: string | unknown): SpaceverseRuntimeManifest

export function runtimeManifestFromEnvironment(environment?: Record<string, string | undefined>):
  | { mode: 'legacy-pivnik'; manifest: null }
  | { mode: 'tenant'; manifest: SpaceverseRuntimeManifest }

export function resolveSpaceverseRuntime(options?: {
  environment?: Record<string, string | undefined>
  query?: (text: string, params?: unknown[]) => Promise<unknown>
}): Promise<SpaceverseResolvedRuntime>

export function requireSpaceverseTenantRuntime(runtime: SpaceverseResolvedRuntime):
  Extract<SpaceverseResolvedRuntime, { mode: 'tenant' }>

export function requireSpaceverseTenantContext(runtime: SpaceverseResolvedRuntime): SpaceverseTenantContext

export function assertSpaceverseRuntimeStartAllowed(runtime: SpaceverseResolvedRuntime): SpaceverseResolvedRuntime

export function guardSpaceverseRuntimeStartup(options?: {
  environment?: Record<string, string | undefined>
  query?: (text: string, params?: unknown[]) => Promise<unknown>
}): Promise<SpaceverseResolvedRuntime>
