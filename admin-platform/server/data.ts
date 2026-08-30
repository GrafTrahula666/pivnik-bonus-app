import type { QueryResultRow } from 'pg'
import { productionTableExists, readPool } from './db.js'
import { config } from './config.js'
import { resolvePivnikLegacyStatus } from './legacy-compat.js'
import { HttpError, type PeriodRange, type VenueScope } from './types.js'
import { parsePositiveId } from './tenant.js'

const NO_ACTIVITY_EVENTS =
  'В production БД нет отдельного события открытия приложения/визита; метрика не вычисляется по косвенным признакам.'

export function parsePeriod(url: URL): PeriodRange {
  const fromRaw = url.searchParams.get('from')
  const toRaw = url.searchParams.get('to')
  if (fromRaw || toRaw) {
    if (!fromRaw || !toRaw) {
      throw new HttpError(400, 'INVALID_PERIOD', 'Для своего периода нужны from и to.')
    }
    const from = new Date(fromRaw)
    const to = new Date(toRaw)
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
      throw new HttpError(400, 'INVALID_PERIOD', 'Некорректный период.')
    }
    const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000)
    if (days > 366) throw new HttpError(400, 'PERIOD_TOO_LARGE', 'Максимальный период — 366 дней.')
    return { from, to, days }
  }
  const daysRaw = Number(url.searchParams.get('days') || 30)
  const allowed = new Set([1, 7, 30, 90, 365])
  const days = allowed.has(daysRaw) ? daysRaw : 30
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  return { from, to, days }
}

function centsToRubles(cents: unknown): number {
  return Number(cents || 0) / 100
}

function numeric(value: unknown): number {
  return Number(value || 0)
}

function boundedInt(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)))
}

function unavailable(reason: string) {
  return { value: null, available: false, reason }
}

function available<T>(value: T, source: string) {
  return { value, available: true, source }
}

async function requireLegacyBar(scope: VenueScope): Promise<string> {
  if (scope.companyCode !== 'pivnik') {
    throw new HttpError(
      409,
      'LEGACY_ADAPTER_NOT_TENANT_SAFE',
      'Legacy users/wallets/transactions не имеют надёжной venue-attribution для другого tenant. Read adapter заблокирован.',
    )
  }
  if (!scope.legacyBarId) {
    throw new HttpError(
      409,
      'VENUE_NOT_MAPPED',
      'Заведение ещё не связано с legacy bars и не имеет read-only источника.',
    )
  }
  return scope.legacyBarId
}

interface MetricsRow extends QueryResultRow {
  total_customers: string
  new_customers: string
  transaction_active_customers: string
  returning_customers: string
  tracked_revenue_cents: string
  check_count: string
  avg_check_cents: string | null
  bonus_earned: string
  bonus_redeemed: string
  outstanding_bonus_balance: string
  operation_count: string
}

async function periodMetrics(scope: VenueScope, range: PeriodRange) {
  const barId = await requireLegacyBar(scope)
  const result = await readPool.query<MetricsRow>(
    `WITH members AS (
       SELECT bc.user_id
       FROM bar_customers bc
       JOIN users u ON u.id = bc.user_id
       WHERE bc.bar_id = $1::bigint
         AND bc.status = 'active'
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
         AND u.role = 'client'
     ),
     period_tx AS (
       SELECT t.*
       FROM transactions t
       JOIN members m ON m.user_id = t.client_id
       WHERE t.status = 'completed'
         AND COALESCE(t.completed_at, t.created_at) >= $2::timestamptz
         AND COALESCE(t.completed_at, t.created_at) < $3::timestamptz
     )
     SELECT
       (SELECT COUNT(*)::bigint FROM members) AS total_customers,
       (SELECT COUNT(*)::bigint
        FROM members m JOIN users u ON u.id = m.user_id
        WHERE u.created_at >= $2::timestamptz AND u.created_at < $3::timestamptz) AS new_customers,
       (SELECT COUNT(DISTINCT client_id)::bigint FROM period_tx) AS transaction_active_customers,
       (SELECT COUNT(DISTINCT pt.client_id)::bigint
        FROM period_tx pt
        WHERE EXISTS (
          SELECT 1
          FROM transactions previous_tx
          WHERE previous_tx.client_id = pt.client_id
            AND previous_tx.status = 'completed'
            AND previous_tx.mode IN ('accrue','redeem')
            AND COALESCE(previous_tx.completed_at, previous_tx.created_at) < $2::timestamptz
        )) AS returning_customers,
       (SELECT COALESCE(SUM(cash_paid_cents),0)::bigint
        FROM period_tx WHERE mode IN ('accrue','redeem')) AS tracked_revenue_cents,
       (SELECT COUNT(*)::bigint
        FROM period_tx
        WHERE mode IN ('accrue','redeem') AND check_amount_cents > 0) AS check_count,
       (SELECT AVG(check_amount_cents)
        FROM period_tx
        WHERE mode IN ('accrue','redeem') AND check_amount_cents > 0) AS avg_check_cents,
       (SELECT COALESCE(SUM(bonus_earned),0)::bigint FROM period_tx) AS bonus_earned,
       (SELECT COALESCE(SUM(bonus_spent),0)::bigint FROM period_tx) AS bonus_redeemed,
       (SELECT COALESCE(SUM(w.balance),0)::bigint
        FROM members m JOIN wallets w ON w.user_id = m.user_id) AS outstanding_bonus_balance,
       (SELECT COUNT(*)::bigint FROM period_tx) AS operation_count`,
    [barId, range.from.toISOString(), range.to.toISOString()],
  )
  const row = result.rows[0]
  if (!row) throw new HttpError(500, 'METRICS_EMPTY', 'Не удалось вычислить метрики.')

  const earned = numeric(row.bonus_earned)
  const redeemed = numeric(row.bonus_redeemed)
  return {
    totalCustomers: numeric(row.total_customers),
    newCustomers: numeric(row.new_customers),
    transactionActiveCustomers: numeric(row.transaction_active_customers),
    returningCustomers: numeric(row.returning_customers),
    trackedRevenue: centsToRubles(row.tracked_revenue_cents),
    checkCount: numeric(row.check_count),
    averageCheck: row.avg_check_cents === null ? null : centsToRubles(row.avg_check_cents),
    bonusEarned: earned,
    bonusRedeemed: redeemed,
    outstandingBonusBalance: numeric(row.outstanding_bonus_balance),
    operationCount: numeric(row.operation_count),
    redemptionRate: earned > 0 ? (redeemed / earned) * 100 : null,
  }
}

export async function getVenueDashboard(scope: VenueScope, range: PeriodRange) {
  const current = await periodMetrics(scope, range)
  const duration = range.to.getTime() - range.from.getTime()
  const previousRange: PeriodRange = {
    from: new Date(range.from.getTime() - duration),
    to: new Date(range.from.getTime()),
    days: range.days,
  }
  const previous = await periodMetrics(scope, previousRange)
  const barId = await requireLegacyBar(scope)

  const trendResult = await readPool.query<{
    day: string
    revenue_cents: string
    checks: string
    customers: string
    bonus_earned: string
    bonus_redeemed: string
  }>(
    `WITH members AS (
       SELECT bc.user_id
       FROM bar_customers bc
       JOIN users u ON u.id = bc.user_id
       WHERE bc.bar_id = $1::bigint
         AND bc.status = 'active'
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
         AND u.role = 'client'
     )
     SELECT
       DATE_TRUNC('day', COALESCE(t.completed_at, t.created_at))::date::text AS day,
       COALESCE(SUM(t.cash_paid_cents) FILTER (WHERE t.mode IN ('accrue','redeem')),0)::bigint AS revenue_cents,
       COUNT(*) FILTER (WHERE t.mode IN ('accrue','redeem') AND t.check_amount_cents > 0)::bigint AS checks,
       COUNT(DISTINCT t.client_id)::bigint AS customers,
       COALESCE(SUM(t.bonus_earned),0)::bigint AS bonus_earned,
       COALESCE(SUM(t.bonus_spent),0)::bigint AS bonus_redeemed
     FROM transactions t
     JOIN members m ON m.user_id = t.client_id
     WHERE t.status = 'completed'
       AND COALESCE(t.completed_at, t.created_at) >= $2::timestamptz
       AND COALESCE(t.completed_at, t.created_at) < $3::timestamptz
     GROUP BY 1
     ORDER BY 1`,
    [barId, range.from.toISOString(), range.to.toISOString()],
  )

  const platformResult = await readPool.query<{
    platform_state: string
    count: string
  }>(
    `WITH members AS (
       SELECT bc.user_id
       FROM bar_customers bc
       JOIN users u ON u.id = bc.user_id
       WHERE bc.bar_id = $1::bigint
         AND bc.status = 'active'
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
         AND u.role = 'client'
     ),
     flags AS (
       SELECT
         m.user_id,
         BOOL_OR(ui.provider = 'vk') AS has_vk,
         BOOL_OR(ui.provider = 'telegram') AS has_tg
       FROM members m
       LEFT JOIN user_identities ui ON ui.user_id = m.user_id
       GROUP BY m.user_id
     )
     SELECT
       CASE
         WHEN has_vk AND has_tg THEN 'both'
         WHEN has_vk THEN 'vk'
         WHEN has_tg THEN 'telegram'
         ELSE 'unknown'
       END AS platform_state,
       COUNT(*)::bigint
     FROM flags
     GROUP BY 1`,
    [barId],
  )

  const platformSplit = Object.fromEntries(
    platformResult.rows.map((row) => [row.platform_state, numeric(row.count)]),
  )

  return {
    dataSource: {
      mode: 'production-read-only',
      legacyBarId: scope.legacyBarId,
      venueCode: scope.code,
      accountMode: 'separate',
    },
    period: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: range.days,
    },
    metrics: {
      trackedRevenue: available(current.trackedRevenue, 'transactions.cash_paid_cents'),
      checkCount: available(current.checkCount, 'transactions[completed accrue/redeem]'),
      averageCheck:
        current.averageCheck === null
          ? unavailable('За период нет completed чеков.')
          : available(current.averageCheck, 'AVG(transactions.check_amount_cents)'),
      totalCustomers: available(current.totalCustomers, 'bar_customers + users'),
      newCustomers: available(current.newCustomers, 'users.created_at'),
      activeCustomers: available(
        current.transactionActiveCustomers,
        'distinct completed transaction clients; это не app DAU',
      ),
      returningCustomers: available(
        current.returningCustomers,
        'registered before period + completed transaction during period',
      ),
      bonusEarned: available(current.bonusEarned, 'transactions.bonus_earned'),
      bonusRedeemed: available(current.bonusRedeemed, 'transactions.bonus_spent'),
      outstandingBonusBalance: available(current.outstandingBonusBalance, 'wallets.balance'),
      operationCount: available(current.operationCount, 'completed transactions'),
      redemptionRate:
        current.redemptionRate === null
          ? unavailable('В периоде нет начисленных бонусов.')
          : available(current.redemptionRate, 'bonus_spent / bonus_earned'),
      visits: unavailable(NO_ACTIVITY_EVENTS),
      dau: unavailable(NO_ACTIVITY_EVENTS),
      wau: unavailable(NO_ACTIVITY_EVENTS),
      mau: unavailable(NO_ACTIVITY_EVENTS),
      retention7: unavailable(NO_ACTIVITY_EVENTS),
      retention30: unavailable(NO_ACTIVITY_EVENTS),
      retention90: unavailable(NO_ACTIVITY_EVENTS),
    },
    previousMetrics: previous,
    trend: trendResult.rows.map((row) => ({
      day: row.day,
      revenue: centsToRubles(row.revenue_cents),
      checks: numeric(row.checks),
      customers: numeric(row.customers),
      bonusEarned: numeric(row.bonus_earned),
      bonusRedeemed: numeric(row.bonus_redeemed),
    })),
    platformSplit: {
      vk: numeric(platformSplit.vk),
      telegram: numeric(platformSplit.telegram),
      both: numeric(platformSplit.both),
      unknown: numeric(platformSplit.unknown),
      note: 'Текущий production accountMode=separate; both возможен только как legacy identity state.',
    },
    unavailableMetrics: [
      { key: 'visits', reason: NO_ACTIVITY_EVENTS, requiredEvent: 'visit_started / venue_visit' },
      { key: 'dau_wau_mau', reason: NO_ACTIVITY_EVENTS, requiredEvent: 'app_activity' },
      { key: 'retention', reason: NO_ACTIVITY_EVENTS, requiredEvent: 'app_activity or venue_visit' },
    ],
  }
}

export async function getClients(scope: VenueScope, url: URL) {
  const barId = await requireLegacyBar(scope)
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 100)
  const status = String(url.searchParams.get('status') || 'all')
  const limit = boundedInt(url.searchParams.get('limit'), 50, 1, 100)
  const offset = boundedInt(url.searchParams.get('offset'), 0, 0, 1_000_000)
  const sortKey = String(url.searchParams.get('sort') || 'lastActivity')
  const orderBy = {
    lastActivity: 'last_activity_at DESC NULLS LAST',
    spend: 'lifetime_spend_cents DESC',
    balance: 'balance DESC',
    created: 'u.created_at DESC',
  }[sortKey] || 'last_activity_at DESC NULLS LAST'

  const params: Array<string | number> = [barId, `%${query}%`, limit, offset]
  let statusClause = ''
  if (['active', 'blocked', 'archived'].includes(status)) {
    params.push(status)
    statusClause = `AND bc.status = $5`
  }

  const result = await readPool.query<{
    id: string
    first_name: string
    last_name: string | null
    username: string | null
    photo_url: string | null
    created_at: string
    membership_status: string
    balance: string
    lifetime_spend_cents: string
    avg_check_cents: string | null
    operation_count: string
    last_activity_at: string | null
    bonus_earned: string
    bonus_redeemed: string
    rolling_spend_cents: string
    has_vk: boolean
    has_tg: boolean
  }>(
    `WITH identity_flags AS (
       SELECT
         user_id,
         BOOL_OR(provider = 'vk') AS has_vk,
         BOOL_OR(provider = 'telegram') AS has_tg
       FROM user_identities
       GROUP BY user_id
     ),
     tx AS (
       SELECT
         client_id,
         COALESCE(SUM(check_amount_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem')
         ),0)::bigint AS lifetime_spend_cents,
         AVG(check_amount_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem') AND check_amount_cents > 0
         ) AS avg_check_cents,
         COUNT(*) FILTER (WHERE status='completed')::bigint AS operation_count,
         MAX(COALESCE(completed_at,created_at)) FILTER (WHERE status='completed') AS last_activity_at,
         COALESCE(SUM(bonus_earned) FILTER (WHERE status='completed'),0)::bigint AS bonus_earned,
         COALESCE(SUM(bonus_spent) FILTER (WHERE status='completed'),0)::bigint AS bonus_redeemed,
         COALESCE(SUM(cash_paid_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem')
             AND created_at >= NOW() - INTERVAL '12 months'
         ),0)::bigint AS rolling_spend_cents
       FROM transactions
       GROUP BY client_id
     )
     SELECT
       u.id::text,
       u.first_name,
       u.last_name,
       u.username,
       u.photo_url,
       u.created_at::text,
       bc.status AS membership_status,
       COALESCE(w.balance,0)::bigint::text AS balance,
       COALESCE(tx.lifetime_spend_cents,0)::text AS lifetime_spend_cents,
       tx.avg_check_cents::text,
       COALESCE(tx.operation_count,0)::text AS operation_count,
       tx.last_activity_at::text,
       COALESCE(tx.bonus_earned,0)::text AS bonus_earned,
       COALESCE(tx.bonus_redeemed,0)::text AS bonus_redeemed,
       COALESCE(tx.rolling_spend_cents,0)::text AS rolling_spend_cents,
       COALESCE(i.has_vk,FALSE) AS has_vk,
       COALESCE(i.has_tg,FALSE) AS has_tg
     FROM bar_customers bc
     JOIN users u ON u.id = bc.user_id
     LEFT JOIN wallets w ON w.user_id = u.id
     LEFT JOIN identity_flags i ON i.user_id = u.id
     LEFT JOIN tx ON tx.client_id = u.id
     WHERE bc.bar_id = $1::bigint
       AND u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND u.role = 'client'
       AND (
         $2 = '%%'
         OR COALESCE(u.first_name,'') ILIKE $2
         OR COALESCE(u.last_name,'') ILIKE $2
         OR COALESCE(u.username,'') ILIKE $2
         OR u.id::text ILIKE $2
       )
       ${statusClause}
     ORDER BY ${orderBy}
     LIMIT $3 OFFSET $4`,
    params,
  )

  const countParams: string[] = [barId, `%${query}%`]
  let countStatusClause = ''
  if (['active', 'blocked', 'archived'].includes(status)) {
    countParams.push(status)
    countStatusClause = `AND bc.status = $3`
  }
  const countResult = await readPool.query<{ count: string }>(
    `SELECT COUNT(*)::bigint
     FROM bar_customers bc
     JOIN users u ON u.id=bc.user_id
     WHERE bc.bar_id=$1::bigint
       AND u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND u.role = 'client'
       AND (
         $2 = '%%'
         OR COALESCE(u.first_name,'') ILIKE $2
         OR COALESCE(u.last_name,'') ILIKE $2
         OR COALESCE(u.username,'') ILIKE $2
         OR u.id::text ILIKE $2
       )
       ${countStatusClause}`,
    countParams,
  )

  return {
    total: numeric(countResult.rows[0]?.count),
    limit,
    offset,
    rows: result.rows.map((row) => {
      const legacyStatus = resolvePivnikLegacyStatus(numeric(row.rolling_spend_cents))
      return {
        id: row.id,
        name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        username: row.username,
        photoUrl: row.photo_url,
        registeredAt: row.created_at,
        membershipStatus: row.membership_status,
        balance: numeric(row.balance),
        lifetimeSpend: centsToRubles(row.lifetime_spend_cents),
        averageCheck: row.avg_check_cents === null ? null : centsToRubles(row.avg_check_cents),
        operationCount: numeric(row.operation_count),
        lastActivityAt: row.last_activity_at,
        bonusEarned: numeric(row.bonus_earned),
        bonusRedeemed: numeric(row.bonus_redeemed),
        platform:
          row.has_vk && row.has_tg ? 'VK + TG' : row.has_vk ? 'VK' : row.has_tg ? 'TG' : '—',
        level: legacyStatus.name,
        cashbackPercent: legacyStatus.bonusPercent,
        statusSource: 'legacy STATUS_LEVELS (12m cash_paid_cents)',
        visitCount: null,
        visitCountReason: NO_ACTIVITY_EVENTS,
      }
    }),
  }
}

export async function getClientDetail(scope: VenueScope, rawUserId: string) {
  const barId = await requireLegacyBar(scope)
  const userId = parsePositiveId(rawUserId, 'user_id')

  const result = await readPool.query<{
    id: string
    first_name: string
    last_name: string | null
    username: string | null
    photo_url: string | null
    created_at: string
    membership_status: string
    balance: string
    paid_ml_total: string
    gift_ml_balance: string
    lifetime_spend_cents: string
    avg_check_cents: string | null
    max_check_cents: string | null
    bonus_earned: string
    bonus_redeemed: string
    operation_count: string
    first_activity_at: string | null
    last_activity_at: string | null
    rolling_spend_cents: string
  }>(
    `WITH tx AS (
       SELECT
         client_id,
         COALESCE(SUM(check_amount_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem')
         ),0)::bigint AS lifetime_spend_cents,
         AVG(check_amount_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem') AND check_amount_cents>0
         ) AS avg_check_cents,
         MAX(check_amount_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem') AND check_amount_cents>0
         ) AS max_check_cents,
         COALESCE(SUM(bonus_earned) FILTER (WHERE status='completed'),0)::bigint AS bonus_earned,
         COALESCE(SUM(bonus_spent) FILTER (WHERE status='completed'),0)::bigint AS bonus_redeemed,
         COUNT(*) FILTER (WHERE status='completed')::bigint AS operation_count,
         MIN(COALESCE(completed_at,created_at)) FILTER (WHERE status='completed') AS first_activity_at,
         MAX(COALESCE(completed_at,created_at)) FILTER (WHERE status='completed') AS last_activity_at,
         COALESCE(SUM(cash_paid_cents) FILTER (
           WHERE status='completed' AND mode IN ('accrue','redeem')
             AND created_at >= NOW() - INTERVAL '12 months'
         ),0)::bigint AS rolling_spend_cents
       FROM transactions
       WHERE client_id=$2::bigint
       GROUP BY client_id
     )
     SELECT
       u.id::text,u.first_name,u.last_name,u.username,u.photo_url,u.created_at::text,
       bc.status AS membership_status,
       COALESCE(w.balance,0)::text AS balance,
       COALESCE(bl.paid_ml_total,0)::text AS paid_ml_total,
       COALESCE(bl.gift_ml_balance,0)::text AS gift_ml_balance,
       COALESCE(tx.lifetime_spend_cents,0)::text AS lifetime_spend_cents,
       tx.avg_check_cents::text,tx.max_check_cents::text,
       COALESCE(tx.bonus_earned,0)::text AS bonus_earned,
       COALESCE(tx.bonus_redeemed,0)::text AS bonus_redeemed,
       COALESCE(tx.operation_count,0)::text AS operation_count,
       tx.first_activity_at::text,tx.last_activity_at::text,
       COALESCE(tx.rolling_spend_cents,0)::text AS rolling_spend_cents
     FROM bar_customers bc
     JOIN users u ON u.id=bc.user_id
     LEFT JOIN wallets w ON w.user_id=u.id
     LEFT JOIN beer_loyalty bl ON bl.user_id=u.id
     LEFT JOIN tx ON tx.client_id=u.id
     WHERE bc.bar_id=$1::bigint AND u.id=$2::bigint
       AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       AND u.role = 'client'
     LIMIT 1`,
    [barId, userId],
  )
  const row = result.rows[0]
  if (!row) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'Клиент не найден в этом заведении.')

  const identities = await readPool.query<{
    provider: string
    provider_user_id: string
    provider_username: string | null
    profile_url: string | null
  }>(
    `SELECT provider,provider_user_id,provider_username,profile_url
     FROM user_identities WHERE user_id=$1::bigint ORDER BY provider`,
    [userId],
  )
  const timeline = await readPool.query<{
    id: string
    mode: string
    status: string
    check_amount_cents: string
    cash_paid_cents: string
    bonus_spent: string
    bonus_earned: string
    reason: string | null
    reward_code: string | null
    occurred_at: string
  }>(
    `SELECT id::text,mode,status,check_amount_cents::text,cash_paid_cents::text,
            bonus_spent::text,bonus_earned::text,reason,reward_code,
            COALESCE(completed_at,created_at)::text AS occurred_at
     FROM transactions
     WHERE client_id=$1::bigint
     ORDER BY COALESCE(completed_at,created_at) DESC
     LIMIT 50`,
    [userId],
  )

  const legacyStatus = resolvePivnikLegacyStatus(numeric(row.rolling_spend_cents))
  const detail: Record<string, unknown> = {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(' '),
    username: row.username,
    photoUrl: row.photo_url,
    registeredAt: row.created_at,
    membershipStatus: row.membership_status,
    balance: numeric(row.balance),
    lifetimeSpend: centsToRubles(row.lifetime_spend_cents),
    averageCheck: row.avg_check_cents === null ? null : centsToRubles(row.avg_check_cents),
    maxCheck: row.max_check_cents === null ? null : centsToRubles(row.max_check_cents),
    bonusEarned: numeric(row.bonus_earned),
    bonusRedeemed: numeric(row.bonus_redeemed),
    operationCount: numeric(row.operation_count),
    firstActivityAt: row.first_activity_at,
    lastActivityAt: row.last_activity_at,
    paidMlTotal: numeric(row.paid_ml_total),
    giftMlBalance: numeric(row.gift_ml_balance),
    level: legacyStatus.name,
    cashbackPercent: legacyStatus.bonusPercent,
    discountPercent: legacyStatus.discountPercent,
    identities: identities.rows,
    visits: unavailable(NO_ACTIVITY_EVENTS),
    timeline: timeline.rows.map((item) => ({
      ...item,
      checkAmount: centsToRubles(item.check_amount_cents),
      cashPaid: centsToRubles(item.cash_paid_cents),
      bonusSpent: numeric(item.bonus_spent),
      bonusEarned: numeric(item.bonus_earned),
    })),
  }

  if (await productionTableExists('user_achievements_v2')) {
    const achievements = await readPool.query(
      `SELECT achievement_code,is_granted,granted_at,current_progress,required_progress
       FROM user_achievements_v2
       WHERE user_id=$1::bigint
       ORDER BY is_granted DESC, granted_at DESC NULLS LAST, achievement_code`,
      [userId],
    )
    detail.achievements = achievements.rows
  } else {
    detail.achievements = []
  }
  if (await productionTableExists('wheel_spins')) {
    const wheel = await readPool.query(
      `SELECT id::text,kind,prize_code,bonus_awarded,beer_awarded_ml,created_at
       FROM wheel_spins WHERE user_id=$1::bigint ORDER BY created_at DESC LIMIT 30`,
      [userId],
    )
    detail.wheelHistory = wheel.rows
  } else {
    detail.wheelHistory = []
  }
  if (await productionTableExists('shop_purchases')) {
    const purchases = await readPool.query(
      `SELECT id::text,item_code,bonus_price,created_at
       FROM shop_purchases WHERE user_id=$1::bigint ORDER BY created_at DESC LIMIT 30`,
      [userId],
    )
    detail.shopPurchases = purchases.rows
  } else {
    detail.shopPurchases = []
  }

  return detail
}

export async function getOperations(scope: VenueScope, url: URL) {
  const barId = await requireLegacyBar(scope)
  const limit = boundedInt(url.searchParams.get('limit'), 100, 1, 200)
  const result = await readPool.query(
    `SELECT
       t.id::text,t.mode,t.status,t.check_amount_cents,t.discount_cents,
       t.bonus_spent,t.bonus_earned,t.cash_paid_cents,t.balance_after,
       t.reason,t.reward_code,t.is_suspicious,
       COALESCE(t.completed_at,t.created_at) AS occurred_at,
       u.id::text AS user_id,u.first_name,u.last_name,u.username
     FROM transactions t
     JOIN bar_customers bc ON bc.user_id=t.client_id AND bc.bar_id=$1::bigint
     JOIN users u ON u.id=t.client_id
     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       AND u.role = 'client'
     ORDER BY COALESCE(t.completed_at,t.created_at) DESC
     LIMIT $2`,
    [barId, limit],
  )
  return {
    rows: result.rows.map((row) => ({
      ...row,
      checkAmount: centsToRubles(row.check_amount_cents),
      discount: centsToRubles(row.discount_cents),
      cashPaid: centsToRubles(row.cash_paid_cents),
      bonusSpent: numeric(row.bonus_spent),
      bonusEarned: numeric(row.bonus_earned),
    })),
  }
}

export async function getAchievementAnalytics(scope: VenueScope) {
  const barId = await requireLegacyBar(scope)
  if (!(await productionTableExists('user_achievements_v2'))) {
    return {
      available: false,
      reason: 'Таблица user_achievements_v2 отсутствует.',
      rows: [],
    }
  }
  const result = await readPool.query(
    `SELECT
       ua.achievement_code,
       COUNT(*)::bigint AS tracked_customers,
       COUNT(*) FILTER (WHERE ua.is_granted)::bigint AS unlocked_count,
       MAX(ua.granted_at) FILTER (WHERE ua.is_granted) AS last_unlock_at
     FROM user_achievements_v2 ua
     JOIN bar_customers bc ON bc.user_id=ua.user_id AND bc.bar_id=$1::bigint
     JOIN users u ON u.id=ua.user_id
     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       AND u.role = 'client'
     GROUP BY ua.achievement_code
     ORDER BY unlocked_count DESC, ua.achievement_code`,
    [barId],
  )
  return { available: true, rows: result.rows, source: 'user_achievements_v2' }
}

export async function getWheelAnalytics(scope: VenueScope, range: PeriodRange) {
  const barId = await requireLegacyBar(scope)
  if (!(await productionTableExists('wheel_spins'))) {
    return { available: false, reason: 'Таблица wheel_spins отсутствует.', rows: [] }
  }
  const result = await readPool.query(
    `SELECT
       COUNT(*)::bigint AS spins,
       COUNT(DISTINCT ws.user_id)::bigint AS unique_users,
       COALESCE(SUM(ws.charged_bonus_cost),0)::bigint AS retry_spend,
       COALESCE(SUM(ws.bonus_awarded),0)::bigint AS bonus_awarded,
       COALESCE(SUM(ws.beer_awarded_ml),0)::bigint AS beer_awarded_ml
     FROM wheel_spins ws
     JOIN bar_customers bc ON bc.user_id=ws.user_id AND bc.bar_id=$1::bigint
     JOIN users u ON u.id=ws.user_id
     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL AND u.role='client'
       AND ws.created_at >= $2::timestamptz AND ws.created_at < $3::timestamptz`,
    [barId, range.from.toISOString(), range.to.toISOString()],
  )
  const distribution = await readPool.query(
    `SELECT ws.prize_code,COUNT(*)::bigint AS count
     FROM wheel_spins ws
     JOIN bar_customers bc ON bc.user_id=ws.user_id AND bc.bar_id=$1::bigint
     JOIN users u ON u.id=ws.user_id
     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL AND u.role='client'
       AND ws.created_at >= $2::timestamptz AND ws.created_at < $3::timestamptz
     GROUP BY ws.prize_code ORDER BY count DESC`,
    [barId, range.from.toISOString(), range.to.toISOString()],
  )
  return {
    available: true,
    telegramOnly: true,
    source: 'wheel_spins',
    summary: result.rows[0] || {},
    distribution: distribution.rows,
  }
}

export async function getShop(scope: VenueScope, range: PeriodRange) {
  await requireLegacyBar(scope)
  if (scope.companyCode !== 'pivnik') {
    return {
      available: false,
      reason: 'Legacy shop_items является глобальным каталогом ПИВНИКА и не безопасен как источник другого tenant.',
      items: [],
    }
  }
  const catalog = await readPool.query(
    `SELECT id::text,code,title,subtitle,category,price_type,bonus_price,cash_price,
            image_src,active,sort_order,created_at,updated_at
     FROM shop_items
     ORDER BY sort_order,id`,
  )
  let purchases: unknown[] = []
  if (await productionTableExists('shop_purchases')) {
    const barId = await requireLegacyBar(scope)
    const result = await readPool.query(
      `SELECT sp.item_code,COUNT(*)::bigint AS purchases,
              COALESCE(SUM(sp.bonus_price),0)::bigint AS bonus_spend
       FROM shop_purchases sp
       JOIN bar_customers bc ON bc.user_id=sp.user_id AND bc.bar_id=$1::bigint
       JOIN users u ON u.id=sp.user_id
       WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL AND u.role='client'
         AND sp.created_at >= $2::timestamptz AND sp.created_at < $3::timestamptz
       GROUP BY sp.item_code ORDER BY purchases DESC`,
      [barId, range.from.toISOString(), range.to.toISOString()],
    )
    purchases = result.rows
  }
  return {
    available: true,
    source: 'legacy global shop_items (PIVNIK only)',
    items: catalog.rows,
    purchases,
  }
}

export async function getPromotions(scope: VenueScope) {
  await requireLegacyBar(scope)
  if (scope.companyCode !== 'pivnik') {
    return {
      available: false,
      reason: 'Legacy promotions является глобальным контентом ПИВНИКА и не tenant-scoped.',
      rows: [],
    }
  }
  const result = await readPool.query(
    `SELECT id::text,code,title,description,badge,image_src,active,sort_order,created_at,updated_at
     FROM promotions ORDER BY sort_order,id`,
  )
  return { available: true, source: 'legacy global promotions (PIVNIK only)', rows: result.rows }
}

export async function getLegacyLoyalty(scope: VenueScope) {
  if (scope.companyCode !== 'pivnik') {
    return {
      available: false,
      reason: 'Loyalty configuration has not been migrated for this tenant.',
      levels: [],
    }
  }
  const { PIVNIK_LEGACY_STATUS_LEVELS } = await import('./legacy-compat.js')
  return {
    available: true,
    editable: false,
    source: 'server.js STATUS_LEVELS legacy compatibility snapshot',
    registrationBonus: 100,
    levels: PIVNIK_LEGACY_STATUS_LEVELS,
    note: 'DB override is not enabled in customer runtime. Write operations are intentionally disabled.',
  }
}

export async function getAudit(scope: VenueScope | null, limit = 100) {
  const safeLimit = boundedInt(limit, 100, 1, 200)
  const params: Array<string | number> = [safeLimit]
  let tenantClause = ''
  if (scope) {
    params.push(scope.companyId)
    tenantClause = `WHERE al.company_id=$2::bigint`
  }
  const result = await readPool.query(
    `SELECT
       al.id::text,al.action,al.entity_type,al.entity_id,
       al.before_value,al.after_value,al.reason,al.admin_role,al.metadata,al.created_at,
       aa.display_name AS admin_name,aa.email AS admin_email,
       c.name AS company_name,v.name AS venue_name
     FROM admin_audit_log al
     LEFT JOIN admin_accounts aa ON aa.id=al.admin_id
     LEFT JOIN companies c ON c.id=al.company_id
     LEFT JOIN venues v ON v.id=al.venue_id
     ${tenantClause}
     ORDER BY al.created_at DESC
     LIMIT $1`,
    params,
  )
  return { rows: result.rows }
}

export async function getPlatformSummary() {
  const result = await readPool.query(
    `SELECT
       c.id::text AS company_id,c.code AS company_code,c.name AS company_name,
       v.id::text AS venue_id,v.code AS venue_code,v.name AS venue_name,
       v.legacy_bar_id::text,
       COUNT(u.id)::bigint AS customers
     FROM companies c
     LEFT JOIN venues v ON v.company_id=c.id AND v.active=TRUE
     LEFT JOIN bar_customers bc ON bc.bar_id=v.legacy_bar_id AND bc.status='active'
     LEFT JOIN users u ON u.id=bc.user_id
       AND u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND u.role='client'
     WHERE c.active=TRUE
     GROUP BY c.id,c.code,c.name,v.id,v.code,v.name,v.legacy_bar_id
     ORDER BY c.name,v.name`,
  )
  return {
    companies: result.rows,
    metrics: {
      dau: unavailable(NO_ACTIVITY_EVENTS),
      wau: unavailable(NO_ACTIVITY_EVENTS),
      mau: unavailable(NO_ACTIVITY_EVENTS),
    },
  }
}


export async function getLegacyDesign(scope: VenueScope) {
  await requireLegacyBar(scope)
  if (scope.companyCode !== 'pivnik') {
    return {
      available: false,
      reason: 'Legacy app_settings is global and is not tenant-scoped for this company.',
      published: null,
    }
  }
  if (!(await productionTableExists('app_settings'))) {
    return { available: false, reason: 'Таблица app_settings отсутствует.', published: null }
  }
  const result = await readPool.query(
    `SELECT published,updated_at FROM app_settings WHERE id=1 LIMIT 1`,
  )
  const row = result.rows[0]
  if (!row) return { available: false, reason: 'Published design отсутствует.', published: null }
  return {
    available: true,
    source: 'legacy global app_settings.published (PIVNIK only)',
    published: row.published,
    updatedAt: row.updated_at,
    editable: false,
  }
}

export async function getCapabilities(scope: VenueScope) {
  return {
    venue: scope,
    productionSchema: {
      users: await productionTableExists('users'),
      bars: await productionTableExists('bars'),
      barCustomers: await productionTableExists('bar_customers'),
      userIdentities: await productionTableExists('user_identities'),
      wallets: await productionTableExists('wallets'),
      transactions: await productionTableExists('transactions'),
      achievements: await productionTableExists('user_achievements_v2'),
      wheel: await productionTableExists('wheel_spins'),
      shop: await productionTableExists('shop_items'),
      shopPurchases: await productionTableExists('shop_purchases'),
      promotions: await productionTableExists('promotions'),
    },
    writeOperations: {
      configWritesEnabled: config.enableWrites,
      productionBonusWritesEnabled: config.enableProductionBonusWrites,
      productionAchievementWritesEnabled: config.enableProductionAchievementWrites,
      customerRuntimeDependsOnAdmin: false,
    },
  }
}
