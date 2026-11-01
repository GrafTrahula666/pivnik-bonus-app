import crypto from 'node:crypto';
import { requireSpaceverseTenantRuntime, SpaceverseRuntimeError } from './spaceverse-runtime-manifest.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function failure(code, message) { return new SpaceverseRuntimeError(code, message); }
// Bind the authenticated Admin principal on the server, never from request JSON.
function verifiedActorId(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,18}$/.test(raw) ||
      BigInt(raw) > 9223372036854775807n)
    throw new TypeError('actorId must be a verified Admin principal ID');
  return raw;
}
function exact(raw, keys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !keys.includes(key))) {
    throw failure('SPACEVERSE_CRM_CONTACT_REQUEST_FORBIDDEN', 'Only manual contact fields are allowed.');
  }
  return raw;
}
function name(raw, required, field) {
  if (raw === null || raw === undefined || raw === '') {
    if (required) throw new TypeError(field + ' is required');
    return null;
  }
  if (typeof raw !== 'string') throw new TypeError(field + ' must be a string');
  const value = raw.trim().replace(/\s+/gu, ' ');
  if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/u.test(value))
    throw new TypeError(field + ' is invalid');
  return value;
}
function phone(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new TypeError('phone must be a string');
  const value = raw.replace(/[\s().-]/gu, '');
  if (!PHONE.test(value)) throw new TypeError('phone must use E.164');
  return value;
}
function email(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new TypeError('email must be a string');
  const value = raw.trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) throw new TypeError('email is invalid');
  return value;
}
function command(raw) {
  const input = exact(raw, ['requestKey','contact']);
  if (typeof input.requestKey !== 'string' || !UUID_V4.test(input.requestKey))
    throw new TypeError('requestKey must be UUID v4');
  const fields = exact(input.contact, ['firstName','lastName','phone','email']);
  const contact = Object.freeze({
    firstName: name(fields.firstName, true, 'firstName'),
    lastName: name(fields.lastName, false, 'lastName'),
    phone: phone(fields.phone),
    email: email(fields.email)
  });
  if (!contact.phone && !contact.email)
    throw new TypeError('At least one direct contact channel is required');
  const requestKey = input.requestKey.toLowerCase();
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({requestKey,contact})).digest('hex');
  return Object.freeze({requestKey,contact,fingerprint});
}

// Pure, fail-closed body validation before opening a tenant connection.
// Reuse exactly the same normalization as the transactional writer.
export function validateSpaceverseManualCrmContactInput(raw) {
  const input=command(raw);
  return Object.freeze({requestKey:input.requestKey,contact:input.contact});
}

const LOCK = `SELECT runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
FROM spaceverse_runtime_binding
WHERE singleton=TRUE AND runtime_key=$1 AND manifest_sha256=$2 AND manifest_revision=$3
  AND company_id=$4 AND venue_id=$5 AND isolation_policy='dedicated_database'
  AND status='prepared' LIMIT 1 FOR SHARE`;
const FIND = `SELECT request_key::text,request_fingerprint,contact_id::text,completed_at,
  runtime_key,company_id,venue_id,created_by_admin_id::text
FROM spaceverse_crm_contact_create_requests
WHERE runtime_key=$1 AND request_key=$2::uuid LIMIT 1 FOR UPDATE`;
const CONTACT = `SELECT id::text,first_name,last_name,phone_e164,email_normalized,creation_origin,archived_at
FROM spaceverse_crm_contacts WHERE id=$1::bigint AND runtime_key=$2 AND company_id=$3 AND venue_id=$4`;
const INSERT_REQUEST = `INSERT INTO spaceverse_crm_contact_create_requests
(runtime_key,request_key,request_fingerprint,company_id,venue_id,created_by_admin_id)
VALUES ($1,$2::uuid,$3,$4,$5,$6::bigint)`;
const INSERT_CONTACT = `INSERT INTO spaceverse_crm_contacts
(runtime_key,company_id,venue_id,first_name,last_name,phone_e164,email_normalized)
VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`;
const COMPLETE = `UPDATE spaceverse_crm_contact_create_requests
SET contact_id=$3::bigint, completed_at=NOW()
WHERE runtime_key=$1 AND request_key=$2::uuid AND contact_id IS NULL
RETURNING contact_id::text`;

function one(result) {
  return result && Array.isArray(result.rows) && result.rows.length === 1 ? result.rows[0] : null;
}
function scopeOf(runtime) {
  return [runtime.binding.runtimeKey,runtime.binding.manifestSha256,
    runtime.binding.manifestRevision,runtime.context.tenantId,runtime.context.locationId];
}
function verifyScope(row, runtime) {
  const [key,hash,revision,company,venue] = scopeOf(runtime);
  if (!row || row.runtime_key !== key || row.manifest_sha256 !== hash ||
    Number(row.manifest_revision) !== revision || row.company_id !== company ||
    row.venue_id !== venue || row.isolation_policy !== 'dedicated_database' ||
    row.status !== 'prepared') throw failure('SPACEVERSE_CRM_CONTACT_SCOPE_REJECTED','Contact source is not verified.');
}
function verifyReplay(row, input, runtime, actorId) {
  if (!row || String(row.request_key).toLowerCase() !== input.requestKey ||
    row.runtime_key !== runtime.binding.runtimeKey || row.company_id !== runtime.context.tenantId ||
    row.venue_id !== runtime.context.locationId)
    throw failure('SPACEVERSE_CRM_CONTACT_SCOPE_REJECTED','Contact source is not verified.');
  if (row.created_by_admin_id !== actorId)
    throw failure('SPACEVERSE_CRM_CONTACT_ACTOR_MISMATCH','Request key belongs to another Admin actor.');
  if (row.request_fingerprint !== input.fingerprint)
    throw failure('SPACEVERSE_CRM_CONTACT_REPLAY_CONFLICT','Request key was used for different contact data.');
  if (!row.contact_id || !row.completed_at)
    throw failure('SPACEVERSE_CRM_CONTACT_INCOMPLETE','Contact creation remains unconfirmed.');
}
function result(id, input) {
  return Object.freeze({
    contact: Object.freeze({id,...input.contact,identityStatus:'unlinked',walletStatus:'not_created'}),
    requestKey:input.requestKey
  });
}
async function replay(client, input, runtime, row, actorId) {
  verifyReplay(row,input,runtime,actorId);
  const found=one(await client.query(CONTACT,[row.contact_id,runtime.binding.runtimeKey,runtime.context.tenantId,runtime.context.locationId]));
  if (!found || found.archived_at !== null || found.creation_origin !== 'manual' ||
    found.first_name !== input.contact.firstName || found.last_name !== input.contact.lastName ||
    found.phone_e164 !== input.contact.phone || found.email_normalized !== input.contact.email)
    throw failure('SPACEVERSE_CRM_CONTACT_INVALID_RESULT','Contact replay could not be verified.');
  return result(String(found.id),input);
}
async function createInTransaction(client, input, runtime, actorId) {
  const [key,hash,revision,company,venue]=scopeOf(runtime);
  await client.query('BEGIN');
  verifyScope(one(await client.query(LOCK,[key,hash,revision,company,venue])),runtime);
  const previous=one(await client.query(FIND,[key,input.requestKey]));
  if (previous) {
    const current=await replay(client,input,runtime,previous,actorId);
    await client.query('COMMIT');
    return current;
  }
  await client.query(INSERT_REQUEST,[key,input.requestKey,input.fingerprint,company,venue,actorId]);
  const row=one(await client.query(INSERT_CONTACT,[key,company,venue,
    input.contact.firstName,input.contact.lastName,input.contact.phone,input.contact.email]));
  if (!row?.id) throw failure('SPACEVERSE_CRM_CONTACT_INVALID_RESULT','Contact insert was not confirmed.');
  const completed=one(await client.query(COMPLETE,[key,input.requestKey,row.id]));
  if (String(completed?.contact_id??'')!==String(row.id))
    throw failure('SPACEVERSE_CRM_CONTACT_INVALID_RESULT','Contact request completion was not confirmed.');
  await client.query('COMMIT');
  return result(String(row.id),input);
}

/**
 * UNMOUNTED prepared-tenant write boundary for owner-entered CRM contacts.
 * Never creates/links an authenticated user, provider identity, or wallet.
 * Connecting this to Admin HTTP requires a separate permission+CSRF+audit gate.
 */
export function createSpaceverseManualCrmContactService({connect,runtime,actorId}={}) {
  if (typeof connect !== 'function') throw new TypeError('connect must be a function');
  const actor = verifiedActorId(actorId);
  const trusted = requireSpaceverseTenantRuntime(runtime);
  return async function createManualContact(raw) {
    const input=command(raw);
    for (let attempt=0;attempt<2;attempt++) {
      let client;
      try {
        client=await connect();
        if (!client || typeof client.query !== 'function') throw new TypeError('Invalid database connection');
        return await createInTransaction(client,input,trusted,actor);
      } catch(err) {
        if (client?.query) await client.query('ROLLBACK').catch(()=>undefined);
        if (err instanceof SpaceverseRuntimeError) throw err;
        if (err?.code==='23505') {
          if (['spaceverse_crm_contacts_phone_uq','spaceverse_crm_contacts_email_uq'].includes(err.constraint))
            throw failure('SPACEVERSE_CRM_CONTACT_DUPLICATE','This contact channel already exists at this venue.');
          // Concurrent idempotent request: retry only once, then fail closed.
          if (attempt===0 && (err.constraint==='spaceverse_crm_contact_create_requests_pkey' ||
            err.constraint==='spaceverse_crm_contact_create_requests_runtime_key_request_key_key')) continue;
        }
        throw failure('SPACEVERSE_CRM_CONTACT_UNAVAILABLE','Contact creation could not be confirmed.');
      } finally { try { client?.release?.(); } catch { /* no driver details */ } }
    }
    throw failure('SPACEVERSE_CRM_CONTACT_UNAVAILABLE','Contact creation could not be confirmed.');
  };
}

export const manualCrmContactContract=Object.freeze({
  state:'unmounted',source:'dedicated-tenant-database-only',
  identityLinking:false,createsWallet:false,createsAppUser:false,
  acceptedFields:Object.freeze(['firstName','lastName','phone','email']),
  serverOwnedScope:true,serverOwnedActor:true,idempotency:'UUID v4 + SHA-256 fingerprint',
  requiresExplicitMigration:'002_manual_crm_contacts.sql',
  productionWiringEnabled:false
});
