import type { PoolClient } from 'pg'
import { pool } from './db.js'
import type { AdminPrincipal, VenueScope } from './types.js'

export interface AuditInput {
  admin: AdminPrincipal
  scope?: VenueScope | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  reason?: string | null
  metadata?: Record<string, unknown>
}
export function auditValues(input:AuditInput):unknown[] {
  return [
    input.admin.id,input.admin.role,input.scope?.companyId??null,input.scope?.id??null,
    input.action,input.entityType,input.entityId??null,
    input.before===undefined?null:JSON.stringify(input.before),
    input.after===undefined?null:JSON.stringify(input.after),
    input.reason??null,JSON.stringify(input.metadata||{})
  ]
}
export async function recordAudit(input:AuditInput, client?:PoolClient):Promise<void>{
  const db=client||pool
  await db.query(
    `INSERT INTO admin_audit_log(
      admin_id,admin_role,company_id,venue_id,action,entity_type,entity_id,
      before_value,after_value,reason,metadata
    ) VALUES($1::bigint,$2,$3::bigint,$4::bigint,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11::jsonb)`,
    auditValues(input),
  )
}
