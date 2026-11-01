import crypto from 'node:crypto';
import { requireSpaceverseTenantRuntime } from './spaceverse-runtime-manifest.js';
import { MARKETING_CHANNELS } from './marketing-consent-policy.js';

const CANONICAL_ID = /^[1-9][0-9]{0,18}$/;
const MAX_ID = 9223372036854775807n;
const SAFE_KEY = /^[a-zA-Z0-9:_-]{1,128}$/;
const SHA = /^[a-f0-9]{64}$/;
const SURFACE = Object.freeze({telegram:'telegram_mini_app',vk:'vk_mini_app'});
const failure = code => Object.assign(new Error('Marketing consent operation denied.'), {code});
const canonical = id => {
  if (typeof id !== 'string' || !CANONICAL_ID.test(id) || BigInt(id)>MAX_ID) throw new TypeError('Invalid verified identity');
  return id;
};

export const MARKETING_CONSENT_LOCK_SQL = `SELECT o.user_id::text AS user_id,i.id::text AS identity_id
FROM spaceverse_runtime_binding b
JOIN spaceverse_customer_ownership o
  ON o.runtime_key=b.runtime_key AND o.company_id=b.company_id AND o.venue_id=b.venue_id
JOIN users u ON u.id=o.user_id AND u.role='client'
  AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL
JOIN user_identities i ON i.user_id=u.id AND i.provider=$7 AND i.provider_user_id=$8
WHERE b.singleton=TRUE AND b.runtime_key=$1 AND b.manifest_sha256=$2
 AND b.manifest_revision=$3 AND b.company_id=$4 AND b.venue_id=$5
 AND b.isolation_policy='dedicated_database' AND b.status='prepared'
 AND o.user_id=$6::bigint
FOR UPDATE OF o`;

export const MARKETING_CONSENT_REPLAY_SQL = `SELECT event_id::text AS event_id,action,provider_identity_id,
consent_text_version,consent_text_sha256,source_surface,explicit_opt_in,request_id
FROM spaceverse_marketing_consent_events
WHERE user_id=$1::bigint AND runtime_key=$2 AND company_id=$3 AND venue_id=$4
 AND channel=$5 AND purpose='marketing' AND idempotency_key=$6 LIMIT 2`;

export const MARKETING_CONSENT_APPEND_SQL = `INSERT INTO spaceverse_marketing_consent_events(
event_id,user_id,runtime_key,company_id,venue_id,channel,purpose,action,
provider_identity_id,consent_text_version,consent_text_sha256,source_surface,
authenticated_actor_user_id,explicit_opt_in,request_id,idempotency_key
) VALUES($1::uuid,$2::bigint,$3,$4,$5,$6,'marketing',$7,$8,$9,$10,$11,$2::bigint,$12,$13,$14)`;

export const MARKETING_CONSENT_HEAD_SQL = `INSERT INTO spaceverse_marketing_consent_heads(
user_id,runtime_key,company_id,venue_id,channel,purpose,latest_event_id
) VALUES($1::bigint,$2,$3,$4,$5,'marketing',$6::uuid)
ON CONFLICT(user_id,runtime_key,company_id,venue_id,channel,purpose)
DO UPDATE SET latest_event_id=EXCLUDED.latest_event_id`;

/** UNMOUNTED transactional consent writer; no provider calls.
 * The caller MUST derive userId/providerUserId from the authenticated session,
 * and explicitActionConfirmed from an explicit confirmed action for the current
 * server-approved text. No browser-provided scope or legacy flag is accepted.
 * An owner-row FOR UPDATE lock serializes all channels for this customer,
 * including the first grant and a concurrent revoke.
 */
export function createSpaceverseMarketingConsentWriter({runtime,pool,approvedCopies}={}) {
  const verified=requireSpaceverseTenantRuntime(runtime);
  if (!pool || typeof pool.connect!=='function') throw new TypeError('Transactional pool required');
  const copies={};
  for (const channel of MARKETING_CHANNELS) {
    const c=approvedCopies?.[channel];
    if (!c || typeof c.version!=='string' || !SAFE_KEY.test(c.version)
      || typeof c.sha256!=='string' || !SHA.test(c.sha256))
      throw new TypeError('Approved consent text required for both channels');
    copies[channel]=Object.freeze({version:c.version,sha256:c.sha256});
  }
  const b=verified.binding;
  const scope=Object.freeze([b.runtimeKey,b.manifestSha256,b.manifestRevision,
    verified.context.tenantId,verified.context.locationId]);

  return async function recordMarketingConsent(options={}) {
    if (!options || typeof options!=='object' || Array.isArray(options)
      || Object.keys(options).some(k=>![
        'userId','providerUserId','channel','action','requestId','idempotencyKey','explicitActionConfirmed'
      ].includes(k))) throw new TypeError('Request scope is not permitted');
    const userId=canonical(options.userId),providerUserId=canonical(options.providerUserId);
    const {channel,action,requestId,idempotencyKey}=options;
    if (!MARKETING_CHANNELS.includes(channel) || !['grant','revoke'].includes(action))
      throw new TypeError('Unsupported consent channel/action');
    if (typeof requestId!=='string' || typeof idempotencyKey!=='string'
      || !SAFE_KEY.test(requestId) || !SAFE_KEY.test(idempotencyKey))
      throw new TypeError('Valid server request identifiers required');
    if (action==='grant' && options.explicitActionConfirmed!==true)
      throw failure('CONSENT_EXPLICIT_ACTION_REQUIRED');
    const version=action==='grant'?copies[channel].version:null;
    const digest=action==='grant'?copies[channel].sha256:null;
    let client,open=false;
    try {
      client=await pool.connect();
      if (!client || typeof client.query!=='function' || typeof client.release!=='function')
        throw failure('CONSENT_RECORD_UNAVAILABLE');
      await client.query('BEGIN');open=true;
      const own=await client.query(MARKETING_CONSENT_LOCK_SQL,
        [...scope,userId,channel,providerUserId]);
      if (!own || own.rows?.length!==1 || own.rows[0].user_id!==userId
        || !CANONICAL_ID.test(own.rows[0].identity_id??'')) throw failure('CONSENT_SCOPE_DENIED');
      const identityId=own.rows[0].identity_id;
      const prev=await client.query(MARKETING_CONSENT_REPLAY_SQL,
        [userId,scope[0],scope[3],scope[4],channel,idempotencyKey]);
      if (!Array.isArray(prev?.rows) || prev.rows.length>1)
        throw failure('CONSENT_RECORD_UNAVAILABLE');
      if (prev.rows.length===1) {
        const x=prev.rows[0];
        if (x.action!==action || x.provider_identity_id!==identityId
          || x.consent_text_version!==version || x.consent_text_sha256!==digest
          || x.source_surface!==SURFACE[channel] || x.explicit_opt_in!==(action==='grant')
          || x.request_id!==requestId) throw failure('CONSENT_IDEMPOTENCY_CONFLICT');
        await client.query('COMMIT');open=false;
        return Object.freeze({status:'replayed',eventId:x.event_id});
      }
      const eventId=crypto.randomUUID();
      await client.query(MARKETING_CONSENT_APPEND_SQL,
        [eventId,userId,scope[0],scope[3],scope[4],channel,action,identityId,
          version,digest,SURFACE[channel],action==='grant',requestId,idempotencyKey]);
      await client.query(MARKETING_CONSENT_HEAD_SQL,
        [userId,scope[0],scope[3],scope[4],channel,eventId]);
      await client.query('COMMIT');open=false;
      return Object.freeze({status:'recorded',eventId});
    } catch(error) {
      if (open) await client?.query('ROLLBACK').catch(()=>{});
      if (['CONSENT_SCOPE_DENIED','CONSENT_IDEMPOTENCY_CONFLICT',
        'CONSENT_EXPLICIT_ACTION_REQUIRED'].includes(error?.code)) throw error;
      throw failure('CONSENT_RECORD_UNAVAILABLE');
    } finally {client?.release?.();}
  };
}
