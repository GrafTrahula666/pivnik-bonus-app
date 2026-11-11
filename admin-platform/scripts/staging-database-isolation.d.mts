// Type declarations for the staging-only runtime gate shared by TypeScript
// seed scripts and Node ESM commands. Keep these signatures in sync with .mjs.
export declare const STAGING_PROJECT_ID: string
export declare const STAGING_SERVICE_ID: string
export declare function assertStagingDatabaseIsolation(env?: NodeJS.ProcessEnv): string
export declare function approvedStagingIntegrationDatabaseUrl(env?: NodeJS.ProcessEnv): string
