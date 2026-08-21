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
  },
  {
    code: 'creator',
    title: 'Создатель',
    description: 'Единственное в своём роде достижение создателя приложения «Пивник».',
    condition: 'Быть создателем приложения «Пивник».',
    rarity: 'legendary',
    type: 'unique',
    icon: 'all-seeing-eye',
    target: 1,
    rewardBonus: 0,
    rewardLabel: 'Уникальное достижение',
    automatic: false
  },
  {
    code: 'beta-tester',
    title: 'Пионер Пивника',
    description: 'Легендарное достижение первых участников программы лояльности «Пивник».',
    condition: 'Войти в число первых 30 участников программы.',
    rarity: 'legendary',
    type: 'unique',
    icon: 'beta',
    target: 1,
    rewardBonus: 150,
    automatic: false
  },
  {
    code: 'active-beta-participant',
    title: 'За активное участие в бета-тесте',
    description: 'Уникальная благодарность трём Telegram-пользователям, активно участвовавшим в бета-тестировании приложения.',
    condition: 'Активно участвовать в бета-тестировании приложения.',
    rarity: 'legendary',
    type: 'unique',
    icon: 'beta-active',
    target: 1,
    rewardBonus: 1000,
    automatic: false
  }
];

export const ACHIEVEMENT_CATALOG = Object.freeze(
  catalog.map((item) => Object.freeze({
    automatic: true,
    rewardBeerMl: 0,
    rewardBonus: 0,
    rewardLabel: null,
    type: 'countable',
    unit: 'count',
    recurring: null,
    condition: item.description,
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
    condition: definition.condition || definition.description,
    rarity: definition.rarity,
    type: definition.type,
    icon: definition.icon,
    rewardBonus: number(definition.rewardBonus),
    rewardBeerMl: number(definition.rewardBeerMl),
    rewardBeerLiters: litersFromMl(definition.rewardBeerMl),
    rewardLabel: definition.rewardLabel || (definition.rewardBeerMl
      ? '1 бесплатная пинта · 0,5 л'
      : definition.rewardBonus
        ? `+${formatNumber(definition.rewardBonus)} бонусов`
        : 'Без бонусной награды'),
    recurring: definition.recurring,
    progress: {
      current: Math.min(normalizedCurrent, target),
      target,
      percent: Math.min(100, Math.round((normalizedCurrent / target) * 100)),
      label: definition.type === 'unique'
        ? (normalizedCurrent >= target ? 'Получено' : 'Уникальное условие')
        : progressLabel(definition, Math.min(normalizedCurrent, target))
    }
  };
}

export function evaluateAchievementCatalog(metrics = {}) {
  return ACHIEVEMENT_CATALOG.map((definition) => {
    const current = number(metrics[definition.metric]);
    return {
      ...publicDefinition(definition, current),
      eligible: definition.automatic !== false && current >= definition.target
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

async function awardAchievement(db, userId, definition, periodKey = '', options = {}) {
  const code = grantCode(definition, periodKey);
  const requestKey = achievementRequestKey(definition, userId, periodKey);
  const inserted = await db.query(
    `INSERT INTO reward_grants (
       code, user_id, amount, source, achievement_code,
       achievement_period, reward_beer_ml, announced_at
     ) VALUES (
       $1, $2::bigint, $3::bigint, 'achievement', $4, $5, $6::bigint, $7
     )
     ON CONFLICT (code, user_id) DO NOTHING
     RETURNING code`,
    [
      code,
      userId,
      number(definition.rewardBonus),
      definition.code,
      periodKey || null,
      number(definition.rewardBeerMl),
      options.announcedAt || null
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
      if (definition.automatic === false) continue;
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
  if (sync && achievements.some((item) => item.eligible && !item.earned)) {
    throw new Error('Достижение с выполненным условием не было зафиксировано в журнале наград.');
  }
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

  return {
    achievements,
    earned,
    unannounced,
    revision: achievementRevision(grants)
  };
}

function achievementRevision(grants) {
  return grants.reduce((latest, row) => {
    const value = new Date(row.announced_at || row.created_at || 0).getTime();
    return Number.isFinite(value) && value > latest ? value : latest;
  }, 0);
}

function awardedAchievementState(grants) {
  const latestByAchievement = new Map();
  for (const row of grants) {
    if (!latestByAchievement.has(row.achievement_code)) {
      latestByAchievement.set(row.achievement_code, row);
    }
  }

  const byCode = new Map();
  for (const definition of ACHIEVEMENT_CATALOG) {
    const grant = latestByAchievement.get(definition.code);
    if (!grant) continue;
    byCode.set(definition.code, {
      ...publicDefinition(definition, definition.target),
      earned: true,
      locked: false,
      grantCode: grant.code,
      grantedAt: grant.created_at,
      announced: Boolean(grant.announced_at),
      periodKey: grant.achievement_period || null
    });
  }
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
  return { earned, unannounced, revision: achievementRevision(result.rows) };
}

function definitionByCode(code) {
  return ACHIEVEMENT_CATALOG.find((definition) => definition.code === code) || null;
}

async function ensureUserRewardAccounts(db, userId) {
  await db.query(
    `INSERT INTO wallets (user_id, balance)
     VALUES ($1::bigint, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await db.query(
    `INSERT INTO beer_loyalty (user_id)
     VALUES ($1::bigint)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function resolveTelegramAchievementUser(db, telegramId, profileFrame) {
  const result = await db.query(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN user_identities ui
       ON ui.user_id = u.id AND ui.provider = 'telegram'
     WHERE u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND (
         ($1::text <> '' AND (
           u.telegram_id::text = $1::text
           OR ui.provider_user_id = $1::text
         ))
         OR ($1::text = '' AND u.profile_frame = $2::text AND (
           u.telegram_id IS NOT NULL OR ui.provider_user_id IS NOT NULL
         ))
       )
     ORDER BY u.id
     LIMIT 2`,
    [String(telegramId || '').trim(), profileFrame]
  );
  if (result.rows.length !== 1) {
    throw new Error(`Не удалось однозначно определить Telegram beta-тестера для профиля ${profileFrame}.`);
  }
  return String(result.rows[0].id);
}

async function resolveOwnerAchievementUser(db, telegramId) {
  if (!String(telegramId || '').trim()) return null;
  const result = await db.query(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN user_identities ui
       ON ui.user_id = u.id AND ui.provider = 'telegram'
     WHERE u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND (u.telegram_id::text = $1::text OR ui.provider_user_id = $1::text)
     ORDER BY u.id
     LIMIT 2`,
    [String(telegramId).trim()]
  );
  if (result.rows.length > 1) throw new Error('Telegram identity создателя связан с несколькими активными пользователями.');
  return result.rows.length === 1 ? String(result.rows[0].id) : null;
}

export async function initializeAchievementGrants(db, options = {}) {
  const activeBetaBatchCode = 'active-beta-participant-v1';
  const frames = ['anna', 'olesya', 'vladislav'];
  const configuredIds = Array.isArray(options.activeBetaTesterTelegramIds)
    ? options.activeBetaTesterTelegramIds.map((value) => String(value || '').trim())
    : [];
  const { client, release } = await acquireClient(db);
  try {
    await client.query('BEGIN');

    const activeUsers = await client.query(
      `SELECT COUNT(*)::integer AS count
       FROM users
       WHERE merged_into_user_id IS NULL AND deleted_at IS NULL`
    );
    if (Number(activeUsers.rows[0]?.count || 0) === 0) {
      await client.query('COMMIT');
      return {
        deferred: true,
        creatorResolved: false,
        creatorGranted: false,
        activeBetaResolved: 0,
        activeBetaGranted: 0,
        activeBetaLedgerCount: 0,
        activeBetaLedgerAmount: 0,
        activeBetaTransactionCount: 0,
        activeBetaTransactionAmount: 0
      };
    }

    const ownerId = await resolveOwnerAchievementUser(client, options.ownerTelegramId);
    const claimedBatch = await client.query(
      `INSERT INTO achievement_award_batches (
         code, expected_recipients, reward_per_user
       ) VALUES ($1, 3, 1000)
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [activeBetaBatchCode]
    );
    const completedBatch = await client.query(
      `SELECT expected_recipients, reward_per_user
       FROM achievement_award_batches
       WHERE code = $1
       FOR UPDATE`,
      [activeBetaBatchCode]
    );
    const batchAlreadyCompleted = !hasRows(claimedBatch);
    if (
      number(completedBatch.rows[0]?.expected_recipients) !== 3
      || number(completedBatch.rows[0]?.reward_per_user) !== 1000
    ) {
      throw new Error('Параметры уникальной beta-выдачи не совпадают с ожидаемыми.');
    }
    const activeBetaUserIds = [];
    if (!batchAlreadyCompleted) {
      for (let index = 0; index < frames.length; index += 1) {
        activeBetaUserIds.push(await resolveTelegramAchievementUser(
          client,
          configuredIds[index] || '',
          frames[index]
        ));
      }
      if (new Set(activeBetaUserIds).size !== 3) {
        throw new Error('Три beta-профиля должны принадлежать трём разным Telegram-пользователям.');
      }
    }

    const locks = [...new Set([
      ...(ownerId ? [ownerId] : []),
      ...activeBetaUserIds
    ])].sort((left, right) => Number(left) - Number(right));
    for (const userId of locks) {
      await client.query('SELECT id FROM users WHERE id = $1::bigint FOR UPDATE', [userId]);
      await ensureUserRewardAccounts(client, userId);
    }

    let creatorGranted = false;
    if (ownerId) {
      creatorGranted = await awardAchievement(
        client,
        ownerId,
        definitionByCode('creator'),
        '',
        { announcedAt: new Date() }
      );
    }
    const creatorLedger = await client.query(
      `SELECT
         COUNT(*)::integer AS grant_count,
         COUNT(DISTINCT user_id)::integer AS user_count,
         COUNT(*) FILTER (WHERE user_id = $1::bigint)::integer AS intended_count
       FROM reward_grants
       WHERE source = 'achievement' AND achievement_code = 'creator'`,
      [ownerId || '-1']
    );
    const creatorCheck = creatorLedger.rows[0] || {};
    if (
      number(creatorCheck.grant_count) > 1
      || number(creatorCheck.user_count) > 1
      || (ownerId && number(creatorCheck.intended_count) !== 1)
    ) {
      throw new Error('Уникальное достижение создателя связано не с тем профилем.');
    }

    let activeBetaGranted = 0;
    if (!batchAlreadyCompleted) {
      for (const userId of activeBetaUserIds) {
        if (await awardAchievement(client, userId, definitionByCode('active-beta-participant'))) {
          activeBetaGranted += 1;
        }
      }
    }

    const verificationIds = batchAlreadyCompleted
      ? ['-1', '-2', '-3']
      : activeBetaUserIds;
    const activeBetaLedger = await client.query(
      `SELECT
         COUNT(*)::integer AS grant_count,
         COUNT(DISTINCT user_id)::integer AS user_count,
         COALESCE(SUM(amount), 0)::bigint AS grant_amount,
         COUNT(*) FILTER (
           WHERE user_id IN ($1::bigint, $2::bigint, $3::bigint)
         )::integer AS intended_count
       FROM reward_grants
       WHERE source = 'achievement'
         AND achievement_code = 'active-beta-participant'`,
      verificationIds
    );
    const activeBetaTransactions = await client.query(
      `SELECT
         COUNT(*)::integer AS transaction_count,
         COUNT(DISTINCT client_id)::integer AS user_count,
         COALESCE(SUM(bonus_earned), 0)::bigint AS transaction_amount,
         COUNT(*) FILTER (
           WHERE client_id IN ($1::bigint, $2::bigint, $3::bigint)
         )::integer AS intended_count
       FROM transactions
       WHERE status = 'completed'
         AND reward_code = 'achievement:active-beta-participant'`,
      verificationIds
    );
    const grantCheck = activeBetaLedger.rows[0] || {};
    const transactionCheck = activeBetaTransactions.rows[0] || {};
    const grantCount = number(grantCheck.grant_count);
    const validGrantRecipients = batchAlreadyCompleted
      ? grantCount <= 3
        && number(grantCheck.user_count) === grantCount
        && number(grantCheck.grant_amount) === grantCount * 1000
      : grantCount === 3
        && number(grantCheck.user_count) === 3
        && number(grantCheck.grant_amount) === 3000
        && number(grantCheck.intended_count) === 3;
    const validActiveBetaLedger = (
      validGrantRecipients
      && number(transactionCheck.transaction_count) === 3
      && number(transactionCheck.user_count) === 3
      && number(transactionCheck.transaction_amount) === 3000
      && (batchAlreadyCompleted || number(transactionCheck.intended_count) === 3)
    );
    if (!validActiveBetaLedger) {
      throw new Error('Журнал уникального beta-достижения не прошёл проверку идемпотентности.');
    }

    await client.query('COMMIT');
    return {
      deferred: false,
      creatorResolved: Boolean(ownerId),
      creatorGranted,
      activeBetaResolved: batchAlreadyCompleted
        ? number(completedBatch.rows[0].expected_recipients)
        : activeBetaUserIds.length,
      activeBetaGranted,
      activeBetaLedgerCount: number(grantCheck.grant_count),
      activeBetaLedgerAmount: number(grantCheck.grant_amount),
      activeBetaTransactionCount: number(transactionCheck.transaction_count),
      activeBetaTransactionAmount: number(transactionCheck.transaction_amount)
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    release();
  }
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
