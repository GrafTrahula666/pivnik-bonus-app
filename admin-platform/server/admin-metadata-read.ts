import { pool, readPool } from './db.js'
import type { VenueScope } from './types.js'

function boundedLimit(value:unknown,fallback=100,minimum=1,maximum=200):number{
  const parsed=Number(value)
  if(!Number.isFinite(parsed)) return fallback
  return Math.min(maximum,Math.max(minimum,Math.trunc(parsed)))
}

const unavailable=(reason:string)=>({value:null,available:false,reason})
const noActivity='В production БД нет отдельного события открытия приложения/визита; метрика не вычисляется по косвенным признакам.'

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

export async function getAdminPlatformSummary(){
  const metadata=await pool.query<{
    company_id:string
    company_code:string
    company_name:string
    venue_id:string|null
    venue_code:string|null
    venue_name:string|null
    legacy_bar_id:string|null
  }>(
    `SELECT
       c.id::text AS company_id,c.code AS company_code,c.name AS company_name,
       v.id::text AS venue_id,v.code AS venue_code,v.name AS venue_name,v.legacy_bar_id::text
     FROM companies c
     LEFT JOIN venues v ON v.company_id=c.id AND v.active=TRUE
     WHERE c.active=TRUE
     ORDER BY c.name,v.name`,
  )
  const barIds=[...new Set(metadata.rows.map(row=>row.legacy_bar_id).filter((id):id is string=>Boolean(id)))]
  const counts=new Map<string,number>()
  if(barIds.length){
    const production=await readPool.query<{bar_id:string;customers:string}>(
      `SELECT bc.bar_id::text AS bar_id,COUNT(DISTINCT u.id)::bigint::text AS customers
       FROM bar_customers bc
       JOIN users u ON u.id=bc.user_id
       WHERE bc.bar_id=ANY($1::bigint[])
         AND bc.status='active'
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
         AND u.role='client'
       GROUP BY bc.bar_id`,
      [barIds],
    )
    for(const row of production.rows) counts.set(row.bar_id,Number(row.customers||0))
  }
  return {
    companies:metadata.rows.map(row=>({...row,customers:row.legacy_bar_id?counts.get(row.legacy_bar_id)||0:0})),
    metrics:{
      dau:unavailable(noActivity),
      wau:unavailable(noActivity),
      mau:unavailable(noActivity),
    },
  }
}
