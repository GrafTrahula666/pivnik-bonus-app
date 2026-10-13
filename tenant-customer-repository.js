import { requireSpaceverseTenantRuntime, SpaceverseRuntimeError } from './spaceverse-runtime-manifest.js';

function runtimeReadFailure(code, message) {
  return new SpaceverseRuntimeError(code, message);
}

/**
 * Read-only tenant/venue-scoped customer listing, bound to the exact runtime
 * that was verified against `spaceverse_runtime_binding` (migrations
 * 017/018). This is the SPACEVERSE-local `spaceverse_tenant_customers` table
 * (migration 019) only: it never reads PIVNIK's historical `users`/`wallets`
 * tables, which have no approved tenant attribution.
 *
 * The caller cannot supply or override tenant/venue scope: the SELECT itself
 * re-checks the binding row (runtime key, checksum, revision, company/venue,
 * isolation policy, status) against the dedicated database being queried, so
 * a verified runtime object cannot be paired with another tenant's database
 * to read its rows. This mirrors the re-check pattern already used by the
 * SPACEVERSE transaction write boundary (transaction-persistence.js).
 *
 * Deliberately unwired into production/HTTP until tenant startup itself is
 * allowed (`runtime.startAllowed`).
 */
export function createSpaceverseTenantCustomerRepository({ query, runtime } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);
  const binding = verifiedRuntime.binding;

  return async function listSpaceverseTenantCustomers(...requestScope) {
    if (requestScope.length !== 0) {
      throw runtimeReadFailure(
        'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN',
        'SPACEVERSE tenant scope cannot be supplied by a request.'
      );
    }

    const sql = `SELECT customers.id, customers.external_ref, customers.wallet_balance,
       customers.created_at, customers.updated_at
FROM spaceverse_tenant_customers AS customers
JOIN spaceverse_runtime_binding AS binding
  ON binding.singleton = TRUE
 AND binding.runtime_key = $1
 AND binding.manifest_sha256 = $2
 AND binding.manifest_revision = $3
 AND binding.company_id = $4
 AND binding.venue_id = $5
 AND binding.isolation_policy = 'dedicated_database'
 AND binding.status = 'prepared'
WHERE customers.company_id = binding.company_id
  AND customers.venue_id = binding.venue_id
ORDER BY customers.id`;

    const values = [
      binding.runtimeKey,
      binding.manifestSha256,
      binding.manifestRevision,
      verifiedRuntime.context.tenantId,
      verifiedRuntime.context.locationId
    ];

    let result;
    try {
      result = await query(sql, values);
    } catch {
      throw runtimeReadFailure(
        'SPACEVERSE_TENANT_CUSTOMERS_READ_UNAVAILABLE',
        'SPACEVERSE tenant customer read is unavailable.'
      );
    }
    if (!result || !Array.isArray(result.rows)) {
      throw runtimeReadFailure(
        'SPACEVERSE_TENANT_CUSTOMERS_READ_INVALID_RESULT',
        'SPACEVERSE tenant customer read returned an invalid result.'
      );
    }

    for (const row of result.rows) {
      if (String(row.company_id ?? verifiedRuntime.context.tenantId) !== verifiedRuntime.context.tenantId
        || String(row.venue_id ?? verifiedRuntime.context.locationId) !== verifiedRuntime.context.locationId) {
        throw runtimeReadFailure(
          'SPACEVERSE_TENANT_CUSTOMERS_READ_SCOPE_MISMATCH',
          'SPACEVERSE tenant customer read returned an unexpected scope.'
        );
      }
    }

    return Object.freeze(result.rows.map((row) => Object.freeze({ ...row })));
  };
}

export const tenantCustomerRepositoryContract = Object.freeze({
  appliesTo: 'spaceverse-tenant-customers-only',
  table: 'spaceverse_tenant_customers',
  touchesLegacyUsersOrWallets: false,
  readOnly: true,
  requestScopeAllowed: false,
  productionWiringEnabled: false
});
