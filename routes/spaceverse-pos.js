import crypto from 'node:crypto';
import { requireSpaceverseTenantRuntime,requireSpaceverseTenantContext } from '../spaceverse-runtime-manifest.js';
import { posConnectionStatus } from '../pos/repository.js';
import { POS_ONBOARDING_PROTOCOL,POS_DEVICE_KEY_PATTERN,POS_SYNC_FRESH_MS,signPosOnboardingPacket } from '../pos/onboarding-proxy.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = (statusCode,code,message) => Object.assign(new Error(message), { statusCode,code });
function send(res,status,payload) {
  res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}
async function body(req) {
  let value=req.body;
  if(value===undefined) {
    let source='';
    for await(const chunk of req) {source+=chunk.toString();if(Buffer.byteLength(source)>1024)throw failure(413,'pos_event_too_large','Событие слишком большое.');}
    try{value=JSON.parse(source)}catch{throw failure(400,'pos_event_invalid','Нужно тестовое событие кассы.');}
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2
    ||Object.keys(value).some(key=>!['eventId','kind'].includes(key))||value.kind!=='onboarding_test'
    ||typeof value.eventId!=='string'||!uuid.test(value.eventId))throw failure(400,'pos_event_invalid','Нужно тестовое событие без области и финансовых данных.');
  return value.eventId.toLowerCase();
}

export function createSpaceversePosHttp({runtime,pool}) {
  const verified=requireSpaceverseTenantRuntime(runtime),scope=requireSpaceverseTenantContext(runtime),binding=verified.binding;
  const attempts=new Map();
  return async function handleSpaceversePos(req,res) {
    const url=new URL(req.url||'/','http://localhost');
    if(!['/api/device/pos/onboarding/status','/api/device/pos/onboarding/event'].includes(url.pathname))return false;
    let client;
    try {
      const address=req.socket?.remoteAddress||'unknown',now=Date.now(),previous=attempts.get(address);
      if(previous&&previous.until>now&&previous.count>=100)throw failure(429,'pos_proxy_rate_limit','Повторите проверку через минуту.');
      if(attempts.size>=1000)for(const [id,row] of attempts)if(row.until<=now)attempts.delete(id);
      if(!previous&&attempts.size>=1000)throw failure(429,'pos_proxy_rate_limit','Повторите проверку позже.');
      if(!previous||previous.until<=now)attempts.set(address,{count:1,until:now+60_000});else previous.count++;
      if(['x-tenant-id','x-company-id','x-venue-id','x-location-id','x-runtime-key'].some(key=>req.headers[key]))throw failure(400,'pos_scope_forbidden','Область кассы задаёт сервер.');
      const event=url.pathname.endsWith('/event');
      if(req.method!==(event?'POST':'GET'))throw failure(405,'pos_method_not_allowed','Метод не поддерживается.');
      if([...url.searchParams.keys()].some(key=>key!==(event?'':'challenge'))||(event&&url.search)
        ||(!event&&(url.searchParams.getAll('challenge').length!==1||!uuid.test(url.searchParams.get('challenge')||''))))throw failure(400,'pos_scope_forbidden','Нужна проверка без подмены области.');
      const eventId=event?await body(req):null,key=req.headers['x-pivnik-device-key'];
      if(typeof key!=='string'||!POS_DEVICE_KEY_PATTERN.test(key))throw failure(401,'pos_device_key_required','Нужен X-Pivnik-Device-Key.');
      client=await pool.connect();await client.query('BEGIN');
      const bound=await client.query(`SELECT runtime_key FROM spaceverse_runtime_binding WHERE singleton=TRUE
        AND runtime_key=$1 AND manifest_sha256=$2 AND manifest_revision=$3 AND company_id=$4 AND venue_id=$5
        AND isolation_policy='dedicated_database' AND status='prepared' FOR SHARE`,
      [binding.runtimeKey,binding.manifestSha256,binding.manifestRevision,scope.companyId,scope.venueId]);
      if(!bound.rows.length)throw failure(503,'pos_runtime_binding_changed','Привязка приложения не подтверждена.');
      const device=(await client.query(`SELECT d.id::text,d.store_id,d.external_device_id FROM pos_devices d
        JOIN pos_store_bindings b ON b.store_id=d.store_id WHERE d.token_hash=$1 AND d.revoked_at IS NULL
        AND b.enabled=TRUE AND b.tenant_id=$2 AND b.location_id=$3 FOR SHARE OF d,b`,
      [crypto.createHash('sha256').update(key).digest('hex'),scope.companyId,scope.venueId])).rows[0];
      if(!device)throw failure(401,'pos_device_scope_rejected','Ключ устройства не относится к этой точке или отозван.');
      if(event) {
        await client.query(`INSERT INTO spaceverse_pos_test_events(device_id,event_id,runtime_key,manifest_sha256,company_id,venue_id)
          VALUES($1::uuid,$2::uuid,$3,$4,$5,$6) ON CONFLICT(device_id,event_id) DO NOTHING`,
        [device.id,eventId,binding.runtimeKey,binding.manifestSha256,scope.companyId,scope.venueId]);
        const received=(await client.query(`SELECT event_id::text AS id,received_at::text AS "receivedAt"
          FROM spaceverse_pos_test_events WHERE device_id=$1::uuid AND event_id=$2::uuid
          AND runtime_key=$3 AND manifest_sha256=$4 AND company_id=$5 AND venue_id=$6`,
        [device.id,eventId,binding.runtimeKey,binding.manifestSha256,scope.companyId,scope.venueId])).rows[0];
        if(!received)throw failure(409,'pos_event_scope_changed','Повтор события не относится к текущей версии приложения.');
        await client.query('COMMIT');send(res,200,{accepted:true,event:received});return true;
      }
      const lastEvent=(await client.query(`SELECT event_id::text AS id,received_at::text AS "receivedAt"
        FROM spaceverse_pos_test_events WHERE device_id=$1::uuid AND runtime_key=$2 AND manifest_sha256=$3
        AND company_id=$4 AND venue_id=$5 ORDER BY received_at DESC,event_id DESC LIMIT 1`,
      [device.id,binding.runtimeKey,binding.manifestSha256,scope.companyId,scope.venueId])).rows[0]||null;
      const connection=await posConnectionStatus(client,{enabled:true,readOnly:true,storeId:device.store_id});
      let report={state:'unavailable',empty:null,period:null};
      if(connection.state==='connected'&&connection.historyComplete&&connection.scanUntil
        &&Date.now()-Date.parse(connection.lastSuccessAt)<=POS_SYNC_FRESH_MS
        &&Date.parse(connection.lastSuccessAt)<=Date.now()+2000
        &&Number.isFinite(Date.parse(connection.scanUntil))&&Date.parse(connection.scanUntil)<=Date.now()+2000
        &&Date.now()-Date.parse(connection.scanUntil)<=POS_SYNC_FRESH_MS) {
        const until=new Date(connection.scanUntil).toISOString(),from=new Date(Date.parse(until)-86400_000).toISOString();
        // Presence only. Device keys never expose financial/customer report rows.
        const rows=await client.query(`SELECT EXISTS(SELECT 1 FROM pos_documents WHERE source='evotor'
          AND store_id=$1 AND closed_at>=$2 AND closed_at<$3) AS has_documents`,[device.store_id,from,until]);
        report={state:'available',empty:!rows.rows[0].has_documents,period:{from,until}};
      }
      const packet={protocol:POS_ONBOARDING_PROTOCOL,challenge:url.searchParams.get('challenge'),observedAt:new Date().toISOString(),
        runtime:{key:binding.runtimeKey,checksum:binding.manifestSha256,companyId:scope.companyId,venueId:scope.venueId,status:'not_provisioned'},
        device:{id:device.id,externalId:device.external_device_id,storeId:device.store_id},lastEvent,
        provider:{state:connection.state,lastSuccessAt:connection.lastSuccessAt?new Date(connection.lastSuccessAt).toISOString():null},report};
      await client.query('COMMIT');send(res,200,{...packet,mac:signPosOnboardingPacket(packet,key)});
    }catch(error) {
      await client?.query('ROLLBACK').catch(()=>undefined);
      send(res,error.statusCode||503,{code:error.code==='42P01'?'pos_proxy_schema_missing':error.statusCode?error.code:'pos_proxy_unavailable',
        error:error.statusCode?error.message:'Проверка кассы недоступна. Проверьте ручные миграции и серверное подключение.'});
    }finally{client?.release();}
    return true;
  };
}
