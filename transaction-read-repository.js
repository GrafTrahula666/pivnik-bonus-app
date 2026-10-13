import { buildTransactionReadPredicate, createMigrationGatedTransactionReadScope } from './transaction-read-scope.js';

export function boundedPage({ limit = 50, offset = 0 } = {}) {
  limit = Number(limit); offset = Number(offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    throw Object.assign(new TypeError('Некорректная страница.'), { statusCode: 400 });
  }
  return { limit, offset };
}

export function createTransactionReadRepository({ query, scopedReadsEnabled = false }) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const resolve = createMigrationGatedTransactionReadScope({ scopedReadsEnabled });
  function where(options, filters = {}) {
    const scope = resolve(options);
    const predicate = buildTransactionReadPredicate(scope);
    const clauses = predicate.sql ? [predicate.sql] : [];
    const params = [...predicate.params];
    // Identifiers are fixed here, never accepted from a caller.
    for (const [key, column] of [['customerId', 'client_id'], ['transactionId', 'id'], ['requestKey', 'request_key']]) {
      if (filters[key] == null) continue;
      const value = String(filters[key]).trim();
      if (!value) throw new TypeError(`${key} is required`);
      params.push(value); clauses.push(`t.${column} = $${params.length}`);
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }
  return Object.freeze({
    async list(options = {}, filters = {}) {
      const scoped = where(options, filters);
      const { limit, offset } = boundedPage(filters);
      const result = await query(`SELECT t.id, t.client_id, t.staff_id, t.mode, t.status,
        t.check_amount_cents, t.cash_paid_cents, t.bonus_earned, t.bonus_spent,
        t.reason, t.reward_code, t.created_at, t.completed_at, t.cancelled_at,
        t.cancelled_by, t.cancel_reason
        FROM transactions t ${scoped.sql}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${scoped.params.length + 1} OFFSET $${scoped.params.length + 2}`,
      [...scoped.params, limit + 1, offset]);
      return { rows: result.rows.slice(0, limit), hasMore: result.rows.length > limit, offset, limit };
    },
    async findByRequestKeyForUpdate(requestKey, options = {}) {
      if (!requestKey) throw new TypeError('requestKey is required');
      const scoped = where(options, { requestKey });
      const result = await query(`SELECT t.* FROM transactions t ${scoped.sql} FOR UPDATE`, scoped.params);
      return result.rows[0] ?? null;
    },
    async summary(options = {}, { customerId } = {}) {
      const scoped = where(options, { customerId });
      const result = await query(`SELECT
        COUNT(*)::int AS operations,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem'))::int AS purchases,
        COUNT(DISTINCT (t.created_at AT TIME ZONE 'Europe/Moscow')::date)
          FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem'))::int AS purchase_days,
        COALESCE(SUM(t.cash_paid_cents) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')),0)::bigint AS spent_cents,
        COALESCE(SUM(t.bonus_earned) FILTER (WHERE t.status = 'completed'),0)::bigint AS earned,
        COALESCE(SUM(t.bonus_spent) FILTER (WHERE t.status = 'completed'),0)::bigint AS redeemed,
        MAX(t.created_at) AS last_operation_at,
        MIN(t.created_at) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')) AS first_purchase_at,
        MAX(t.created_at) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')) AS last_purchase_at,
        COALESCE(MAX(t.check_amount_cents) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')),0)::bigint AS max_check_cents,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.mode = 'redeem')::int AS redemptions,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.mode = 'shop')::int AS shop_purchases,
        COALESCE(SUM(t.beer_ml) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')),0)::bigint AS paid_beer_ml
        FROM transactions t ${scoped.sql}`, scoped.params);
      return result.rows[0];
    }
  });
}
