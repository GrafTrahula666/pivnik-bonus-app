import process from 'node:process'
import { config } from './config.js'
import { pool, readPool, writePool } from './db.js'
import { broadcastConfigured } from './pivnik-broadcast.js'

// Owner-only technical view: what is running, how the databases are doing, which switches are on,
// and the last server errors. Read-only; secrets are never returned, only whether they are set.

const startedAt=new Date()
interface ServerError {at:string;method:string;path:string;code:string;message:string}
const recentErrors:ServerError[]=[]
export function rememberServerError(method:string,path:string,error:unknown):void {
  const e=error as {code?:string;message?:string}
  recentErrors.unshift({at:new Date().toISOString(),method,path:path.replace(/\/\d{3,}(?=\/|$)/g,'/:id').slice(0,160),
    code:String(e?.code||'INTERNAL_ERROR').slice(0,60),message:String(e?.message||'').slice(0,300)})
  recentErrors.length=Math.min(recentErrors.length,50)
}

async function probe<T>(fn:()=>Promise<T>):Promise<{ok:true;value:T;ms:number}|{ok:false;error:string;ms:number}> {
  const t=Date.now()
  try{return {ok:true,value:await fn(),ms:Date.now()-t}}
  catch(error){return {ok:false,error:String((error as Error)?.message||error).slice(0,200),ms:Date.now()-t}}
}

async function databaseInfo(db:typeof pool){
  const size=await db.query<{name:string;bytes:string;version:string;connections:number}>(
    `SELECT current_database() AS name,pg_database_size(current_database())::bigint AS bytes,
            current_setting('server_version') AS version,
            (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname=current_database()) AS connections`)
  const tables=await db.query<{table:string;rows:string;bytes:string}>(
    `SELECT c.relname AS table,GREATEST(c.reltuples,0)::bigint AS rows,pg_total_relation_size(c.oid)::bigint AS bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`)
  const row=size.rows[0]!
  return {name:row.name,bytes:Number(row.bytes),version:row.version,connections:row.connections,
    tables:tables.rows.map(t=>({table:t.table,rows:Number(t.rows),bytes:Number(t.bytes)}))}
}

async function guestApp(){
  if(!config.pivnikAppUrl) throw new Error('PIVNIK_APP_URL не задан')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try{
    const r=await fetch(`${config.pivnikAppUrl}/api/health`,{signal:controller.signal})
    const body=await r.json().catch(()=>({})) as Record<string,unknown>
    if(!r.ok) throw new Error(`HTTP ${r.status}`)
    return {release:typeof body.releaseCommit==='string'?body.releaseCommit.slice(0,7):null,database:String(body.database||'ok')}
  }finally{clearTimeout(timer)}
}

export async function getDeveloperOverview(){
  const env=process.env
  const [metadataDb,productionDb,writer,app]=await Promise.all([
    probe(()=>databaseInfo(pool)),
    probe(()=>databaseInfo(readPool)),
    probe(async()=>{if(!writePool)throw new Error('не настроен');await writePool.query('SELECT 1');return true}),
    probe(guestApp),
  ])
  const audit=await probe(async()=>(await pool.query<{action:string;at:string;admin:string|null}>(
    `SELECT l.action,l.created_at AS at,a.display_name AS admin FROM admin_audit_log l LEFT JOIN admin_accounts a ON a.id=l.admin_id
     ORDER BY l.id DESC LIMIT 15`)).rows)
  const memory=process.memoryUsage()
  return {
    service:{
      startedAt:startedAt.toISOString(),uptimeSeconds:Math.round(process.uptime()),node:process.version,
      memoryMb:Math.round(memory.rss/1048576),heapMb:Math.round(memory.heapUsed/1048576),
      commit:String(env.RAILWAY_GIT_COMMIT_SHA||'').slice(0,7)||null,commitMessage:String(env.RAILWAY_GIT_COMMIT_MESSAGE||'').split('\n')[0]!.slice(0,140)||null,
      branch:env.RAILWAY_GIT_BRANCH||null,environment:env.RAILWAY_ENVIRONMENT_NAME||config.nodeEnv,service:env.RAILWAY_SERVICE_NAME||null,
      region:env.RAILWAY_REPLICA_REGION||null,
    },
    databases:{metadata:metadataDb,production:productionDb,writer},
    guestApp:{url:config.pivnikAppUrl||null,...app},
    switches:[
      {key:'ADMIN_ENABLE_WRITES',label:'Изменения из панели',on:config.enableWrites},
      {key:'ADMIN_ENABLE_PRODUCTION_BONUS_WRITES',label:'Начисление и списание бонусов',on:config.enableProductionBonusWrites},
      {key:'ADMIN_ENABLE_PRODUCTION_ACHIEVEMENT_WRITES',label:'Выдача достижений',on:config.enableProductionAchievementWrites},
      {key:'ADMIN_ENABLE_PRODUCTION_ENTITLEMENT_WRITES',label:'Выдача рамок и товаров',on:config.enableProductionEntitlementWrites},
      {key:'ADMIN_DEMO_ENABLED',label:'Демо-версия',on:config.demoEnabled},
      {key:'BUSINESS_INTERNAL_TOKEN + PIVNIK_APP_URL',label:'Рассылки через приложение',on:broadcastConfigured()},
      {key:'ADMIN_PRODUCTION_WRITE_DATABASE_URL',label:'Подключение для записи в базу приложения',on:Boolean(config.productionWriteDatabaseUrl)},
    ],
    recentErrors:recentErrors.slice(0,30),
    recentActions:audit.ok?audit.value:[],
  }
}
