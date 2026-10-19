import {
  requireSpaceverseTenantRuntime,
  SpaceverseRuntimeError
} from './spaceverse-runtime-manifest.js';

const CANONICAL_BIGINT_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export const SPACEVERSE_VERIFIED_CUSTOMER_BINDING_SQL = `verified_binding AS (
  SELECT runtime_key,company_id,venue_id
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
)`;

export const SPACEVERSE_CUSTOMER_WALLET_SQL = `WITH ${SPACEVERSE_VERIFIED_CUSTOMER_BINDING_SQL}, owned_customer AS (
  SELECT
    ownership.user_id::text AS ownership_user_id,
    ownership.runtime_key AS ownership_runtime_key,
    ownership.company_id AS ownership_company_id,
    ownership.venue_id AS ownership_venue_id,
    customer.id::text AS user_id,
    customer.username,
    customer.first_name,
    customer.last_name,
    customer.photo_url,
    customer.role,
    wallet.balance::text AS wallet_balance,
    wallet.updated_at AS wallet_updated_at
  FROM verified_binding AS binding
  JOIN spaceverse_customer_ownership AS ownership
    ON ownership.runtime_key=binding.runtime_key
   AND ownership.company_id=binding.company_id
   AND ownership.venue_id=binding.venue_id
  JOIN users AS customer
    ON customer.id=ownership.user_id
   AND customer.deleted_at IS NULL
   AND customer.merged_into_user_id IS NULL
   AND customer.role='client'
  LEFT JOIN wallets AS wallet ON wallet.user_id=customer.id
  WHERE ownership.user_id=$6::bigint
  LIMIT 1
)
SELECT
  EXISTS(SELECT 1 FROM verified_binding) AS binding_verified,
  owned_customer.*
FROM (SELECT TRUE) AS one
LEFT JOIN owned_customer ON TRUE`;

function normalizeUserId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new TypeError('userId must be a canonical positive bigint identifier');
  }
  const normalized = String(value ?? '').trim();
  if (!CANONICAL_BIGINT_PATTERN.test(normalized) || BigInt(normalized) > MAX_SIGNED_BIGINT) {
    throw new TypeError('userId must be a canonical positive bigint identifier');
  }
  return normalized;
}

function runtimeReadFailure(code, message) {
  return new SpaceverseRuntimeError(code, message);
}

/**
 * Read-only customer/wallet boundary for a verified SPACEVERSE runtime.
 *
 * A user row is not ownership proof. The same statement rechecks the exact
 * runtime binding and reaches users/wallets only through an explicit
 * spaceverse_customer_ownership row. Missing, historical, deleted, merged or
 * non-client rows all resolve to null. Request data may select only the
 * canonical user id; tenant, venue and runtime scope remain server-owned.
 *
 * Tenant auth/wallet HTTP uses this repository only behind the existing
 * startup guard; tenant startup remains blocked while it is not provisioned.
 */
export function createSpaceverseCustomerWalletRepository({ query, runtime } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);

  return async function loadSpaceverseCustomerWallet(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('SPACEVERSE customer lookup options must be an object');
    }
    const unsupported = Object.keys(options).filter((field) => field !== 'userId');
    if (unsupported.length) {
      throw runtimeReadFailure(
        'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN',
        'SPACEVERSE tenant scope cannot be supplied by a request.'
      );
    }

    const userId = normalizeUserId(options.userId);
    const binding = verifiedRuntime.binding;
    const params = [
      binding.runtimeKey,
      binding.manifestSha256,
      binding.manifestRevision,
      verifiedRuntime.context.tenantId,
      verifiedRuntime.context.locationId,
      userId
    ];

    let result;
    try {
      result = await query(SPACEVERSE_CUSTOMER_WALLET_SQL, params);
    } catch {
      throw runtimeReadFailure(
        'SPACEVERSE_CUSTOMER_WALLET_READ_UNAVAILABLE',
        'SPACEVERSE customer wallet read is unavailable.'
      );
    }
    if (!result || !Array.isArray(result.rows) || result.rows.length !== 1) {
      throw runtimeReadFailure(
        'SPACEVERSE_CUSTOMER_WALLET_READ_INVALID_RESULT',
        'SPACEVERSE customer wallet read returned an invalid result.'
      );
    }

    const row = result.rows[0];
    if (row.binding_verified !== true) {
      throw runtimeReadFailure(
        'SPACEVERSE_CUSTOMER_WALLET_READ_REJECTED',
        'SPACEVERSE customer wallet read did not match the verified runtime binding.'
      );
    }
    if (row.user_id === null || row.user_id === undefined) return null;

    if (String(row.user_id) !== userId
      || String(row.ownership_user_id) !== userId
      || row.ownership_runtime_key !== binding.runtimeKey
      || row.ownership_company_id !== verifiedRuntime.context.tenantId
      || row.ownership_venue_id !== verifiedRuntime.context.locationId) {
      throw runtimeReadFailure(
        'SPACEVERSE_CUSTOMER_WALLET_READ_SCOPE_MISMATCH',
        'SPACEVERSE customer wallet read returned an unexpected scope.'
      );
    }

    let wallet = null;
    if (row.wallet_balance !== null && row.wallet_balance !== undefined) {
      const balance = String(row.wallet_balance);
      if (!/^\d+$/.test(balance) || row.wallet_updated_at === null || row.wallet_updated_at === undefined) {
        throw runtimeReadFailure(
          'SPACEVERSE_CUSTOMER_WALLET_READ_INVALID_RESULT',
          'SPACEVERSE customer wallet read returned an invalid result.'
        );
      }
      wallet = Object.freeze({ balance, updatedAt: row.wallet_updated_at });
    }

    return Object.freeze({
      customer: Object.freeze({
        id: userId,
        username: row.username ?? null,
        firstName: row.first_name ?? null,
        lastName: row.last_name ?? null,
        photoUrl: row.photo_url ?? null,
        role: row.role
      }),
      wallet
    });
  };
}

export const customerWalletRepositoryContract = Object.freeze({
  appliesTo: 'explicitly-owned-tenant-customers-only',
  ownershipTable: 'spaceverse_customer_ownership',
  sourceTables: Object.freeze([
    'spaceverse_runtime_binding',
    'spaceverse_customer_ownership',
    'users',
    'wallets'
  ]),
  requiredMigration: '019_spaceverse_customer_ownership.sql',
  ownershipBackfill: false,
  runtimeBindingRecheckedInRead: true,
  runtimeRequestScopeAccepted: false,
  fallbackToLegacyUsers: false,
  productionWiringEnabled: false
});
