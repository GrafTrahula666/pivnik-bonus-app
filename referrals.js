import crypto from 'node:crypto';

export const REFERRAL_CODE_TTL_MS = 24 * 60 * 60 * 1000;
export const REFERRAL_QUALIFICATION_MS = 72 * 60 * 60 * 1000;
export const REFERRAL_TARGET_CENTS = 50_000;
export const REFERRER_REWARD_BONUS = 100;
export const INVITED_REWARD_BONUS = 50;
export const REFERRER_MONTHLY_REWARD_LIMIT = 10;

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value) {
  return value instanceof Date ? value : new Date(value);
}

function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function normalizeReferralCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function randomReferralCode() {
  const bytes = crypto.randomBytes(8);
  let suffix = '';
  for (const byte of bytes) suffix += REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length];
  return `PVK-${suffix}`;
}

async function acquireClient(db) {
  if (typeof db?.connect === 'function') {
    const client = await db.connect();
    return { client, release: () => client.release() };
  }
  return { client: db, release: () => {} };
}

export async function ensureReferralCode(db, userId) {
  const existing = await db.query(
    'SELECT code FROM referral_codes WHERE user_id = $1::bigint',
    [userId]
  );
  if (existing.rows.length) return existing.rows[0].code;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomReferralCode();
    try {
      const inserted = await db.query(
        `INSERT INTO referral_codes (user_id, code)
         VALUES ($1::bigint, $2)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING code`,
        [userId, code]
      );
      if (inserted.rows.length) return inserted.rows[0].code;
      const replay = await db.query(
        'SELECT code FROM referral_codes WHERE user_id = $1::bigint',
        [userId]
      );
      if (replay.rows.length) return replay.rows[0].code;
    } catch (error) {
      if (error?.code === '23505') continue;
      throw error;
    }
  }
  throw new Error('Не удалось создать уникальный referral-код.');
}

async function qualifyingPurchases(db, referral, now = new Date()) {
  const upperBound = new Date(
    Math.min(date(now).getTime(), date(referral.qualified_deadline).getTime())
  );
  const result = await db.query(
    `SELECT
       COALESCE(SUM(t.cash_paid_cents), 0)::bigint AS amount_cents,
       COALESCE(
         JSON_AGG(t.id ORDER BY t.completed_at, t.id)
           FILTER (WHERE t.id IS NOT NULL),
         '[]'::json
       ) AS transaction_ids
     FROM transactions t
     WHERE t.client_id = $1::bigint
       AND t.status = 'completed'
       AND t.mode IN ('accrue', 'redeem')
       AND t.cash_paid_cents > 0
       AND t.completed_at IS NOT NULL
       AND t.completed_at >= $2::timestamptz
       AND t.completed_at <= $3::timestamptz`,
    [
      referral.invited_user_id,
      referral.applied_at,
      upperBound
    ]
  );
  return {
    amountCents: number(result.rows[0]?.amount_cents),
    transactionIds: Array.isArray(result.rows[0]?.transaction_ids)
      ? result.rows[0].transaction_ids.map(String)
      : []
  };
}

async function inviterRewardCountThisMonth(db, inviterUserId, now = new Date()) {
  const result = await db.query(
    `SELECT COUNT(*)::integer AS count
     FROM reward_grants
     WHERE user_id = $1::bigint
       AND source = 'referral'
       AND amount = $2::bigint
       AND created_at >= (
         date_trunc('month', $3::timestamptz AT TIME ZONE 'Europe/Moscow')
         AT TIME ZONE 'Europe/Moscow'
       )
       AND created_at < (
         (date_trunc('month', $3::timestamptz AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 month')
         AT TIME ZONE 'Europe/Moscow'
       )`,
    [inviterUserId, REFERRER_REWARD_BONUS, now]
  );
  return number(result.rows[0]?.count);
}

async function grantReferralReward(db, {
  rewardCode,
  userId,
  amount,
  reason
}) {
  await db.query(
    `INSERT INTO wallets (user_id, balance)
     VALUES ($1::bigint, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const grant = await db.query(
    `INSERT INTO reward_grants (code, user_id, amount, source)
     VALUES ($1, $2::bigint, $3::bigint, 'referral')
     ON CONFLICT (code, user_id) DO NOTHING
     RETURNING user_id`,
    [rewardCode, userId, amount]
  );
  if (!grant.rows.length) return false;

  const wallet = await db.query(
    `UPDATE wallets
     SET balance = balance + $1::bigint, updated_at = NOW()
     WHERE user_id = $2::bigint
     RETURNING balance`,
    [amount, userId]
  );
  const balanceAfter = number(wallet.rows[0]?.balance);

  await db.query(
    `INSERT INTO transactions (
       request_key, client_id, mode, status,
       check_amount_cents, discount_cents, bonus_spent, bonus_earned,
       cash_paid_cents, balance_after, reason, reward_code, completed_at
     ) VALUES (
       $1, $2::bigint, 'referral', 'completed',
       0, 0, 0, $3::bigint,
       0, $4::bigint, $5, $6, NOW()
     )
     ON CONFLICT (request_key) DO NOTHING`,
    [
      `reward:${userId}:${rewardCode}`,
      userId,
      amount,
      balanceAfter,
      reason,
      rewardCode
    ]
  );
  return true;
}

async function reconcileReferralLocked(db, referral, now = new Date()) {
  const nowDate = date(now);
  const progress = await qualifyingPurchases(db, referral, nowDate);

  if (referral.status !== 'active') {
    return { referral, ...progress };
  }

  if (progress.amountCents >= REFERRAL_TARGET_CENTS) {
    const rewardCode = `referral:${referral.invited_user_id}:qualified`;
    const inviterRewardsThisMonth = await inviterRewardCountThisMonth(
      db,
      referral.inviter_user_id,
      nowDate
    );
    if (inviterRewardsThisMonth < REFERRER_MONTHLY_REWARD_LIMIT) {
      await grantReferralReward(db, {
        rewardCode,
        userId: referral.inviter_user_id,
        amount: REFERRER_REWARD_BONUS,
        reason: 'Награда за приглашённого друга'
      });
    }
    await grantReferralReward(db, {
      rewardCode,
      userId: referral.invited_user_id,
      amount: INVITED_REWARD_BONUS,
      reason: 'Награда по программе «Пригласи друга»'
    });

    const updated = await db.query(
      `UPDATE referrals
       SET status = 'rewarded',
           rewarded_at = COALESCE(rewarded_at, NOW()),
           updated_at = NOW()
       WHERE id = $1::bigint AND status = 'active'
       RETURNING *`,
      [referral.id]
    );
    return {
      referral: updated.rows[0] || { ...referral, status: 'rewarded', rewarded_at: nowDate },
      ...progress
    };
  }

  if (nowDate.getTime() > date(referral.qualified_deadline).getTime()) {
    const updated = await db.query(
      `UPDATE referrals
       SET status = 'expired', updated_at = NOW()
       WHERE id = $1::bigint AND status = 'active'
       RETURNING *`,
      [referral.id]
    );
    return {
      referral: updated.rows[0] || { ...referral, status: 'expired' },
      ...progress
    };
  }

  return { referral, ...progress };
}

export async function reconcileReferral(db, invitedUserId, options = {}) {
  const now = options.now ? date(options.now) : new Date();
  const { client, release } = await acquireClient(db);
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT *
       FROM referrals
       WHERE invited_user_id = $1::bigint
       FOR UPDATE`,
      [invitedUserId]
    );
    if (!result.rows.length) {
      await client.query('COMMIT');
      return null;
    }
    const reconciled = await reconcileReferralLocked(client, result.rows[0], now);
    await client.query('COMMIT');
    return reconciled;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    release();
  }
}

function publicReferralState(referral, progress, now = new Date()) {
  if (!referral) return null;
  const completed = referral.status === 'rewarded';
  const expired = referral.status === 'expired';
  const remainingSeconds = completed || expired
    ? 0
    : Math.max(
        0,
        Math.floor(
          (date(referral.qualified_deadline).getTime() - date(now).getTime()) / 1000
        )
      );

  return {
    linked: true,
    purchasesCents: completed
      ? Math.max(progress.amountCents, REFERRAL_TARGET_CENTS)
      : progress.amountCents,
    targetCents: REFERRAL_TARGET_CENTS,
    remainingSeconds,
    completed,
    expired,
    appliedAt: referral.applied_at,
    qualifiedDeadline: referral.qualified_deadline,
    message: completed
      ? 'Условие выполнено — награды начислены'
      : expired
        ? 'Срок выполнения условия завершён'
        : 'Покупки учитываются'
  };
}

export async function getReferralOverview(db, userId, options = {}) {
  const now = options.now ? date(options.now) : new Date();
  await reconcileReferral(db, userId, { now }).catch((error) => {
    if (error?.code !== 'REFERRAL_NOT_FOUND') throw error;
  });

  const ownCode = await ensureReferralCode(db, userId);
  const [userResult, referralResult, inviterStatsResult] = await Promise.all([
    db.query(
      `SELECT id, created_at
       FROM users
       WHERE id = $1::bigint
         AND merged_into_user_id IS NULL
         AND deleted_at IS NULL`,
      [userId]
    ),
    db.query(
      `SELECT *
       FROM referrals
       WHERE invited_user_id = $1::bigint`,
      [userId]
    ),
    db.query(
      `SELECT
         COUNT(*)::integer AS invited_count,
         COUNT(*) FILTER (WHERE status = 'rewarded')::integer AS rewarded_count
       FROM referrals
       WHERE inviter_user_id = $1::bigint`,
      [userId]
    )
  ]);
  if (!userResult.rows.length) {
    throw httpError('Пользователь не найден.', 404, 'USER_NOT_FOUND');
  }

  const registeredAt = date(userResult.rows[0].created_at);
  const applyDeadline = new Date(registeredAt.getTime() + REFERRAL_CODE_TTL_MS);
  const referral = referralResult.rows[0] || null;
  const progress = referral
    ? await qualifyingPurchases(db, referral, now)
    : { amountCents: 0, transactionIds: [] };

  return {
    ownCode,
    rewards: {
      inviterBonus: REFERRER_REWARD_BONUS,
      invitedBonus: INVITED_REWARD_BONUS
    },
    registrationWindow: {
      canApply: !referral && now.getTime() <= applyDeadline.getTime(),
      deadline: applyDeadline
    },
    inviterStats: {
      invited: number(inviterStatsResult.rows[0]?.invited_count),
      rewarded: number(inviterStatsResult.rows[0]?.rewarded_count),
      monthlyRewardLimit: REFERRER_MONTHLY_REWARD_LIMIT,
      rewardedThisMonth: await inviterRewardCountThisMonth(db, userId, now)
    },
    referral: publicReferralState(referral, progress, now)
  };
}

export async function applyReferralCode(db, invitedUserId, rawCode, options = {}) {
  const now = options.now ? date(options.now) : new Date();
  const code = normalizeReferralCode(rawCode);
  if (!/^PVK-[A-Z2-9]{8}$/.test(code)) {
    throw httpError('Некорректный referral-код.', 400, 'INVALID_REFERRAL_CODE');
  }

  const { client, release } = await acquireClient(db);
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT id, created_at
       FROM users
       WHERE id = $1::bigint
         AND merged_into_user_id IS NULL
         AND deleted_at IS NULL
       FOR UPDATE`,
      [invitedUserId]
    );
    if (!userResult.rows.length) {
      throw httpError('Пользователь не найден.', 404, 'USER_NOT_FOUND');
    }

    const existing = await client.query(
      `SELECT *
       FROM referrals
       WHERE invited_user_id = $1::bigint
       FOR UPDATE`,
      [invitedUserId]
    );
    if (existing.rows.length) {
      if (normalizeReferralCode(existing.rows[0].referral_code) !== code) {
        throw httpError(
          'Referral-код уже был применён и изменить его нельзя.',
          409,
          'REFERRAL_ALREADY_BOUND'
        );
      }
      const reconciled = await reconcileReferralLocked(client, existing.rows[0], now);
      await client.query('COMMIT');
      return {
        applied: false,
        idempotent: true,
        referral: publicReferralState(reconciled.referral, reconciled, now)
      };
    }

    const registeredAt = date(userResult.rows[0].created_at);
    const applyDeadline = new Date(registeredAt.getTime() + REFERRAL_CODE_TTL_MS);
    if (now.getTime() > applyDeadline.getTime()) {
      throw httpError(
        'Referral-код можно ввести только в первые 24 часа после регистрации.',
        410,
        'REFERRAL_CODE_WINDOW_EXPIRED'
      );
    }

    const priorPurchase = await client.query(
      `SELECT 1
       FROM transactions
       WHERE client_id = $1::bigint
         AND status = 'completed'
         AND mode IN ('accrue', 'redeem')
         AND cash_paid_cents > 0
         AND completed_at IS NOT NULL
         AND completed_at < $2::timestamptz
       LIMIT 1`,
      [invitedUserId, now]
    );
    if (priorPurchase.rows.length) {
      throw httpError(
        'Referral-код нужно применить до первой покупки.',
        409,
        'REFERRAL_PURCHASE_ALREADY_EXISTS'
      );
    }

    const inviterResult = await client.query(
      `SELECT rc.user_id, rc.code
       FROM referral_codes rc
       JOIN users u ON u.id = rc.user_id
       WHERE rc.code = $1
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [code]
    );
    if (!inviterResult.rows.length) {
      throw httpError('Referral-код не найден.', 404, 'REFERRAL_CODE_NOT_FOUND');
    }

    const inviterUserId = String(inviterResult.rows[0].user_id);
    if (inviterUserId === String(invitedUserId)) {
      throw httpError(
        'Нельзя использовать собственный referral-код.',
        409,
        'SELF_REFERRAL'
      );
    }

    const qualifiedDeadline = new Date(now.getTime() + REFERRAL_QUALIFICATION_MS);
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO referrals (
           inviter_user_id,
           invited_user_id,
           referral_code,
           invited_registered_at,
           applied_at,
           qualified_deadline,
           status
         ) VALUES (
           $1::bigint,
           $2::bigint,
           $3,
           $4::timestamptz,
           $5::timestamptz,
           $6::timestamptz,
           'active'
         )
         RETURNING *`,
        [
          inviterUserId,
          invitedUserId,
          code,
          registeredAt,
          now,
          qualifiedDeadline
        ]
      );
    } catch (error) {
      if (error?.code === '23505') {
        throw httpError(
          'Referral-код уже был применён и изменить его нельзя.',
          409,
          'REFERRAL_ALREADY_BOUND'
        );
      }
      throw error;
    }

    await client.query('COMMIT');
    return {
      applied: true,
      idempotent: false,
      referral: publicReferralState(
        inserted.rows[0],
        { amountCents: 0, transactionIds: [] },
        now
      )
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    release();
  }
}

export async function expireOverdueReferrals(db, options = {}) {
  const now = options.now ? date(options.now) : new Date();
  const limit = Math.max(1, Math.min(1000, Math.trunc(number(options.limit) || 200)));
  const due = await db.query(
    `SELECT invited_user_id
     FROM referrals
     WHERE status = 'active'
       AND qualified_deadline < $1::timestamptz
     ORDER BY qualified_deadline
     LIMIT $2::integer`,
    [now, limit]
  );

  let rewarded = 0;
  let expired = 0;
  for (const row of due.rows) {
    const result = await reconcileReferral(db, row.invited_user_id, { now });
    if (result?.referral?.status === 'rewarded') rewarded += 1;
    if (result?.referral?.status === 'expired') expired += 1;
  }
  return { checked: due.rows.length, rewarded, expired };
}
