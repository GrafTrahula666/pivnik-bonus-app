const MOSCOW_TIME_ZONE = 'Europe/Moscow';

const catalog = [
  {
    code: 'first-purchase',
    title: 'Первый тост',
    description: 'Совершите первую покупку в «Пивнике».',
    rarity: 'common',
    icon: 'receipt',
    metric: 'purchaseCount',
    target: 1,
    rewardBonus: 10
  },
  {
    code: 'single-check-1000',
    title: 'Тысяча за раз',
    description: 'Оплатите один чек на сумму от 1 000 ₽.',
    rarity: 'common',
    icon: 'banknote',
    metric: 'maxCheckCents',
    target: 100_000,
    unit: 'rub',
    rewardBonus: 10
  },
  {
    code: 'three-purchases',
    title: 'Третий звонок',
    description: 'Совершите 3 покупки.',
    rarity: 'common',
    icon: 'triple',
    metric: 'purchaseCount',
    target: 3,
    rewardBonus: 10
  },
  {
    code: 'three-paid-liters',
    title: 'Пенная тройка',
    description: 'Оплатите суммарно 3 литра разливного пива.',
    rarity: 'common',
    icon: 'pint',
    metric: 'paidBeerMl',
    target: 3_000,
    unit: 'liter',
    rewardBonus: 10
  },
  {
    code: 'first-redemption',
    title: 'Бонус в деле',
    description: 'Впервые используйте бонусы при покупке.',
    rarity: 'common',
    icon: 'spark',
    metric: 'redemptionCount',
    target: 1,
    rewardBonus: 10
  },
  {
    code: 'first-shop-purchase',
    title: 'Из запасов Пивника',
    description: 'Купите первый товар в бонусном магазине.',
    rarity: 'common',
    icon: 'shop',
    metric: 'shopPurchaseCount',
    target: 1,
    rewardBonus: 10
  },
  {
    code: 'ten-purchases',
    title: 'Свой человек',
    description: 'Совершите 10 покупок.',
    rarity: 'rare',
    icon: 'receipt-stack',
    metric: 'purchaseCount',
    target: 10,
    rewardBonus: 20
  },
  {
    code: 'single-check-3000',
    title: 'Щедрый стол',
    description: 'Оплатите один чек на сумму от 3 000 ₽.',
    rarity: 'rare',
    icon: 'banknote',
    metric: 'maxCheckCents',
    target: 300_000,
    unit: 'rub',
    rewardBonus: 20
  },
  {
    code: 'total-spend-10000',
    title: 'Золотой десяток',
    description: 'Потратьте суммарно 10 000 ₽.',
    rarity: 'rare',
    icon: 'crown',
    metric: 'totalSpendCents',
    target: 1_000_000,
    unit: 'rub',
    rewardBonus: 20
  },
  {
    code: 'fifteen-paid-liters',
    title: 'Пивная миля',
    description: 'Оплатите суммарно 15 литров разливного пива.',
    rarity: 'rare',
    icon: 'pint',
    metric: 'paidBeerMl',
    target: 15_000,
    unit: 'liter',
    rewardBonus: 20
  },
  {
    code: 'five-visit-days',
    title: 'Пять вечеров',
    description: 'Совершайте покупки в 5 разных дней.',
    rarity: 'rare',
    icon: 'calendar',
    metric: 'purchaseDays',
    target: 5,
    rewardBonus: 20
  },
  {
    code: 'spend-500-bonus',
    title: 'Охотник за бонусами',
    description: 'Используйте суммарно 500 бонусов.',
    rarity: 'rare',
    icon: 'bonus',
    metric: 'bonusSpent',
    target: 500,
    unit: 'bonus',
    rewardBonus: 20
  },
  {
    code: 'monthly-top-spender',
    title: 'Король месяца',
    description: 'Займите 1-е место по фактически оплаченным покупкам за завершившийся месяц.',
    rarity: 'epic',
    icon: 'monthly-crown',
    metric: 'previousMonthWinner',
    target: 1,
    rewardBonus: 0,
    rewardBeerMl: 500,
    recurring: 'monthly'
  },
  {
    code: 'fifty-purchases',
    title: 'Хранитель стойки',
    description: 'Совершите 50 покупок.',
    rarity: 'epic',
    icon: 'receipt-stack',
    metric: 'purchaseCount',
    target: 50,
    rewardBonus: 30
  },
  {
    code: 'single-check-7000',
    title: 'Большой пир',
    description: 'Оплатите один чек на сумму от 7 000 ₽.',
    rarity: 'epic',
    icon: 'banknote',
    metric: 'maxCheckCents',
    target: 700_000,
    unit: 'rub',
    rewardBonus: 30
  },
  {
    code: 'total-spend-50000',
    title: 'Печать завсегдатая',
    description: 'Потратьте суммарно 50 000 ₽.',
    rarity: 'epic',
    icon: 'seal',
    metric: 'totalSpendCents',
    target: 5_000_000,
    unit: 'rub',
    rewardBonus: 30
  },
  {
    code: 'fifty-paid-liters',
    title: 'Мастер пенной школы',
    description: 'Оплатите суммарно 50 литров разливного пива.',
    rarity: 'epic',
    icon: 'pint',
    metric: 'paidBeerMl',
    target: 50_000,
    unit: 'liter',
    rewardBonus: 30
  },
  {
    code: 'twenty-visit-days',
    title: 'Летописец Пивника',
    description: 'Совершайте покупки в 20 разных дней.',
    rarity: 'epic',
    icon: 'calendar',
    metric: 'purchaseDays',
    target: 20,
    rewardBonus: 30
  }
];

export const ACHIEVEMENT_CATALOG = Object.freeze(
  catalog.map((item) => Object.freeze({
    rewardBeerMl: 0,
    rewardBonus: 0,
    unit: 'count',
    recurring: null,
    ...item
  }))
);

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRows(result) {
  return Array.isArray(result?.rows) && result.rows.length > 0;
}

function rublesFromCents(value) {
  return Math.round(number(value)) / 100;
}

function litersFromMl(value) {
  return Math.round(number(value)) / 1000;
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(number(value));
}

function progressLabel(definition, current) {
  if (definition.unit === 'rub') {
    return `${formatNumber(rublesFromCents(current))} / ${formatNumber(rublesFromCents(definition.target))} ₽`;
  }
  if (definition.unit === 'liter') {
    return `${formatNumber(litersFromMl(current), 2)} / ${formatNumber(litersFromMl(definition.target), 2)} л`;
  }
  if (definition.unit === 'bonus') {
    return `${formatNumber(current)} / ${formatNumber(definition.target)} Б`;
  }
  return `${formatNumber(current)} / ${formatNumber(definition.target)}`;
}

function publicDefinition(definition, current = 0) {
  const normalizedCurrent = Math.max(0, number(current));
  const target = Math.max(1, number(definition.target));
  return {
    code: definition.code,
    title: definition.title,
    description: definition.description,
    rarity: definition.rarity,
    icon: definition.icon,
    rewardBonus: number(definition.rewardBonus),
    rewardBeerMl: number(definition.rewardBeerMl),
    rewardBeerLiters: litersFromMl(definition.rewardBeerMl),
    rewardLabel: definition.rewardBeerMl
      ? '1 бесплатная пинта · 0,5 л'
      : `+${formatNumber(definition.rewardBonus)} бонусов`,
    recurring: definition.recurring,
    progress: {
      current: Math.min(normalizedCurrent, target),
      target,
      percent: Math.min(100, Math.round((normalizedCurrent / target) * 100)),
      label: progressLabel(definition, Math.min(normalizedCurrent, target))
    }
  };
}

export function evaluateAchievementCatalog(metrics = {}) {
  return ACHIEVEMENT_CATALOG.map((definition) => {
    const current = number(metrics[definition.metric]);
    return {
      ...publicDefinition(definition, current),
      eligible: current >= definition.target
    };
  });
}

async function collectMetrics(db, userId) {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
       )::bigint AS purchase_count,
       COUNT(*) FILTER (
         WHERE t.status = 'completed' AND t.mode = 'redeem'
       )::bigint AS redemption_count,
       COUNT(*) FILTER (
         WHERE t.status = 'completed' AND t.mode = 'shop'
       )::bigint AS shop_purchase_count,
       COUNT(DISTINCT (t.created_at AT TIME ZONE $2)::date) FILTER (
         WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
       )::bigint AS purchase_days,
       COALESCE(SUM(t.cash_paid_cents) FILTER (
         WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
       ), 0)::bigint AS total_spend_cents,
       COALESCE(MAX(t.check_amount_cents) FILTER (
         WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
       ), 0)::bigint AS max_check_cents,
       COALESCE(SUM(t.bonus_spent) FILTER (
         WHERE t.status = 'completed' AND t.mode IN ('redeem','shop')
       ), 0)::bigint AS bonus_spent,
       COALESCE(MAX(bl.paid_ml_total), 0)::bigint AS paid_beer_ml
     FROM users u
     LEFT JOIN transactions t ON t.client_id = u.id
     LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
     WHERE u.id = $1::bigint AND u.merged_into_user_id IS NULL
     GROUP BY u.id`,
    [userId, MOSCOW_TIME_ZONE]
  );
  const row = result.rows[0] || {};
  return {
    purchaseCount: number(row.purchase_count),
    redemptionCount: number(row.redemption_count),
    shopPurchaseCount: number(row.shop_purchase_count),
    purchaseDays: number(row.purchase_days),
    totalSpendCents: number(row.total_spend_cents),
    maxCheckCents: number(row.max_check_cents),
    bonusSpent: number(row.bonus_spent),
    paidBeerMl: number(row.paid_beer_ml),
    previousMonthWinner: 0
  };
}

async function previousMonthWinner(db, userId) {
  const result = await db.query(
    `WITH bounds AS (
       SELECT
         ((date_trunc('month', NOW() AT TIME ZONE $2) - INTERVAL '1 month')
           AT TIME ZONE $2) AS starts_at,
         (date_trunc('month', NOW() AT TIME ZONE $2)
           AT TIME ZONE $2) AS ends_at,
         to_char(
           date_trunc('month', NOW() AT TIME ZONE $2) - INTERVAL '1 month',
           'YYYY-MM'
         ) AS period_key
     ), spend AS (
       SELECT t.client_id AS user_id, SUM(t.cash_paid_cents)::bigint AS spend_cents
       FROM transactions t
       CROSS JOIN bounds b
       JOIN users u ON u.id = t.client_id AND u.merged_into_user_id IS NULL
       WHERE t.status = 'completed'
         AND t.mode IN ('accrue','redeem')
         AND t.created_at >= b.starts_at
         AND t.created_at < b.ends_at
       GROUP BY t.client_id
     ), ranked AS (
       SELECT s.*, ROW_NUMBER() OVER (
         ORDER BY s.spend_cents DESC, s.user_id ASC
       ) AS position
       FROM spend s
       WHERE s.spend_cents > 0
     )
     SELECT b.period_key,
            COALESCE(r.user_id = $1::bigint AND r.position = 1, FALSE) AS is_winner,
            COALESCE(r.spend_cents, 0)::bigint AS winner_spend_cents
     FROM bounds b
     LEFT JOIN ranked r ON r.position = 1`,
    [userId, MOSCOW_TIME_ZONE]
  );
  return {
    periodKey: String(result.rows[0]?.period_key || ''),
    isWinner: Boolean(result.rows[0]?.is_winner),
    winnerSpendCents: number(result.rows[0]?.winner_spend_cents)
  };
}

function grantCode(definition, periodKey = '') {
  return definition.recurring === 'monthly'
    ? `achievement:${definition.code}:${periodKey}`
    : `achievement:${definition.code}`;
}

function achievementRequestKey(definition, userId, periodKey = '') {
  return definition.recurring === 'monthly'
    ? `achievement:${userId}:${definition.code}:${periodKey}`
    : `achievement:${userId}:${definition.code}`;
}

async function awardAchievement(db, userId, definition, periodKey = '') {
  const code = grantCode(definition, periodKey);
  const requestKey = achievementRequestKey(definition, userId, periodKey);
  const inserted = await db.query(
    `INSERT INTO reward_grants (
       code, user_id, amount, source, achievement_code,
       achievement_period, reward_beer_ml
     ) VALUES (
       $1, $2::bigint, $3::bigint, 'achievement', $4, $5, $6::bigint
     )
     ON CONFLICT (code, user_id) DO NOTHING
     RETURNING code`,
    [
      code,
      userId,
      number(definition.rewardBonus),
      definition.code,
      periodKey || null,
      number(definition.rewardBeerMl)
    ]
  );
  if (!hasRows(inserted)) return false;

  const wallet = await db.query(
    `UPDATE wallets
     SET balance = balance + $1::bigint, updated_at = NOW()
     WHERE user_id = $2::bigint
     RETURNING balance`,
    [number(definition.rewardBonus), userId]
  );
  if (!hasRows(wallet)) throw new Error('Бонусный кошелёк достижения не найден.');

  if (definition.rewardBeerMl) {
    const beer = await db.query(
      `UPDATE beer_loyalty
       SET gift_ml_balance = gift_ml_balance + $1::bigint, updated_at = NOW()
       WHERE user_id = $2::bigint
       RETURNING gift_ml_balance`,
      [number(definition.rewardBeerMl), userId]
    );
    if (!hasRows(beer)) throw new Error('Пивной баланс достижения не найден.');
  }

  const rewardDescription = definition.rewardBeerMl
    ? '1 бесплатная пинта пива (0,5 л)'
    : `${definition.rewardBonus} бонусов`;
  await db.query(
    `INSERT INTO transactions (
       request_key, client_id, mode, status, bonus_earned,
       beer_gift_earned_ml, balance_after, reason, reward_code, completed_at
     ) VALUES (
       $1, $2::bigint, 'achievement', 'completed', $3::bigint,
       $4::bigint, $5::bigint, $6, $7, NOW()
     )`,
    [
      requestKey,
      userId,
      number(definition.rewardBonus),
      number(definition.rewardBeerMl),
      number(wallet.rows[0].balance),
      `Достижение «${definition.title}» — ${rewardDescription}`,
      code
    ]
  );
  return true;
}

async function acquireClient(db) {
  if (typeof db?.connect === 'function') {
    const client = await db.connect();
    return { client, release: () => client.release() };
  }
  return { client: db, release: () => {} };
}

export async function syncUserAchievements(db, userId) {
  const { client, release } = await acquireClient(db);
  try {
    await client.query('BEGIN');
    const activeUser = await client.query(
      `SELECT id FROM users
       WHERE id = $1::bigint AND merged_into_user_id IS NULL
       FOR UPDATE`,
      [userId]
    );
    if (!hasRows(activeUser)) {
      await client.query('ROLLBACK');
      return { granted: [] };
    }

    await client.query(
      `INSERT INTO wallets (user_id, balance)
       VALUES ($1::bigint, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    await client.query(
      `INSERT INTO beer_loyalty (user_id)
       VALUES ($1::bigint)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    const metrics = await collectMetrics(client, userId);
    const monthly = await previousMonthWinner(client, userId);
    metrics.previousMonthWinner = monthly.isWinner ? 1 : 0;

    const granted = [];
    for (const definition of ACHIEVEMENT_CATALOG) {
      if (number(metrics[definition.metric]) < definition.target) continue;
      const periodKey = definition.recurring === 'monthly' ? monthly.periodKey : '';
      if (definition.recurring === 'monthly' && !periodKey) continue;
      if (await awardAchievement(client, userId, definition, periodKey)) {
        granted.push(grantCode(definition, periodKey));
      }
    }
    await client.query('COMMIT');
    return { granted };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    release();
  }
}

export async function getUserAchievementState(db, userId, { sync = true } = {}) {
  if (sync) await syncUserAchievements(db, userId);
  const metrics = await collectMetrics(db, userId);
  const monthly = await previousMonthWinner(db, userId);
  const grantsResult = await db.query(
    `SELECT code, achievement_code, achievement_period, amount,
            reward_beer_ml, created_at, announced_at
     FROM reward_grants
     WHERE user_id = $1::bigint
       AND source = 'achievement'
       AND achievement_code IS NOT NULL
     ORDER BY created_at DESC, code DESC`,
    [userId]
  );
  metrics.previousMonthWinner = monthly.isWinner ? 1 : 0;

  const grants = grantsResult.rows;
  const awarded = awardedAchievementState(grants);
  const achievements = evaluateAchievementCatalog(metrics).map((item) => ({
    ...item,
    ...(awarded.byCode.get(item.code) || {
      earned: false,
      locked: true,
      grantCode: null,
      grantedAt: null,
      announced: false,
      periodKey: null
    })
  }));
  const byCode = new Map(achievements.map((item) => [item.code, item]));
  const earned = achievements.filter((item) => item.earned);
  const unannounced = awarded.unannouncedRows
    .map((row) => ({
      ...byCode.get(row.achievement_code),
      grantCode: row.code,
      grantedAt: row.created_at,
      announced: false,
      periodKey: row.achievement_period || null,
      rewardBonus: number(row.amount),
      rewardBeerMl: number(row.reward_beer_ml),
      rewardBeerLiters: litersFromMl(row.reward_beer_ml)
    }))
    .filter((item) => item.code);

  return { achievements, earned, unannounced };
}

function awardedAchievementState(grants) {
  const latestByAchievement = new Map();
  for (const row of grants) {
    if (!latestByAchievement.has(row.achievement_code)) {
      latestByAchievement.set(row.achievement_code, row);
    }
  }

  const byCode = new Map(ACHIEVEMENT_CATALOG.map((definition) => {
    const grant = latestByAchievement.get(definition.code);
    return [definition.code, {
      ...publicDefinition(definition, definition.target),
      earned: Boolean(grant),
      locked: !grant,
      grantCode: grant?.code || null,
      grantedAt: grant?.created_at || null,
      announced: grant ? Boolean(grant.announced_at) : false,
      periodKey: grant?.achievement_period || null
    }];
  }));
  return {
    byCode,
    unannouncedRows: grants.filter((row) => !row.announced_at)
  };
}

export async function getUserEarnedAchievementState(db, userId) {
  const result = await db.query(
    `SELECT code, achievement_code, achievement_period, amount,
            reward_beer_ml, created_at, announced_at
     FROM reward_grants
     WHERE user_id = $1::bigint
       AND source = 'achievement'
       AND achievement_code IS NOT NULL
     ORDER BY created_at DESC, code DESC`,
    [userId]
  );
  const awarded = awardedAchievementState(result.rows);
  const earned = [...awarded.byCode.values()].filter((item) => item.earned);
  const unannounced = awarded.unannouncedRows
    .map((row) => ({
      ...awarded.byCode.get(row.achievement_code),
      grantCode: row.code,
      grantedAt: row.created_at,
      announced: false,
      periodKey: row.achievement_period || null,
      rewardBonus: number(row.amount),
      rewardBeerMl: number(row.reward_beer_ml),
      rewardBeerLiters: litersFromMl(row.reward_beer_ml)
    }))
    .filter((item) => item.code);
  return { earned, unannounced };
}

export async function acknowledgeAchievement(db, userId, code) {
  const result = await db.query(
    `UPDATE reward_grants
     SET announced_at = COALESCE(announced_at, NOW())
     WHERE user_id = $1::bigint
       AND code = $2
       AND source = 'achievement'
     RETURNING code`,
    [userId, String(code || '')]
  );
  return hasRows(result);
}
