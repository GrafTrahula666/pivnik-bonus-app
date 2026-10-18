import type { Pool } from 'pg'
import { createSpaceverseCustomerWalletRepository } from '../../customer-wallet-repository.js'
import { resolveSpaceverseRuntime } from '../../spaceverse-runtime-manifest.js'
import { config } from './config.js'
import { recordAudit } from './audit.js'
import { pool } from './db.js'
import { onboardingDraftAccessSql } from './onboarding-access.js'
import { onboardingTargetRegistry } from './onboarding-database-registry.js'
import { loadOwnedOnboardingRuntimeSource, requireOnboardingAccess } from './venue-onboarding.js'
import { HttpError, type AdminPrincipal } from './types.js'

type Database = Pick<Pool, 'connect'>
const unavailable = () => new HttpError(503, 'TENANT_CRM_READ_UNAVAILABLE',
  'Не удалось подтвердить клиентский источник заведения. Проверьте подготовку базы и повторите попытку.')

// A preparation diagnostic, not activation. Only the stored, authorized draft
// selects a runtime; neither credentials nor company/venue come from a request.
export function createTenantCrmReadService(options: {
  metadata: Database
  resolveTargetDatabase: (runtimeKey: string) => Promise<Database | null>
}) {
  async function source(admin: AdminPrincipal, draftId: string) {
    const client = await options.metadata.connect()
    try {
      await requireOnboardingAccess(admin, true, client)
      const allowed = await client.query(`SELECT id FROM admin_onboarding_drafts
        WHERE id=$1::uuid AND ${onboardingDraftAccessSql('admin_onboarding_drafts', '$2', true)}`,
      [draftId, admin.id])
      if (!allowed.rows.length) throw new HttpError(404, 'ONBOARDING_DRAFT_NOT_FOUND', 'Черновик не найден или недоступен.')
      return await loadOwnedOnboardingRuntimeSource(client, admin, draftId)
    } finally { client.release() }
  }

  return async function readCustomer(admin: AdminPrincipal, draftId: string, userId: string) {
    if (!config.enableTenantCrmReads) throw new HttpError(403, 'TENANT_CRM_READ_DISABLED', 'Проверка клиентского источника пока выключена.')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId) ||
      !/^[1-9]\d{0,18}$/.test(userId) || BigInt(userId) > 9223372036854775807n) {
      throw new HttpError(400, 'TENANT_CRM_ID_INVALID', 'Некорректный идентификатор черновика или клиента.')
    }
    try {
      const initial = await source(admin, draftId)
      const target = await options.resolveTargetDatabase(initial.manifest.runtimeKey)
      if (!target) throw new HttpError(409, 'TENANT_CRM_SOURCE_NOT_CONFIGURED', 'База заведения ещё не подключена к защищённому реестру.')
      const client = await target.connect()
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const query = (text: string, params?: unknown[]) => client.query(text, params)
        const runtime = await resolveSpaceverseRuntime({ query, environment: {
          SPACEVERSE_RUNTIME_MODE: 'tenant',
          SPACEVERSE_RUNTIME_MANIFEST_JSON: JSON.stringify(initial.manifest),
        } })
        const record = await createSpaceverseCustomerWalletRepository({ query, runtime })({ userId })
        // Revalidate the current grant and frozen source before returning PII.
        const current = await source(admin, draftId)
        if (current.manifest.manifestSha256 !== initial.manifest.manifestSha256) throw unavailable()
        if (!record) throw new HttpError(404, 'TENANT_CRM_CUSTOMER_NOT_FOUND', 'Клиент не найден в этом заведении.')
        const audit = await options.metadata.connect()
        try {
          await recordAudit({ admin, scope: initial.auditScope, action: 'crm.customer_read',
            entityType: 'customer', entityId: userId, metadata: { purpose: 'onboarding_read_diagnostic' } }, audit)
        } finally { audit.release() }
        await client.query('COMMIT')
        return { schemaVersion: 1 as const, scope: initial.manifest.scope,
          readStatus: 'verified' as const, runtimeStatus: 'not_provisioned' as const,
          customer: record.customer, wallet: record.wallet }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally { client.release() }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw unavailable()
    }
  }
}

export const readTenantCrmCustomer = createTenantCrmReadService({ metadata: pool,
  resolveTargetDatabase: runtimeKey => onboardingTargetRegistry.resolveTargetDatabase(runtimeKey) })
