import { pool } from './db.js'
import type { VenueScope } from './types.js'

function boundedLimit(value:unknown,fallback=100,minimum=1,maximum=200):number{
  const parsed=Number(value)
  if(!Number.isFinite(parsed)) return fallback
  return Math.min(maximum,Math.max(minimum,Math.trunc(parsed)))
}

export async function getAdminAudit(scope:VenueScope|null,limit=100){
  const safeLimit=boundedLimit(limit)
  const params:Array<string|number>=[safeLimit]
  let tenantClause=''
  if(scope){
    params.push(scope.companyId)
    tenantClause='WHERE al.company_id=$2::bigint'
  }
  const result=await pool.query(
    `SELECT
       al.id::text,al.action,al.entity_type,al.entity_id,
       al.before_value,al.after_value,al.reason,al.admin_role,al.metadata,al.created_at,
       aa.display_name AS admin_name,aa.email AS admin_email,
       c.name AS company_name,v.name AS venue_name
     FROM admin_audit_log al
     LEFT JOIN admin_accounts aa ON aa.id=al.admin_id
     LEFT JOIN companies c ON c.id=al.company_id
     LEFT JOIN venues v ON v.id=al.venue_id
     ${tenantClause}
     ORDER BY al.created_at DESC
     LIMIT $1`,
    params,
  )
  return {rows:result.rows}
}
