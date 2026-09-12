import { createTransactionReadRepository } from './transaction-read-repository.js';

function normalizeCustomerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError('customerId must be a positive safe integer');
  }
  return id;
}

function safeIntegerOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`${field} must be a safe integer`);
  }
  return number;
}

function nullableIso(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function normalizeTimelineRow(row) {
  return Object.freeze({
    id: safeIntegerOrNull(row.id, 'transaction.id'),
    clientId: safeIntegerOrNull(row.client_id, 'transaction.client_id'),
    staffId: safeIntegerOrNull(row.staff_id, 'transaction.staff_id'),
    mode: row.mode ?? null,
    status: row.status ?? null,
    checkAmountCents: safeIntegerOrNull(row.check_amount_cents, 'transaction.check_amount_cents'),
    cashPaidCents: safeIntegerOrNull(row.cash_paid_cents, 'transaction.cash_paid_cents'),
    bonusEarned: safeIntegerOrNull(row.bonus_earned, 'transaction.bonus_earned'),
    bonusSpent: safeIntegerOrNull(row.bonus_spent, 'transaction.bonus_spent'),
    reason: row.reason ?? null,
    rewardCode: row.reward_code ?? null,
    createdAt: nullableIso(row.created_at, 'transaction.created_at'),
    completedAt: nullableIso(row.completed_at, 'transaction.completed_at'),
    cancelledAt: nullableIso(row.cancelled_at, 'transaction.cancelled_at'),
    cancelledBy: safeIntegerOrNull(row.cancelled_by, 'transaction.cancelled_by'),
    cancelReason: row.cancel_reason ?? null
  });
}

/**
 * Customer 360 transaction timeline.
 *
 * This deliberately delegates SQL and tenant/location authorization to the
 * shared transaction-read repository instead of maintaining a second read
 * implementation. Scoped mode therefore inherits the same migration gate,
 * fail-closed authorization and parameterized predicates.
 */
export function createCustomer360TimelineRead({ query, scopedReadsEnabled = false } = {}) {
  const transactions = createTransactionReadRepository({ query, scopedReadsEnabled });

  return Object.freeze({
    async listCustomerTimeline(customerId, options = {}, page = {}) {
      const normalizedCustomerId = normalizeCustomerId(customerId);
      const result = await transactions.list(options, {
        customerId: normalizedCustomerId,
        limit: page.limit,
        offset: page.offset
      });

      return Object.freeze({
        rows: Object.freeze(result.rows.map(normalizeTimelineRow)),
        hasMore: result.hasMore,
        limit: result.limit,
        offset: result.offset
      });
    }
  });
}

export const customer360TimelineReadContract = Object.freeze({
  readOnly: true,
  source: 'transaction-read-repository',
  defaultMode: 'legacy',
  scopedReadsEnabledByDefault: false,
  migration: '009_spaceverse_tenant_attribution.sql',
  maxPageSize: 100,
  ordering: 'created_at_desc_id_desc',
  scopedFallbackToGlobal: false,
  syntheticEvents: false
});
