import { validateRuntimeConfig } from './config.js'
import { closePool, pool } from './db.js'
import { hashPassword, validatePasswordPolicy } from './security.js'

const STAGING_PROJECT_ID='472996fe-c85d-4bda-bb72-2c96f7e5030f'
const STAGING_SERVICE_ID='c9441ae5-7fe9-4030-9b61-3cd8238f94f3'

function requireStagingSeed(){
  if(process.env.ADMIN_ALLOW_TEST_SEED!=='true')throw new Error('Set ADMIN_ALLOW_TEST_SEED=true on an isolated staging database.')
  if(process.env.RAILWAY_PROJECT_ID!==STAGING_PROJECT_ID||process.env.RAILWAY_SERVICE_ID!==STAGING_SERVICE_ID){
    throw new Error('Synthetic seed refused outside the isolated Admin staging service.')
  }
  const passwords={
    super:String(process.env.ADMIN_STAGING_SUPER_PASSWORD||''),
    pivnik:String(process.env.ADMIN_STAGING_PIVNIK_PASSWORD||''),
    north:String(process.env.ADMIN_STAGING_NORTH_PASSWORD||''),
  }
  for(const value of Object.values(passwords))validatePasswordPolicy(value)
  return passwords
}

async function main(){
  validateRuntimeConfig()
  const passwords=requireStagingSeed()
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const pivnikCompany=await client.query<{id:string}>(`
      INSERT INTO companies(code,name) VALUES('pivnik','ПИВНИК TEST')
      ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,active=TRUE,updated_at=NOW()
      RETURNING id::text
    `)
    const pivnikCompanyId=pivnikCompany.rows[0]!.id
    const pivnikVenue=await client.query<{id:string}>(`
      UPDATE venues SET name='ПИВНИК TEST VENUE',address='Synthetic staging venue A',active=TRUE,updated_at=NOW()
      WHERE company_id=$1::bigint AND code='pivnik' RETURNING id::text
    `,[pivnikCompanyId])
    if(!pivnikVenue.rowCount)throw new Error('PIVNIK staging venue was not created by migration 001.')

    const northCompany=await client.query<{id:string}>(`
      INSERT INTO companies(code,name) VALUES('north-hospitality','NORTH HOSPITALITY')
      ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,active=TRUE,updated_at=NOW()
      RETURNING id::text
    `)
    const northCompanyId=northCompany.rows[0]!.id
    const northBar=await client.query<{id:string}>(`SELECT id::text FROM bars WHERE code='north-bar'`)
    if(!northBar.rowCount)throw new Error('NORTH staging legacy bar is missing.')
    const northVenue=await client.query<{id:string}>(`
      INSERT INTO venues(company_id,code,name,address,legacy_bar_id)
      VALUES($1::bigint,'north-bar','NORTH BAR','Synthetic staging venue B',$2::bigint)
      ON CONFLICT(company_id,code) DO UPDATE
      SET name=EXCLUDED.name,address=EXCLUDED.address,legacy_bar_id=EXCLUDED.legacy_bar_id,active=TRUE,updated_at=NOW()
      RETURNING id::text
    `,[northCompanyId,northBar.rows[0]!.id])

    const accounts=[
      {email:'super-admin@pivnik.test',name:'Platform Owner',role:'SUPER_ADMIN',password:passwords.super,companyId:null},
      {email:'venue-admin-a@pivnik.test',name:'ПИВНИК TEST Owner',role:'VENUE_ADMIN',password:passwords.pivnik,companyId:pivnikCompanyId},
      {email:'venue-admin-b@pivnik.test',name:'NORTH HOSPITALITY Owner',role:'VENUE_ADMIN',password:passwords.north,companyId:northCompanyId},
    ] as const
    for(const account of accounts){
      const saved=await client.query<{id:string}>(`
        INSERT INTO admin_accounts(email,display_name,role,password_hash)
        VALUES($1,$2,$3,$4)
        ON CONFLICT((LOWER(email))) DO UPDATE
        SET display_name=EXCLUDED.display_name,role=EXCLUDED.role,password_hash=EXCLUDED.password_hash,active=TRUE,updated_at=NOW()
        RETURNING id::text
      `,[account.email,account.name,account.role,hashPassword(account.password)])
      if(account.companyId){
        await client.query(`
          INSERT INTO admin_company_access(admin_id,company_id,access_kind)
          VALUES($1::bigint,$2::bigint,'owner')
          ON CONFLICT(admin_id,company_id) DO UPDATE SET access_kind='owner'
        `,[saved.rows[0]!.id,account.companyId])
      }
    }

    for(const venueId of [pivnikVenue.rows[0]!.id,northVenue.rows[0]!.id]){
      await client.query(`
        INSERT INTO venue_settings(
          venue_id,base_cashback_percent,registration_bonus,referral_bonus,wheel_enabled,
          shop_enabled,achievements_enabled,referrals_enabled,promotions_enabled,branding_enabled,branding
        ) VALUES($1::bigint,5,100,100,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,$2::jsonb)
        ON CONFLICT(venue_id) DO NOTHING
      `,[venueId,JSON.stringify({accent:'#b9ff66',theme:'premium-dark'})])
      await client.query(`
        INSERT INTO loyalty_levels(venue_id,code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order)
        VALUES
          ($1::bigint,'start','Старт',0,5,0,TRUE,0),
          ($1::bigint,'regular','Постоянный гость',500000,7,0,TRUE,1),
          ($1::bigint,'vip','VIP',1500000,10,0,TRUE,2)
        ON CONFLICT(venue_id,code) DO NOTHING
      `,[venueId])
      await client.query(`
        INSERT INTO wheel_configs(venue_id,enabled,cooldown_minutes,retry_cost)
        VALUES($1::bigint,TRUE,1440,50) ON CONFLICT(venue_id) DO NOTHING
      `,[venueId])
      await client.query(`
        INSERT INTO wheel_prizes(venue_id,code,title,reward_type,reward_value,probability_ppb,inventory_limit,enabled,sort_order)
        VALUES
          ($1::bigint,'bonus-5','5 бонусов','bonus','{"amount":5}'::jsonb,600000000,NULL,TRUE,0),
          ($1::bigint,'bonus-50','50 бонусов','bonus','{"amount":50}'::jsonb,399999900,NULL,TRUE,1),
          ($1::bigint,'rare','Редкий приз','item','{"code":"rare"}'::jsonb,100,1,TRUE,2)
        ON CONFLICT(venue_id,code) DO NOTHING
      `,[venueId])
      await client.query(`
        INSERT INTO achievement_configs(venue_id,code,title,description,condition_type,threshold_value,reward_value,enabled,sort_order)
        VALUES($1::bigint,'welcome','Добро пожаловать','Первое достижение','manual',1,'{"bonus":25}'::jsonb,TRUE,0)
        ON CONFLICT(venue_id,code) DO NOTHING
      `,[venueId])
      await client.query(`
        INSERT INTO shop_item_configs(venue_id,code,title,description,category,reward_type,reward_value,bonus_price,stock,purchase_limit,enabled,sort_order)
        VALUES
          ($1::bigint,'test-frame','Тестовая рамка','Synthetic staging item','digital','frame','{"code":"test-frame"}'::jsonb,300,5,1,TRUE,0),
          ($1::bigint,'disabled-item','Недоступный товар','Synthetic disabled item','other','item','{}'::jsonb,100,0,1,FALSE,1)
        ON CONFLICT(venue_id,code) DO NOTHING
      `,[venueId])
      await client.query(`
        INSERT INTO promotion_configs(venue_id,code,title,description,starts_at,ends_at,mechanic,reward,enabled,sort_order)
        VALUES
          ($1::bigint,'active-test','Активная акция','Synthetic active promotion',NOW()-INTERVAL '1 day',NOW()+INTERVAL '1 day','{}'::jsonb,'{}'::jsonb,TRUE,0),
          ($1::bigint,'draft-test','Черновик','Synthetic draft promotion',NULL,NULL,'{}'::jsonb,'{}'::jsonb,FALSE,1)
        ON CONFLICT(venue_id,code) DO NOTHING
      `,[venueId])
    }

    await client.query(`
      INSERT INTO admin_audit_log(admin_role,company_id,venue_id,action,entity_type,entity_id,reason,metadata)
      VALUES
        ('SUPER_ADMIN',$1::bigint,$2::bigint,'staging.seed','venue',$2::text,'Synthetic staging seed','{"synthetic":true}'::jsonb),
        ('SUPER_ADMIN',$3::bigint,$4::bigint,'staging.seed','venue',$4::text,'Synthetic staging seed','{"synthetic":true}'::jsonb)
    `,[pivnikCompanyId,pivnikVenue.rows[0]!.id,northCompanyId,northVenue.rows[0]!.id])
    await client.query('COMMIT')
    console.log('STAGING_SEED PASS: PIVNIK TEST and NORTH HOSPITALITY tenants are ready.')
  }catch(error){
    await client.query('ROLLBACK').catch(()=>undefined)
    throw error
  }finally{
    client.release()
  }
}

main().then(closePool).catch(async error=>{
  console.error(error instanceof Error?error.message:error)
  await closePool().catch(()=>undefined)
  process.exitCode=1
})
