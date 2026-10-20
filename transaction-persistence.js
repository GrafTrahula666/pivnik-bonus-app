import { resolveTransactionAttribution } from './transaction-attribution.js';
import {
  requireSpaceverseTenantRuntime,
  SpaceverseRuntimeError
} from './spaceverse-runtime-manifest.js';

const TRANSACTION_MODES = new Set([
  'accrue',
  'redeem',
  'adjustment',
  'beer_gift',
  'welcome',
  'shop',
  'achievement'
]);

const WRITABLE_COLUMNS = Object.freeze([
  'request_key',
  'client_id',
  'staff_id',
  'mode',
  'status',
  'check_amount_cents',
  'discount_cents',
  'bonus_spent',
  'bonus_earned',
  'cash_paid_cents',
  'balance_after',
  'reason',
  'reward_code',
  'expires_at',
  'completed_at',
  'is_suspicious',
  'beer_ml',
  'beer_gift_earned_ml',
  'beer_gift_spent_ml'
]);

function normalizeTransaction(transaction) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) {
    throw new TypeError('transaction must be an object');
  }

  const unknown = Object.keys(transaction).filter((column) => !WRITABLE_COLUMNS.includes(column));
  if (unknown.length) {
    throw new TypeError(`Unsupported transaction column: ${unknown[0]}`);
  }

  const mode = String(transaction.mode || '').trim();
  if (!TRANSACTION_MODES.has(mode)) {
    throw new TypeError(`Unsupported transaction mode: ${mode || '<empty>'}`);
  }

  if (transaction.client_id === null || transaction.client_id === undefined || transaction.client_id === '') {
    throw new TypeError('transaction.client_id is required');
  }

  return Object.freeze({ ...transaction, mode });
}

function runtimeWriteFailure(code, message) {
  return new SpaceverseRuntimeError(code, message);
}

function buildSpaceverseRuntimeInsert({ transaction, runtime }) {
  const columns = [];
  const values = [];
  for (const column of WRITABLE_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(transaction, column)) continue;
    columns.push(column);
    values.push(transaction[column]);
  }

  const businessPlaceholders = values.map((_, index) => `$${index + 1}`);
  const bindingOffset = values.length;
  const binding = runtime.binding;
  values.push(
    binding.runtimeKey,
    binding.manifestSha256,
    binding.manifestRevision,
    runtime.context.tenantId,
    runtime.context.locationId
  );

  const bindingPlaceholders = Object.freeze({
    runtimeKey: `$${bindingOffset + 1}`,
    manifestSha256: `$${bindingOffset + 2}`,
    manifestRevision: `$${bindingOffset + 3}`,
    tenantId: `$${bindingOffset + 4}`,
    locationId: `$${bindingOffset + 5}`
  });
  const replayChecks = [...columns, 'tenant_id', 'location_id']
    .map((column) => `transactions.${column} IS NOT DISTINCT FROM EXCLUDED.${column}`)
    .join('\n    AND ');
  const sql = `INSERT INTO transactions (${[...columns, 'tenant_id', 'location_id'].join(', ')})
SELECT ${[...businessPlaceholders, 'binding.company_id', 'binding.venue_id'].join(', ')}
FROM spaceverse_runtime_binding AS binding
WHERE binding.singleton=TRUE
  AND binding.runtime_key=${bindingPlaceholders.runtimeKey}
  AND binding.manifest_sha256=${bindingPlaceholders.manifestSha256}
  AND binding.manifest_revision=${bindingPlaceholders.manifestRevision}
  AND binding.company_id=${bindingPlaceholders.tenantId}
  AND binding.venue_id=${bindingPlaceholders.locationId}
  AND binding.isolation_policy='dedicated_database'
  AND binding.status='prepared'
ON CONFLICT (request_key) DO UPDATE SET request_key=EXCLUDED.request_key
  WHERE ${replayChecks}
RETURNING *`;

  return Object.freeze({ sql, values: Object.freeze(values) });
}

/**
 * Persistence boundary for NEW SPACEVERSE-attributed transactions.
 *
 * It deliberately cannot infer tenant/location from legacy user roles or from
 * historical transactions. The caller supplies an authorization context plus
 * an explicit target tenant/location. SQL identifiers come only from the fixed
 * allow-list above; all values are parameterized.
 *
 * This helper is not wired into production until the additive attribution
 * migration is deliberately applied and verified.
 */
export function createScopedTransactionPersistence({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function insertNewTransaction({
    authorizationContext,
    tenantId,
    locationId,
    transaction
  } = {}) {
    const attribution = resolveTransactionAttribution({
      authorizationContext,
      tenantId,
      locationId
    });
    const normalized = normalizeTransaction(transaction);

    const columns = [];
    const values = [];
    for (const column of WRITABLE_COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(normalized, column)) continue;
      columns.push(column);
      values.push(normalized[column]);
    }

    columns.push('tenant_id', 'location_id');
    values.push(attribution.tenantId, attribution.locationId);

    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const sql = `INSERT INTO transactions (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const result = await query(sql, values);

    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('transaction insert must resolve to an object with rows[]');
    }
    if (result.rows.length !== 1) {
      throw new Error(`transaction insert must return exactly one row, received ${result.rows.length}`);
    }

    return Object.freeze({ ...result.rows[0] });
  };
}

/**
 * Tenant-runtime write boundary for NEW transactions.
 *
 * Scope is captured from the exact runtime object branded by the dedicated-DB
 * binding check. The INSERT rechecks that binding in the same SQL statement,
 * so a verified context cannot be paired with another tenant database. The
 * caller may supply only transaction data; tenant/location and authorization
 * fields from a request are rejected before SQL. request_key makes an exact
 * retry return the original row, while a conflicting payload or scope fails
 * closed with no legacy INSERT fallback.
 *
 * This boundary remains unwired until migration 009 and the tenant runtime are
 * deliberately provisioned in an isolated environment.
 */
export function createSpaceverseTransactionPersistence({ query, runtime } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);

  return async function persistSpaceverseTransaction(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('SPACEVERSE transaction options must be an object');
    }
    const unsupported = Object.keys(options).filter((field) => field !== 'transaction');
    if (unsupported.length) {
      throw runtimeWriteFailure(
        'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN',
        'SPACEVERSE tenant scope cannot be supplied by a request.'
      );
    }

    const transaction = normalizeTransaction(options.transaction);
    const requestKey = typeof transaction.request_key === 'string'
      ? transaction.request_key.trim()
      : '';
    if (!requestKey) {
      throw new TypeError('SPACEVERSE transaction persistence requires request_key');
    }
    const normalized = requestKey === transaction.request_key
      ? transaction
      : Object.freeze({ ...transaction, request_key: requestKey });
    const statement = buildSpaceverseRuntimeInsert({ transaction: normalized, runtime: verifiedRuntime });

    let result;
    try {
      result = await query(statement.sql, [...statement.values]);
    } catch {
      throw runtimeWriteFailure(
        'SPACEVERSE_TRANSACTION_WRITE_UNAVAILABLE',
        'SPACEVERSE transaction write is unavailable; retry with the same request key.'
      );
    }
    if (!result || !Array.isArray(result.rows)) {
      throw runtimeWriteFailure(
        'SPACEVERSE_TRANSACTION_WRITE_INVALID_RESULT',
        'SPACEVERSE transaction write returned an invalid result.'
      );
    }
    if (result.rows.length !== 1) {
      throw runtimeWriteFailure(
        'SPACEVERSE_TRANSACTION_WRITE_REJECTED',
        'SPACEVERSE transaction write did not match the verified runtime binding or replay payload.'
      );
    }
    const row = result.rows[0];
    if (String(row.tenant_id) !== verifiedRuntime.context.tenantId
      || String(row.location_id) !== verifiedRuntime.context.locationId
      || String(row.request_key) !== requestKey) {
      throw runtimeWriteFailure(
        'SPACEVERSE_TRANSACTION_WRITE_SCOPE_MISMATCH',
        'SPACEVERSE transaction write returned an unexpected scope.'
      );
    }
    return Object.freeze({ ...row });
  };
}

export const transactionPersistenceContract = Object.freeze({
  appliesTo: 'new-transactions-only',
  table: 'transactions',
  modes: Object.freeze([...TRANSACTION_MODES]),
  writableColumns: WRITABLE_COLUMNS,
  requiredScopeColumns: Object.freeze(['tenant_id', 'location_id']),
  parameterizedValuesOnly: true,
  historicalBackfill: false,
  productionWiringEnabled: false,
  runtimeBindingRecheckedInWrite: true,
  runtimeRequestScopeAccepted: false,
  runtimeReplayKey: 'request_key',
  runtimeFallbackToLegacy: false
});
