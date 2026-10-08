import { config, validateRuntimeConfig } from './config.js'
import { closePool, pool } from './db.js'
import { hashPassword, normalizeEmail, validatePasswordPolicy } from './security.js'
import type { AdminRole } from './types.js'

async function main(){
  validateRuntimeConfig()
  if(!config.allowMigrations)throw new Error('Bootstrap protected by ADMIN_ALLOW_MIGRATIONS=true.')
  const email=normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL),password=String(process.env.ADMIN_BOOTSTRAP_PASSWORD||'')
  const displayName=String(process.env.ADMIN_BOOTSTRAP_NAME||'').trim(),role=String(process.env.ADMIN_BOOTSTRAP_ROLE||'SUPER_ADMIN') as AdminRole
  const companyCode=String(process.env.ADMIN_BOOTSTRAP_COMPANY||'pivnik').trim().toLowerCase()
  const accessKind=String(process.env.ADMIN_BOOTSTRAP_ACCESS_KIND||'owner').trim().toLowerCase()
  if(!email.includes('@')||!displayName)throw new Error('Bootstrap email/name required.')
  if(!['SUPER_ADMIN','VENUE_ADMIN'].includes(role))throw new Error('Invalid role.')
  validatePasswordPolicy(password)
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const passwordHash=hashPassword(password)
    const account=await client.query<{id:string}>(`INSERT INTO admin_accounts(email,display_name,role,password_hash)
      VALUES($1,$2,$3,$4)
      ON CONFLICT((LOWER(email))) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,password_hash=EXCLUDED.password_hash,active=TRUE,updated_at=NOW()
      RETURNING id::text`,[email,displayName,role,passwordHash])
    const adminId=account.rows[0]!.id
    if(role==='VENUE_ADMIN'){
      const company=await client.query<{id:string}>(`SELECT id::text FROM companies WHERE code=$1 AND active=TRUE`,[companyCode])
      if(!company.rowCount)throw new Error(`Company not found: ${companyCode}`)
      const companyId=company.rows[0]!.id
      const count=await client.query<{count:string}>(`SELECT COUNT(DISTINCT aca.admin_id)::bigint AS count FROM admin_company_access aca
        JOIN admin_accounts aa ON aa.id=aca.admin_id WHERE aca.company_id=$1::bigint AND aa.active=TRUE AND aa.role='VENUE_ADMIN' AND aca.admin_id<>$2::bigint`,[companyId,adminId])
      if(Number(count.rows[0]!.count)>=2)throw new Error('MVP limit: owner + one trusted VENUE_ADMIN only.')
      await client.query(`INSERT INTO admin_company_access(admin_id,company_id,access_kind) VALUES($1::bigint,$2::bigint,$3)
        ON CONFLICT(admin_id,company_id) DO UPDATE SET access_kind=EXCLUDED.access_kind`,[adminId,companyId,accessKind])
    }
    await client.query(`INSERT INTO admin_audit_log(admin_id,admin_role,action,entity_type,entity_id,after_value,reason,metadata)
      VALUES($1::bigint,$2,'admin.bootstrap','admin_account',$1::text,$3::jsonb,'CLI bootstrap',$4::jsonb)`,
      [adminId,role,JSON.stringify({email,displayName,role,active:true}),JSON.stringify({passwordNeverLogged:true})])
    await client.query('COMMIT');console.log(`Admin account ready: ${email} (${role}).`)
  }catch(e){await client.query('ROLLBACK').catch(()=>undefined);throw e}finally{client.release()}
}
main().then(closePool).catch(async e=>{console.error(e instanceof Error?e.message:e);await closePool().catch(()=>undefined);process.exitCode=1})
