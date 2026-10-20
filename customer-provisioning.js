import crypto from 'node:crypto';

import {
  requireSpaceverseTenantRuntime,
  SpaceverseRuntimeError
} from './spaceverse-runtime-manifest.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_BIGINT_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const PROVIDERS = new Set(['telegram', 'vk']);
const CUSTOMER_FIELDS = Object.freeze([
  'provider',
  'providerUserId',
  'username',
  'firstName',
  'lastName',
  'photoUrl'
]);

export const SPACEVERSE_CUSTOMER_BINDING_LOCK_SQL = `SELECT
  runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
FROM spaceverse_runtime_binding
WHERE singleton=TRUE
  AND runtime_key=$1
  AND manifest_sha256=$2
  AND manifest_revision=$3
  AND company_id=$4
  AND venue_id=$5
  AND isolation_policy='dedicated_database'
  AND status='prepared'
LIMIT 1
FOR SHARE`;

const REQUEST_LOOKUP_SQL = `SELECT
  runtime_key,request_key::text,request_fingerprint,company_id,venue_id,user_id::text,completed_at
FROM spaceverse_customer_create_requests
WHERE runtime_key=$1 AND request_key=$2::uuid
LIMIT 1
FOR UPDATE`;

const IDENTITY_LOOKUP_SQL = `SELECT candidate.user_id::text
FROM (
  SELECT identity.user_id,0 AS source_order
  FROM user_identities AS identity
  WHERE identity.provider=$1 AND identity.provider_user_id=$2
  UNION ALL
  SELECT customer.id AS user_id,1 AS source_order
  FROM users AS customer
  WHERE $1='telegram' AND customer.telegram_id::text=$2
) AS candidate
ORDER BY candidate.source_order
LIMIT 1`;

const INSERT_REQUEST_SQL = `INSERT INTO spaceverse_customer_create_requests(
  runtime_key,request_key,request_fingerprint,company_id,venue_id
) VALUES($1,$2::uuid,$3,$4,$5)`;

const INSERT_CUSTOMER_SQL = `INSERT INTO users(
  telegram_id,username,first_name,last_name,photo_url,role
) VALUES(
  CASE WHEN $1='telegram' THEN $2::bigint ELSE NULL END,
  $3,$4,$5,$6,'client'
)
RETURNING id::text`;

const INSERT_IDENTITY_SQL = `INSERT INTO user_identities(
  user_id,provider,provider_user_id,provider_username
) VALUES($1::bigint,$2,$3,$4)`;

const INSERT_WALLET_SQL = `INSERT INTO wallets(user_id,balance)
VALUES($1::bigint,0)`;

const INSERT_OWNERSHIP_SQL = `INSERT INTO spaceverse_customer_ownership(
  user_id,runtime_key,company_id,venue_id
) VALUES($1::bigint,$2,$3,$4)`;

const COMPLETE_REQUEST_SQL = `UPDATE spaceverse_customer_create_requests
SET user_id=$3::bigint,completed_at=NOW()
WHERE runtime_key=$1 AND request_key=$2::uuid AND user_id IS NULL
RETURNING user_id::text`;

const RESULT_LOOKUP_SQL = `SELECT
  request.runtime_key,
  request.request_key::text,
  request.request_fingerprint,
  request.company_id,
  request.venue_id,
  request.user_id::text,
  request.completed_at,
  customer.role,
  customer.deleted_at,
  customer.merged_into_user_id,
  identity.provider,
  identity.provider_user_id,
  wallet.user_id IS NOT NULL AS wallet_exists,
  ownership.user_id IS NOT NULL AS ownership_exists
FROM spaceverse_customer_create_requests AS request
JOIN users AS customer ON customer.id=request.user_id
JOIN user_identities AS identity ON identity.user_id=customer.id
JOIN wallets AS wallet ON wallet.user_id=customer.id
JOIN spaceverse_customer_ownership AS ownership
  ON ownership.user_id=customer.id
 AND ownership.runtime_key=request.runtime_key
 AND ownership.company_id=request.company_id
 AND ownership.venue_id=request.venue_id
WHERE request.runtime_key=$1
  AND request.request_key=$2::uuid
  AND identity.provider=$3
  AND identity.provider_user_id=$4
LIMIT 1`;

function failure(code, message) {
  return new SpaceverseRuntimeError(code, message);
}

function exactObject(raw, fields, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`${label} must be an object`);
  }
  const unknown = Object.keys(raw).filter((field) => !fields.includes(field));
  if (unknown.length) {
    throw failure(
      'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN',
      'SPACEVERSE tenant scope and unsupported customer fields cannot be supplied by a request.'
    );
  }
  return raw;
}

function safeText(raw, { label, max, required = false } = {}) {
  if (raw === undefined || raw === null) {
    if (required) throw new TypeError(`${label} is required`);
    return null;
  }
  if (typeof raw !== 'string') throw new TypeError(`${label} must be a string`);
  const value = raw.trim();
  if (!value) {
    if (required) throw new TypeError(`${label} is required`);
    return null;
  }
  if (value.length > max || Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point <= 31 || point === 127;
  })) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeProviderUserId(raw) {
  const value = safeText(raw, { label: 'customer.providerUserId', max: 19, required: true });
  if (!CANONICAL_BIGINT_PATTERN.test(value) || BigInt(value) > MAX_SIGNED_BIGINT) {
    throw new TypeError('customer.providerUserId must be a canonical positive identifier');
  }
  return value;
}

function normalizeUsername(raw) {
  const value = safeText(raw, { label: 'customer.username', max: 65 });
  if (value === null) return null;
  const normalized = value.replace(/^@+/, '');
  if (!normalized || normalized.length > 64 || /\s/u.test(normalized)) {
    throw new TypeError('customer.username is invalid');
  }
  return normalized;
}

function normalizePhotoUrl(raw) {
  const value = safeText(raw, { label: 'customer.photoUrl', max: 2048 });
  if (value === null) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('customer.photoUrl must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('customer.photoUrl must be a valid HTTPS URL');
  }
  return url.toString();
}

function normalizeCommand(options) {
  const value = exactObject(options, ['requestKey', 'customer'], 'SPACEVERSE customer provisioning options');
  const requestKey = safeText(value.requestKey, {
    label: 'requestKey', max: 36, required: true
  });
  if (!UUID_V4_PATTERN.test(requestKey)) {
    throw new TypeError('requestKey must be a UUID v4');
  }

  const rawCustomer = exactObject(value.customer, CUSTOMER_FIELDS, 'customer');
  const provider = safeText(rawCustomer.provider, {
    label: 'customer.provider', max: 16, required: true
  });
  if (!PROVIDERS.has(provider)) throw new TypeError('customer.provider is unsupported');
  const customer = Object.freeze({
    provider,
    providerUserId: normalizeProviderUserId(rawCustomer.providerUserId),
    username: normalizeUsername(rawCustomer.username),
    firstName: safeText(rawCustomer.firstName, {
      label: 'customer.firstName', max: 128, required: true
    }),
    lastName: safeText(rawCustomer.lastName, {
      label: 'customer.lastName', max: 128
    }),
    photoUrl: normalizePhotoUrl(rawCustomer.photoUrl)
  });
  const normalizedRequestKey = requestKey.toLowerCase();
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({ requestKey: normalizedRequestKey, customer }))
    .digest('hex');
  return Object.freeze({ requestKey: normalizedRequestKey, customer, fingerprint });
}

function exactSingleRow(result) {
  if (!result || !Array.isArray(result.rows)) return null;
  const rowCount = Number(result.rowCount ?? result.rows.length);
  return rowCount === 1 && result.rows.length === 1 ? result.rows[0] : null;
}

function isUniqueViolation(error) {
  return error?.code === '23505';
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); }
  catch { /* The connection may have failed after a successful COMMIT. */ }
}

function assertBinding(row, runtime) {
  const binding = runtime.binding;
  if (!row
    || row.runtime_key !== binding.runtimeKey
    || row.manifest_sha256 !== binding.manifestSha256
    || Number(row.manifest_revision) !== binding.manifestRevision
    || row.company_id !== runtime.context.tenantId
    || row.venue_id !== runtime.context.locationId
    || row.isolation_policy !== 'dedicated_database'
    || row.status !== 'prepared') {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_REJECTED',
      'SPACEVERSE customer creation did not match the verified runtime binding.'
    );
  }
}

function assertReplay(row, command, runtime) {
  if (row.runtime_key !== runtime.binding.runtimeKey
    || String(row.request_key).toLowerCase() !== command.requestKey
    || row.company_id !== runtime.context.tenantId
    || row.venue_id !== runtime.context.locationId) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_SCOPE_MISMATCH',
      'SPACEVERSE customer creation returned an unexpected scope.'
    );
  }
  if (row.request_fingerprint !== command.fingerprint) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_REPLAY_CONFLICT',
      'SPACEVERSE customer creation request key was already used for different data.'
    );
  }
  if (!row.user_id || !row.completed_at) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_INCOMPLETE',
      'SPACEVERSE customer creation is incomplete and cannot be replayed.'
    );
  }
}

function immutableResult(row, command) {
  return Object.freeze({
    requestKey: command.requestKey,
    customer: Object.freeze({
      id: String(row.user_id),
      provider: command.customer.provider,
      providerUserId: command.customer.providerUserId
    }),
    wallet: Object.freeze({ userId: String(row.user_id) }),
    ownership: Object.freeze({ userId: String(row.user_id) })
  });
}

async function loadCompletedResult(client, command, runtime) {
  const result = await client.query(RESULT_LOOKUP_SQL, [
    runtime.binding.runtimeKey,
    command.requestKey,
    command.customer.provider,
    command.customer.providerUserId
  ]);
  const row = exactSingleRow(result);
  if (!row) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_INVALID_RESULT',
      'SPACEVERSE customer creation returned an invalid result.'
    );
  }
  assertReplay(row, command, runtime);
  if (row.role !== 'client'
    || row.deleted_at !== null
    || row.merged_into_user_id !== null
    || row.provider !== command.customer.provider
    || row.provider_user_id !== command.customer.providerUserId
    || row.wallet_exists !== true
    || row.ownership_exists !== true) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_INVALID_RESULT',
      'SPACEVERSE customer creation returned an invalid result.'
    );
  }
  return immutableResult(row, command);
}

async function provisionInTransaction(client, command, runtime) {
  await client.query('BEGIN');
  const binding = exactSingleRow(await client.query(SPACEVERSE_CUSTOMER_BINDING_LOCK_SQL, [
    runtime.binding.runtimeKey,
    runtime.binding.manifestSha256,
    runtime.binding.manifestRevision,
    runtime.context.tenantId,
    runtime.context.locationId
  ]));
  assertBinding(binding, runtime);

  const existingRequest = exactSingleRow(await client.query(REQUEST_LOOKUP_SQL, [
    runtime.binding.runtimeKey,
    command.requestKey
  ]));
  if (existingRequest) {
    assertReplay(existingRequest, command, runtime);
    const replay = await loadCompletedResult(client, command, runtime);
    await client.query('COMMIT');
    return replay;
  }

  const existingIdentity = exactSingleRow(await client.query(IDENTITY_LOOKUP_SQL, [
    command.customer.provider,
    command.customer.providerUserId
  ]));
  if (existingIdentity) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_IDENTITY_CONFLICT',
      'This provider identity already belongs to an existing customer and was not adopted.'
    );
  }

  await client.query(INSERT_REQUEST_SQL, [
    runtime.binding.runtimeKey,
    command.requestKey,
    command.fingerprint,
    runtime.context.tenantId,
    runtime.context.locationId
  ]);
  const insertedCustomer = exactSingleRow(await client.query(INSERT_CUSTOMER_SQL, [
    command.customer.provider,
    command.customer.providerUserId,
    command.customer.username,
    command.customer.firstName,
    command.customer.lastName,
    command.customer.photoUrl
  ]));
  if (!insertedCustomer?.id) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_INVALID_RESULT',
      'SPACEVERSE customer creation returned an invalid result.'
    );
  }
  const userId = String(insertedCustomer.id);
  await client.query(INSERT_IDENTITY_SQL, [
    userId,
    command.customer.provider,
    command.customer.providerUserId,
    command.customer.username
  ]);
  await client.query(INSERT_WALLET_SQL, [userId]);
  await client.query(INSERT_OWNERSHIP_SQL, [
    userId,
    runtime.binding.runtimeKey,
    runtime.context.tenantId,
    runtime.context.locationId
  ]);
  const completed = exactSingleRow(await client.query(COMPLETE_REQUEST_SQL, [
    runtime.binding.runtimeKey,
    command.requestKey,
    userId
  ]));
  if (String(completed?.user_id ?? '') !== userId) {
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_INVALID_RESULT',
      'SPACEVERSE customer creation returned an invalid result.'
    );
  }
  const created = await loadCompletedResult(client, command, runtime);
  await client.query('COMMIT');
  return created;
}

/**
 * Atomic write boundary for a NEW customer in a dedicated tenant database.
 *
 * It creates the canonical users/user_identities/wallets rows plus explicit
 * tenant ownership in one transaction. The exact runtime binding is locked and
 * rechecked in that transaction. A UUID request key and normalized fingerprint
 * make retries exact; a historical provider identity is rejected rather than
 * attached to the new tenant. No tenant or venue value is accepted from the
 * request. Tenant auth delegates missing-customer writes here, but both
 * production entrypoints remain behind the not_provisioned startup guard.
 */
export function createSpaceverseCustomerProvisioner({ connect, runtime } = {}) {
  if (typeof connect !== 'function') throw new TypeError('connect must be a function');
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);

  return async function provisionSpaceverseCustomer(options = {}) {
    const command = normalizeCommand(options);

    // A single bounded retry resolves a concurrent identical request or turns
    // a concurrent provider-identity claim into an explicit collision. It is
    // never an unbounded external-API retry.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let client;
      try {
        client = await connect();
        if (!client || typeof client.query !== 'function') {
          throw new TypeError('connect must resolve to a database client');
        }
        return await provisionInTransaction(client, command, verifiedRuntime);
      } catch (error) {
        if (client?.query) await rollbackQuietly(client);
        if (error instanceof SpaceverseRuntimeError) throw error;
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw failure(
          'SPACEVERSE_CUSTOMER_PROVISION_UNAVAILABLE',
          'SPACEVERSE customer creation is unavailable; retry with the same request key.'
        );
      } finally {
        try { client?.release?.(); }
        catch { /* Releasing a failed client must not expose driver details. */ }
      }
    }
    throw failure(
      'SPACEVERSE_CUSTOMER_PROVISION_UNAVAILABLE',
      'SPACEVERSE customer creation is unavailable; retry with the same request key.'
    );
  };
}

export const customerProvisioningContract = Object.freeze({
  appliesTo: 'new-tenant-customers-only',
  sourceTables: Object.freeze([
    'spaceverse_runtime_binding',
    'spaceverse_customer_create_requests',
    'users',
    'user_identities',
    'wallets',
    'spaceverse_customer_ownership'
  ]),
  requiredMigrations: Object.freeze([
    '019_spaceverse_customer_ownership.sql',
    '020_spaceverse_customer_create_requests.sql'
  ]),
  providerIdentityAdoption: false,
  historicalBackfill: false,
  runtimeBindingRecheckedInTransaction: true,
  runtimeRequestScopeAccepted: false,
  replayKey: 'requestKey',
  maxConstraintRetries: 1,
  productionWiringEnabled: false
});
