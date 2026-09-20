function normalizeUserId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id)) throw new TypeError('userId must be a positive integer identifier');
  return id;
}

/**
 * Read-only Customer 360 projection for the admin CRM.
 * Financial KPIs deliberately use completed sales only. Adjustments, rewards,
 * gifts and cancelled operations remain in the activity history but never
 * inflate revenue, visit frequency or average check.
 */
export function createCustomer360Repository({ query }) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');

  return async function loadCustomer360(userId, { historyLimit = 30 } = {}) {
    const id = normalizeUserId(userId);
    const limit = Math.max(5, Math.min(100, Number.parseInt(String(historyLimit), 10) || 30));

    const profileResult = await query(`
      SELECT
        u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.role,
        u.created_at, u.qr_short_code, u.marketing_opt_in,
        w.balance,
        COALESCE(bl.paid_ml_total, 0)::bigint AS paid_ml_total,
        COALESCE(bl.gift_ml_balance, 0)::bigint AS gift_ml_balance,
        COUNT(*) FILTER (
          WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
        )::int AS visits,
        MAX(t.created_at) FILTER (
          WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
        ) AS last_visit_at,
        COALESCE(SUM(t.check_amount_cents) FILTER (
          WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
        ), 0)::bigint AS lifetime_check_cents,
        COALESCE(AVG(t.check_amount_cents) FILTER (
          WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
        ), 0)::numeric AS average_check_cents,
        COALESCE(SUM(t.bonus_earned) FILTER (WHERE t.status = 'completed'), 0)::bigint AS bonus_earned,
        COALESCE(SUM(t.bonus_spent) FILTER (WHERE t.status = 'completed'), 0)::bigint AS bonus_spent,
        COUNT(*) FILTER (
          WHERE t.status = 'completed'
            AND t.mode IN ('accrue','redeem')
            AND t.created_at >= NOW() - INTERVAL '30 days'
        )::int AS visits_30d,
        COALESCE(SUM(t.check_amount_cents) FILTER (
          WHERE t.status = 'completed'
            AND t.mode IN ('accrue','redeem')
            AND t.created_at >= NOW() - INTERVAL '30 days'
        ), 0)::bigint AS spend_30d_cents
      FROM users u
      JOIN wallets w ON w.user_id = u.id
      LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
      LEFT JOIN transactions t ON t.client_id = u.id
      WHERE u.id = $1::bigint
        AND u.merged_into_user_id IS NULL
        AND u.deleted_at IS NULL
      GROUP BY u.id, u.telegram_id, u.username, u.first_name, u.last_name,
               u.role, u.created_at, u.qr_short_code, u.marketing_opt_in,
               w.balance, bl.paid_ml_total, bl.gift_ml_balance
    `, [id]);

    if (!profileResult?.rows?.length) return null;
    if (profileResult.rows.length !== 1) throw new Error('Customer 360 profile query returned multiple rows');

    const historyResult = await query(`
      SELECT
        t.id, t.mode, t.status, t.check_amount_cents, t.cash_paid_cents,
        t.bonus_earned, t.bonus_spent, t.balance_after, t.reason,
        t.is_suspicious, t.cancelled_at, t.cancel_reason, t.created_at,
        CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name
      FROM transactions t
      LEFT JOIN users s ON s.id = t.staff_id
      WHERE t.client_id = $1::bigint
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $2
    `, [id, limit]);

    const row = profileResult.rows[0];
    const visits = Number(row.visits || 0);
    const lifetimeCheckCents = Number(row.lifetime_check_cents || 0);
    const createdAtMs = Date.parse(row.created_at || '');
    const accountAgeDays = Number.isFinite(createdAtMs)
      ? Math.max(1, Math.ceil((Date.now() - createdAtMs) / 86_400_000))
      : null;
    const frequency30d = accountAgeDays
      ? Number((visits / Math.max(1, accountAgeDays / 30)).toFixed(2))
      : 0;

    return Object.freeze({
      id: String(row.id),
      telegramId: row.telegram_id == null ? null : String(row.telegram_id),
      username: row.username || null,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      role: row.role,
      createdAt: row.created_at,
      qrShortCode: row.qr_short_code || null,
      marketingOptIn: row.marketing_opt_in === true,
      balance: Number(row.balance || 0),
      beerPaidMlTotal: Number(row.paid_ml_total || 0),
      beerGiftMlBalance: Number(row.gift_ml_balance || 0),
      metrics: Object.freeze({
        visits,
        visits30d: Number(row.visits_30d || 0),
        lastVisitAt: row.last_visit_at || null,
        lifetimeCheckCents,
        averageCheckCents: Math.round(Number(row.average_check_cents || 0)),
        spend30dCents: Number(row.spend_30d_cents || 0),
        bonusEarned: Number(row.bonus_earned || 0),
        bonusSpent: Number(row.bonus_spent || 0),
        frequency30d
      }),
      history: Object.freeze((historyResult?.rows || []).map((item) => Object.freeze({ ...item })))
    });
  };
}
