import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  getUserEarnedAchievementState,
  syncUserAchievements
} from './achievements.js';
import {
  chooseCanonicalUser,
  hashLinkCode,
  normalizeLinkCode as normalizeCoreLinkCode,
  planMergedLedger,
  signSession as signCoreSession,
  strongestRole,
  validateTelegramInitData as validateCoreTelegramInitData,
  validateLinkConsumption,
  validateVkLaunchParams as validateCoreVkLaunchParams,
  verifySession as verifyCoreSession
} from './platform-core.js';
import { resolvePersonalQrRecord } from './qr-resolver.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicPort = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.PIVNIK_INTERNAL_PORT || (publicPort === 3101 ? 3102 : 3101));
const databaseUrl = String(process.env.DATABASE_URL || '');
const telegramBotToken = String(process.env.TELEGRAM_BOT_TOKEN || '');
const ownerTelegramId = String(process.env.OWNER_TELEGRAM_ID || '').trim();
const ownerVkId = String(process.env.OWNER_VK_ID || '').trim();
const annaTelegramId = String(process.env.ANNA_TELEGRAM_ID || '').trim();
const vkAppId = String(process.env.VK_APP_ID || '').trim();
const vkAppSecret = String(process.env.VK_APP_SECRET || '').trim();
const allowDemo = String(process.env.ALLOW_DEMO || '').toLowerCase() === 'true';
const configuredSessionSecret = String(process.env.SESSION_SECRET || '');
const isTestImport = process.env.NODE_ENV === 'test'
  && process.env.PIVNIK_TEST_IMPORT === '1';

const TERMS_VERSION = 'beta-0.4';
const EXPECTED_VK_APP_ID = '54694987';
const WELCOME_BONUS = 100;
const BETA_TESTER_BONUS = 150;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const VK_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BAR_CODE = 'pivnik';
const BAR_NAME = 'ПИВНИК';
const BAR_ADDRESS = 'Санкт-Петербург, пр. Энгельса, 55';
const BEER_PAID_TARGET_ML = 14_000;
const UNLIMITED_BONUS_BALANCE = 9_999_999_999_999;
const MIGRATION_CHECKSUM_UPGRADES = Object.freeze({
  '001_add_platform_identities.sql': Object.freeze({
    from: '9ab2721fcfaf7f57756d31e422eb781776c52680b10a0facb233be053d96ceca',
    to: 'ee37be489bbf1675930a0af7e90d4e02a5f6cf37689c002cf56b3e8d37ba4c54'
  })
});

const STATUS_LEVELS = [
  { minCents: 0, name: 'Путник', bonusPercent: 5, discountPercent: 0, nextCents: 1_000_000 },
  { minCents: 1_000_000, name: 'Странник', bonusPercent: 6, discountPercent: 0, nextCents: 3_000_000 },
  { minCents: 3_000_000, name: 'Гость таверны', bonusPercent: 7, discountPercent: 0, nextCents: 7_000_000 },
  { minCents: 7_000_000, name: 'Завсегдатай', bonusPercent: 8, discountPercent: 0, nextCents: 10_000_000 },
  { minCents: 10_000_000, name: 'Местный пьяница', bonusPercent: 9, discountPercent: 0, nextCents: 15_000_000 },
  { minCents: 15_000_000, name: 'Легендарный пьяница', bonusPercent: 10, discountPercent: 0, nextCents: 50_000_000 },
  { minCents: 50_000_000, name: 'Король Пивника', bonusPercent: 20, discountPercent: 10, nextCents: null }
];

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (vkAppId && vkAppId !== EXPECTED_VK_APP_ID) {
  console.error('VK_APP_ID does not match the configured Pivnik application.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && configuredSessionSecret.length < 32) {
  console.error('SESSION_SECRET must contain at least 32 characters in production.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && allowDemo) {
  console.error('ALLOW_DEMO cannot be enabled in production.');
  process.exit(1);
}

const useSsl = !databaseUrl.includes('railway.internal');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const sessionSecret = crypto
  .createHash('sha256')
  .update(configuredSessionSecret || `pivnik:${telegramBotToken || 'local-development'}`)
  .digest();

let platformReady = false;
let childReady = false;
let shuttingDown = false;
const rateLimitBuckets = new Map();

function requestAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    throw Object.assign(new Error('Слишком много запросов. Повторите позже.'), {
      statusCode: 429
    });
  }
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  if (rateLimitBuckets.size > 5000) {
    for (const [bucketKey, timestamps] of rateLimitBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) {
        rateLimitBuckets.delete(bucketKey);
      }
    }
  }
}

function enforceMutationOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    throw Object.assign(new Error('Запрос с постороннего сайта отклонён.'), { statusCode: 403 });
  }
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    if (originUrl.host !== expectedHost) {
      throw Object.assign(new Error('Источник запроса не совпадает с приложением.'), {
        statusCode: 403
      });
    }
  } catch (error) {
    if (error?.statusCode) throw error;
    throw Object.assign(new Error('Некорректный источник запроса.'), { statusCode: 403 });
  }
}

function safeText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback).trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return text.slice(0, maxLength) || fallback;
}

function safeHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.toString().slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function makeShortCode(prefix = 'PVK') {
  const chars = Array.from({ length: 8 }, () => QR_ALPHABET[crypto.randomInt(0, QR_ALPHABET.length)]).join('');
  return `${prefix}-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function makeLinkCode() {
  const chars = Array.from({ length: 8 }, () => LINK_ALPHABET[crypto.randomInt(0, LINK_ALPHABET.length)]).join('');
  return `PIV-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function normalizeLinkCode(value) {
  return normalizeCoreLinkCode(value);
}

function linkCodeHash(value) {
  return hashLinkCode(value, sessionSecret);
}

function signSession(payload) {
  return signCoreSession(payload, sessionSecret);
}

function verifySession(token) {
  return verifyCoreSession(token, sessionSecret);
}

function createSession(userId, platform = 'unknown', sessionVersion = 1, extra = {}) {
  return signSession({
    uid: String(userId),
    platform,
    sv: Number(sessionVersion),
    exp: Date.now() + SESSION_TTL_MS,
    ...extra
  });
}

function rubles(cents) {
  return Number(cents || 0) / 100;
}

function litersFromMl(ml) {
  return Number(ml || 0) / 1000;
}

function isOwnerRow(row) {
  return Boolean(ownerTelegramId && String(row?.telegram_id || '') === ownerTelegramId)
    || Boolean(row?.role === 'admin');
}

function isAnnaRow(row) {
  const telegramId = String(row?.telegram_id || '');
  return Boolean(annaTelegramId && telegramId === annaTelegramId);
}

function hasUnlimitedBonus(row) {
  return Boolean(row?.unlimited_bonus) || isOwnerRow(row) || row?.role === 'viewer';
}

function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  if (storedFrame === 'anna') return 'none';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}

function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  if (isAnnaRow(row)) return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];
  const frames = [{ code: 'none', title: 'Без рамки' }];
  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') {
    frames.push({ code: 'diamond', title: 'Алмазная рамка' });
  }
  return frames;
}

function achievementsFromRow(row) {
  const achievements = [];
  if (isOwnerRow(row)) {
    achievements.push({
      code: 'creator',
      title: 'Создатель',
      rarity: 'legendary',
      description: 'Единственное в своём роде. Выдано создателю приложения «Пивник».',
      icon: 'all-seeing-eye',
      rewardBonus: 0,
      grantedAt: null,
      announced: true
    });
  }
  if (Number(row?.beta_number || 0) > 0 && Number(row.beta_number) <= 30) {
    achievements.push({
      code: 'beta-tester',
      title: 'Тестировщик',
      rarity: 'legendary',
      description: 'Легендарное достижение первых 30 участников закрытого бета-теста «Пивника».',
      icon: 'beta',
      rewardBonus: BETA_TESTER_BONUS,
      grantedAt: row.created_at || null,
      announced: true
    });
  }
  return achievements;
}

function getStatus(spendCents) {
  return [...STATUS_LEVELS].reverse().find((item) => spendCents >= item.minCents) || STATUS_LEVELS[0];
}

function getEffectiveStatus(row, spendCents) {
  return hasUnlimitedBonus(row) ? STATUS_LEVELS[STATUS_LEVELS.length - 1] : getStatus(spendCents);
}

function validateVkLaunchParams(rawLaunchParams) {
  const result = validateCoreVkLaunchParams(rawLaunchParams, {
    appId: vkAppId,
    appSecret: vkAppSecret,
    maxAgeSeconds: VK_AUTH_MAX_AGE_SECONDS
  });
  return {
    userId: result.userId,
    languageCode: safeText(result.languageCode, 12, 'ru'),
    platform: safeText(result.platform, 40, 'vk')
  };
}

function validateTelegramInitData(initData) {
  const user = validateCoreTelegramInitData(initData, {
    botToken: telegramBotToken,
    maxAgeSeconds: VK_AUTH_MAX_AGE_SECONDS
  });
  return {
    id: user.id,
    username: safeText(user.username, 100, ''),
    firstName: safeText(user.firstName, 80, 'Гость'),
    lastName: safeText(user.lastName, 80, ''),
    photoUrl: safeHttpsUrl(user.photoUrl),
    languageCode: safeText(user.languageCode, 12, 'ru')
  };
}

async function waitForChild(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${internalPort}/api/health`, {
        signal: AbortSignal.timeout(1500)
      });
      if (response.ok) {
        childReady = true;
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Основной сервер Пивника не запустился вовремя.');
}

async function runSqlMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      code TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    "SELECT pg_advisory_lock(hashtext('pivnik-schema-migrations-v1'))"
  );
  try {
    const migrationDirectory = path.join(__dirname, 'migrations');
    const migrationFiles = (await fs.readdir(migrationDirectory))
      .filter((file) => /^\d+_.+\.sql$/i.test(file))
      .sort();

    for (const file of migrationFiles) {
      const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        'SELECT checksum FROM schema_migrations WHERE code = $1',
        [file]
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          const upgrade = MIGRATION_CHECKSUM_UPGRADES[file];
          if (upgrade?.from !== existing.rows[0].checksum || upgrade.to !== checksum) {
            throw new Error(`Migration ${file} was changed after it was applied.`);
          }
          try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query(
              `UPDATE schema_migrations
               SET checksum = $2, applied_at = NOW()
               WHERE code = $1 AND checksum = $3`,
              [file, checksum, existing.rows[0].checksum]
            );
            await client.query('COMMIT');
          } catch (error) {
            try { await client.query('ROLLBACK'); } catch {}
            throw error;
          }
        }
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (code, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      }
    }
  } finally {
    await client.query(
      "SELECT pg_advisory_unlock(hashtext('pivnik-schema-migrations-v1'))"
    ).catch(() => {});
  }
}

async function claimDataMigration(client, code) {
  const result = await client.query(
    `INSERT INTO platform_migrations (code)
     VALUES ($1)
     ON CONFLICT (code) DO NOTHING
     RETURNING code`,
    [code]
  );
  return Boolean(result.rowCount);
}

async function initPlatformDatabase() {
  const client = await pool.connect();
  try {
    await runSqlMigrations(client);
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO bars (code, name, address)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, address = EXCLUDED.address, updated_at = NOW()`,
      [BAR_CODE, BAR_NAME, BAR_ADDRESS]
    );

    if (await claimDataMigration(client, 'backfill-platform-identities-v1')) {
      await client.query(`
        INSERT INTO user_identities (
          user_id, provider, provider_user_id, provider_username, profile_url
        )
        SELECT id, 'telegram', telegram_id::text, username, photo_url
        FROM users
        WHERE telegram_id IS NOT NULL AND merged_into_user_id IS NULL
        ON CONFLICT (provider, provider_user_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            provider_username = EXCLUDED.provider_username,
            profile_url = EXCLUDED.profile_url,
            updated_at = NOW()
      `);
    }

    if (await claimDataMigration(client, 'backfill-reward-grants-v2')) {
      await client.query(`
        INSERT INTO reward_grants (code, user_id, amount, source, created_at)
        SELECT 'welcome-100', t.client_id, MAX(t.bonus_earned)::bigint,
               'legacy-transaction', MIN(t.created_at)
        FROM transactions t
        JOIN users u ON u.id = t.client_id
        WHERE t.mode = 'welcome'
          AND t.status = 'completed'
          AND u.merged_into_user_id IS NULL
        GROUP BY t.client_id
        ON CONFLICT (code, user_id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO reward_grants (code, user_id, amount, source, created_at)
        SELECT bg.code, bg.user_id, bg.amount, 'legacy-beta-grant', bg.created_at
        FROM beta_grants bg
        JOIN users u ON u.id = bg.user_id
        WHERE u.merged_into_user_id IS NULL
        ON CONFLICT (code, user_id) DO NOTHING
      `);
      await client.query(`
        UPDATE transactions
        SET reward_code = 'welcome-100'
        WHERE reward_code IS NULL AND mode = 'welcome'
      `);
      await client.query(`
        UPDATE transactions
        SET reward_code = 'beta-tester-legendary'
        WHERE reward_code IS NULL
          AND mode = 'adjustment'
          AND reason = 'Легендарное достижение «Тестировщик»'
      `);
    }

    if (await claimDataMigration(client, 'force-explicit-consent-beta-0.4-v1')) {
      await client.query(`
        UPDATE users
        SET terms_accepted_at = NULL,
            terms_version = NULL,
            updated_at = NOW()
        WHERE merged_into_user_id IS NULL
      `);
    }

    if (await claimDataMigration(client, 'backfill-bar-customers-v1')) {
      await client.query(`
        INSERT INTO bar_customers (bar_id, user_id)
        SELECT b.id, u.id
        FROM bars b
        CROSS JOIN users u
        WHERE b.code = $1 AND u.merged_into_user_id IS NULL
        ON CONFLICT (bar_id, user_id) DO NOTHING
      `, [BAR_CODE]);
    }

    await client.query(`
      DELETE FROM account_link_codes
      WHERE (used_at IS NOT NULL AND used_at < NOW() - INTERVAL '7 days')
         OR expires_at < NOW() - INTERVAL '1 day'
    `);
    await client.query(`
      DELETE FROM account_link_attempts
      WHERE attempted_at < NOW() - INTERVAL '7 days'
    `);

    await client.query('COMMIT');
    platformReady = true;
    console.log('Unified Telegram/VK account schema is ready.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function canonicalUserId(db, rawUserId) {
  let userId = String(rawUserId || '').trim();
  if (!/^\d+$/.test(userId)) return null;
  for (let hop = 0; hop < 12; hop += 1) {
    const result = await db.query(
      'SELECT id, merged_into_user_id FROM users WHERE id = $1::bigint',
      [userId]
    );
    if (!result.rowCount) return null;
    const next = result.rows[0].merged_into_user_id;
    if (!next) return String(result.rows[0].id);
    userId = String(next);
  }
  throw new Error('Обнаружена циклическая привязка аккаунтов.');
}

async function canonicalizeSessionToken(rawToken) {
  const payload = verifySession(rawToken);
  if (!payload) return { token: rawToken, payload: null, userId: null };

  const subjects = payload.kind === 'staff'
    ? [
      ['terminalUid', 'terminalSv'],
      ['staffUid', 'staffSv']
    ]
    : [['uid', 'sv']];
  for (const [idField, versionField] of subjects) {
    const rawId = String(payload[idField] || '');
    const suppliedVersion = Number(payload[versionField]);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(suppliedVersion)) {
      return { token: rawToken, payload: null, userId: null };
    }
    const result = await pool.query(
      `SELECT id, session_version, merged_into_user_id
       FROM users
       WHERE id = $1::bigint`,
      [rawId]
    );
    const row = result.rows[0];
    if (
      !row
      || row.merged_into_user_id
      || Number(row.session_version) !== suppliedVersion
    ) {
      return { token: rawToken, payload: null, userId: null };
    }
  }
  return {
    token: rawToken,
    payload,
    userId: payload.uid ? String(payload.uid) : null
  };
}

async function requireGatewayUser(req) {
  const raw = String(req.headers.authorization || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const normalized = await canonicalizeSessionToken(token);
  if (!normalized.payload || !normalized.userId) {
    throw Object.assign(new Error('Требуется вход в приложение.'), { statusCode: 401 });
  }
  const platform = normalized.payload.platform === 'vk' ? 'vk' : 'telegram';
  const providerUserId = String(normalized.payload.pid || '');
  const result = await pool.query(
    `SELECT u.id, u.terms_accepted_at, u.terms_version,
            EXISTS(
              SELECT 1
              FROM user_identities ui
              WHERE ui.user_id = u.id
                AND ui.provider = $2
                AND ui.provider_user_id = $3
            ) AS identity_matches
     FROM users u
     WHERE u.id = $1::bigint AND u.merged_into_user_id IS NULL`,
    [normalized.userId, platform, providerUserId]
  );
  if (!result.rowCount || !providerUserId || !result.rows[0].identity_matches) {
    throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 401 });
  }
  return {
    id: String(result.rows[0].id),
    token: normalized.token,
    payload: normalized.payload,
    platform,
    termsAccepted: Boolean(
      result.rows[0].terms_accepted_at
      && result.rows[0].terms_version === TERMS_VERSION
    )
  };
}

async function ensurePersonalQr(db, userId) {
  const current = await db.query(
    `SELECT qr_token, qr_short_code
     FROM users
     WHERE id = $1::bigint AND merged_into_user_id IS NULL`,
    [userId]
  );
  if (current.rowCount && current.rows[0].qr_token && current.rows[0].qr_short_code) {
    return current.rows[0];
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await db.query('SAVEPOINT personal_qr_generation');
    try {
      const result = await db.query(
        `UPDATE users
         SET qr_token = $1, qr_short_code = $2, updated_at = NOW()
         WHERE id = $3::bigint AND merged_into_user_id IS NULL
         RETURNING qr_token, qr_short_code`,
        [crypto.randomBytes(24).toString('base64url'), makeShortCode(), userId]
      );
      if (!result.rowCount) throw new Error('Пользователь для QR-кода не найден.');
      await db.query('RELEASE SAVEPOINT personal_qr_generation');
      return result.rows[0];
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT personal_qr_generation');
      await db.query('RELEASE SAVEPOINT personal_qr_generation');
      if (error.code === '23505') continue;
      throw error;
    }
  }
  throw new Error('Не удалось создать уникальный QR-код.');
}

async function getRollingSpend(db, userId) {
  const result = await db.query(
    `SELECT COALESCE(SUM(cash_paid_cents), 0)::bigint AS spend
     FROM transactions
     WHERE client_id = $1::bigint
       AND status = 'completed'
       AND mode IN ('accrue','redeem')
       AND created_at >= NOW() - INTERVAL '12 months'`,
    [userId]
  );
  return Number(result.rows[0]?.spend || 0);
}

async function getIdentitySummary(db, userId) {
  const result = await db.query(
    `SELECT provider, provider_user_id, provider_username
     FROM user_identities
     WHERE user_id = $1::bigint
     ORDER BY provider`,
    [userId]
  );
  const identities = result.rows.map((row) => ({
    provider: row.provider,
    id: row.provider_user_id,
    username: row.provider_username || null
  }));
  return {
    identities,
    linkedPlatforms: identities.map((item) => item.provider),
    accountLinked: identities.some((item) => item.provider === 'telegram')
      && identities.some((item) => item.provider === 'vk')
  };
}

async function getProfile(userId, platform = 'unknown', db = pool) {
  const canonical = await canonicalUserId(db, userId);
  if (!canonical) return null;

  const result = await db.query(
    `SELECT u.*, w.balance, bl.paid_ml_total, bl.gift_ml_balance,
            (SELECT COUNT(*)::integer
             FROM users ux
             WHERE ux.merged_into_user_id IS NULL
               AND (ux.created_at < u.created_at OR (ux.created_at = u.created_at AND ux.id <= u.id))) AS beta_number,
            EXISTS(
              SELECT 1 FROM beta_grants bg
              WHERE bg.user_id = u.id AND bg.code = 'profile-frame-diamond'
            ) AS owns_diamond_frame
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
     WHERE u.id = $1::bigint AND u.merged_into_user_id IS NULL`,
    [canonical]
  );
  if (!result.rowCount) return null;

  const row = result.rows[0];
  const [spend12mCents, achievementState] = await Promise.all([
    getRollingSpend(db, canonical),
    getUserEarnedAchievementState(db, canonical)
  ]);
  const unlimitedBonus = hasUnlimitedBonus(row);
  const status = getEffectiveStatus(row, spend12mCents);
  const identitySummary = await getIdentitySummary(db, canonical);

  return {
    id: String(row.id),
    telegramId: row.telegram_id === null ? null : String(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    avatarSource: row.avatar_source || 'preset_male',
    avatarKey: row.avatar_key || null,
    profileFrame: profileFrameFromRow(row),
    availableFrames: availableFramesFromRow(row),
    achievements: [...achievementsFromRow(row), ...achievementState.earned],
    unannouncedAchievements: achievementState.unannounced,
    unlimitedBonus,
    onboardingComplete: Boolean(row.onboarding_completed_at),
    ageGroup: row.age_group || null,
    privacy: {
      publicProfile: row.profile_public !== false,
      showName: row.show_name !== false,
      showAvatar: row.show_avatar !== false,
      showMonthlySpend: row.show_leaderboard_amount !== false,
      showStats: row.show_stats !== false
    },
    role: row.role,
    balance: unlimitedBonus ? UNLIMITED_BONUS_BALANCE : Number(row.balance || 0),
    qrShortCode: row.qr_short_code,
    termsAccepted: Boolean(row.terms_accepted_at && row.terms_version === TERMS_VERSION),
    termsAcceptedAt: row.terms_accepted_at,
    termsVersion: row.terms_version,
    spend12m: rubles(spend12mCents),
    vipStatusLocked: unlimitedBonus,
    beer: {
      paidMlTotal: Number(row.paid_ml_total || 0),
      paidLitersTotal: litersFromMl(row.paid_ml_total),
      progressMl: Number(row.paid_ml_total || 0) % BEER_PAID_TARGET_ML,
      progressLiters: litersFromMl(Number(row.paid_ml_total || 0) % BEER_PAID_TARGET_ML),
      paidTargetMl: BEER_PAID_TARGET_ML,
      paidTargetLiters: litersFromMl(BEER_PAID_TARGET_ML),
      giftMlBalance: Number(row.gift_ml_balance || 0),
      giftLitersBalance: litersFromMl(row.gift_ml_balance),
      nextGiftMl: BEER_PAID_TARGET_ML - (Number(row.paid_ml_total || 0) % BEER_PAID_TARGET_ML),
      nextGiftLiters: litersFromMl(BEER_PAID_TARGET_ML - (Number(row.paid_ml_total || 0) % BEER_PAID_TARGET_ML))
    },
    status: {
      name: status.name,
      bonusPercent: status.bonusPercent,
      discountPercent: status.discountPercent,
      minSpend: rubles(status.minCents),
      nextSpend: status.nextCents ? rubles(status.nextCents) : null
    },
    platform,
    bar: { code: BAR_CODE, name: BAR_NAME },
    ...identitySummary
  };
}


const PROFILE_AVATAR_SOURCES = new Set(['preset_male', 'preset_female', 'telegram', 'animal']);
const PROFILE_ANIMAL_AVATARS = new Set([
  '01-panda','02-cat','03-dog','04-fox','05-bear','06-rabbit','07-owl','08-raccoon','09-wolf','10-deer',
  '11-koala','12-tiger','13-red-panda','14-penguin','15-mouse','16-dragon','17-unicorn','18-griffin','19-fire-imp'
]);
const PROFILE_AGE_GROUPS = new Set(['18-24', '25-34', '35-44', '45-54', '55+']);

function leaderboardName(row) {
  const first = String(row.first_name || 'Гость').trim();
  const last = String(row.last_name || '').trim();
  return last ? `${first} ${last.slice(0, 1)}.` : first;
}

async function getUnifiedMonthlyLeaderboard(currentUserId) {
  const canonical = await canonicalUserId(pool, currentUserId);
  if (!canonical) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });

  const result = await pool.query(
    `WITH RECURSIVE user_map AS (
       SELECT id AS source_id, id AS canonical_id
       FROM users
       WHERE merged_into_user_id IS NULL
       UNION ALL
       SELECT u.id AS source_id, m.canonical_id
       FROM users u
       JOIN user_map m ON u.merged_into_user_id = m.source_id
     ), monthly_spend AS (
       SELECT um.canonical_id AS user_id,
              COALESCE(SUM(t.cash_paid_cents), 0)::bigint AS spend_cents
       FROM user_map um
       LEFT JOIN transactions t ON t.client_id = um.source_id
         AND t.status = 'completed'
         AND t.mode IN ('accrue','redeem')
         AND t.created_at >= (date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow')
         AND t.created_at < ((date_trunc('month', NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 month') AT TIME ZONE 'Europe/Moscow')
       GROUP BY um.canonical_id
     ), ranked AS (
       SELECT u.id, u.first_name, u.last_name, u.photo_url,
              u.avatar_source, u.avatar_key, u.profile_frame, u.role,
              u.telegram_id, u.unlimited_bonus,
              u.profile_public, u.show_name, u.show_avatar, u.show_leaderboard_amount,
              COALESCE(ms.spend_cents, 0)::bigint AS spend_cents,
              RANK() OVER (ORDER BY COALESCE(ms.spend_cents, 0) DESC, u.id ASC) AS rank
       FROM users u
       LEFT JOIN monthly_spend ms ON ms.user_id = u.id
       WHERE u.merged_into_user_id IS NULL
     )
     SELECT * FROM ranked
     ORDER BY rank, id`,
    []
  );

  const rows = result.rows;
  const current = rows.find((row) => String(row.id) === String(canonical)) || null;
  const leaders = rows.filter((row) => Number(row.spend_cents || 0) > 0).slice(0, 10);
  const month = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' }).format(new Date());

  return {
    month,
    prizeNote: 'После закрытия месяца участник на 1-м месте получает эпическое достижение и бесплатную пинту 0,5 л.',
    scope: 'telegram-vk',
    leaders: leaders.map((row) => {
      const isMe = String(row.id) === String(canonical);
      const publicProfile = row.profile_public !== false;
      const showName = isMe || (publicProfile && row.show_name !== false);
      const showAvatar = isMe || (publicProfile && row.show_avatar !== false);
      const showSpend = isMe || (publicProfile && row.show_leaderboard_amount !== false);
      return {
        rank: Number(row.rank),
        name: showName ? leaderboardName(row) : 'Скрытый гость',
        spend: showSpend ? rubles(row.spend_cents) : null,
        isMe,
        avatarSource: showAvatar ? (row.avatar_source || 'preset_male') : null,
        avatarKey: showAvatar ? (row.avatar_key || null) : null,
        photoUrl: showAvatar ? (row.photo_url || null) : null,
        profileFrame: showAvatar ? profileFrameFromRow(row) : 'none',
        showAvatar
      };
    }),
    me: current && Number(current.spend_cents || 0) > 0 ? {
      rank: Number(current.rank),
      spend: rubles(current.spend_cents)
    } : null
  };
}

async function updateUnifiedProfile(userId, platform, body) {
  const canonical = await canonicalUserId(pool, userId);
  if (!canonical) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });

  let avatarSource = String(body?.avatarSource || 'preset_male').trim();
  // The old UI calls the platform photo source "telegram" on both shells.
  if (avatarSource === 'vk') avatarSource = 'telegram';
  if (!PROFILE_AVATAR_SOURCES.has(avatarSource)) avatarSource = 'preset_male';

  const avatarKey = avatarSource === 'animal' && PROFILE_ANIMAL_AVATARS.has(String(body?.avatarKey || '').trim())
    ? String(body.avatarKey).trim()
    : null;
  if (avatarSource === 'animal' && !avatarKey) {
    throw Object.assign(new Error('Выберите аватар из коллекции.'), { statusCode: 400 });
  }

  const ageValue = String(body?.ageGroup || '').trim();
  const ageGroup = PROFILE_AGE_GROUPS.has(ageValue) ? ageValue : null;
  const privacy = body?.privacy && typeof body.privacy === 'object' ? body.privacy : {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rowResult = await client.query(
      `SELECT u.*, EXISTS(
         SELECT 1 FROM beta_grants bg
         WHERE bg.user_id = u.id AND bg.code = 'profile-frame-diamond'
       ) AS owns_diamond_frame
       FROM users u
       WHERE u.id = $1::bigint AND u.merged_into_user_id IS NULL
       FOR UPDATE`,
      [canonical]
    );
    if (!rowResult.rowCount) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });
    const row = rowResult.rows[0];

    if (avatarSource === 'telegram' && !row.photo_url) {
      throw Object.assign(
        new Error(platform === 'vk' ? 'В профиле VK нет доступной фотографии.' : 'В профиле Telegram нет доступной фотографии.'),
        { statusCode: 400 }
      );
    }

    const allowedFrames = availableFramesFromRow(row);
    const requestedFrame = String(body?.profileFrame || profileFrameFromRow(row) || 'none');
    let storedFrame = requestedFrame;
    if (isOwnerRow(row)) storedFrame = 'money';
    else if (isAnnaRow(row)) storedFrame = 'anna';
    else if (row.role === 'viewer') storedFrame = 'fire';
    else if (!allowedFrames.some((frame) => frame.code === requestedFrame)) {
      throw Object.assign(new Error('Эта рамка недоступна вашему аккаунту.'), { statusCode: 400 });
    }

    await client.query(
      `UPDATE users SET
         avatar_source = $1::text,
         avatar_key = $2::text,
         age_group = $3::text,
         profile_public = $4::boolean,
         show_name = $5::boolean,
         show_avatar = $6::boolean,
         show_leaderboard_amount = $7::boolean,
         show_stats = $8::boolean,
         profile_frame = $9::text,
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
         updated_at = NOW()
       WHERE id = $10::bigint`,
      [
        avatarSource,
        avatarKey,
        ageGroup,
        privacy.publicProfile !== false,
        privacy.showName !== false,
        privacy.showAvatar !== false,
        privacy.showMonthlySpend !== false,
        privacy.showStats !== false,
        storedFrame,
        canonical
      ]
    );
    await client.query('COMMIT');
    return { ok: true, profile: await getProfile(canonical, platform) };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function getUnifiedAdminUsers() {
  const result = await pool.query(
    `SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.role,
            u.created_at, u.qr_short_code, u.unlimited_bonus, u.profile_frame,
            w.balance, bl.paid_ml_total, bl.gift_ml_balance,
            (u.staff_pin_hash IS NOT NULL AND u.staff_pin_salt IS NOT NULL) AS pin_configured,
            (SELECT ui.provider_user_id
             FROM user_identities ui
             WHERE ui.user_id = u.id AND ui.provider = 'vk'
             LIMIT 1) AS vk_id,
            ARRAY(
              SELECT ui.provider FROM user_identities ui
              WHERE ui.user_id = u.id ORDER BY ui.provider
            ) AS linked_platforms
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
     WHERE u.merged_into_user_id IS NULL
     ORDER BY u.created_at DESC
     LIMIT 200`
  );
  return {
    users: result.rows.map((row) => ({
      id: String(row.id),
      telegramId: row.telegram_id === null ? null : String(row.telegram_id),
      vkId: row.vk_id === null ? null : String(row.vk_id),
      username: row.username,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      role: row.role,
      balance: hasUnlimitedBonus(row) ? UNLIMITED_BONUS_BALANCE : Number(row.balance || 0),
      unlimitedBonus: hasUnlimitedBonus(row),
      profileFrame: profileFrameFromRow(row),
      qrShortCode: row.qr_short_code,
      beerPaidLitersTotal: litersFromMl(row.paid_ml_total),
      beerGiftLitersBalance: litersFromMl(row.gift_ml_balance),
      pinConfigured: Boolean(row.pin_configured),
      linkedPlatforms: row.linked_platforms || [],
      createdAt: row.created_at
    }))
  };
}

async function getAppPayload(userId, platform = 'unknown') {
  await syncUserAchievements(pool, userId);
  const [profile, designResult] = await Promise.all([
    getProfile(userId, platform),
    pool.query('SELECT published FROM app_settings WHERE id = 1')
  ]);
  if (!profile) {
    throw Object.assign(new Error('Не удалось открыть профиль.'), { statusCode: 404 });
  }
  return {
    profile,
    statuses: STATUS_LEVELS.map((item) => ({
      ...item,
      min: rubles(item.minCents),
      next: item.nextCents ? rubles(item.nextCents) : null
    })),
    design: designResult.rows[0]?.published || null
  };
}

async function ensureBaseRecords(db, userId) {
  await db.query(
    'INSERT INTO wallets (user_id, balance) VALUES ($1::bigint, 0) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
  await db.query(
    'INSERT INTO beer_loyalty (user_id) VALUES ($1::bigint) ON CONFLICT (user_id) DO NOTHING',
    [userId]
  );
  await ensurePersonalQr(db, userId);
  const barResult = await db.query('SELECT id FROM bars WHERE code = $1', [BAR_CODE]);
  await db.query(
    `INSERT INTO bar_customers (bar_id, user_id)
     VALUES ($1, $2::bigint)
     ON CONFLICT (bar_id, user_id)
     DO UPDATE SET status = 'active', updated_at = NOW()`,
    [barResult.rows[0].id, userId]
  );
}

async function resolveProviderUser(provider, externalUser) {
  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`identity:${provider}:${externalUser.id}`]
    );

    const identity = await client.query(
      `SELECT ui.user_id
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider = $1 AND ui.provider_user_id = $2
       FOR UPDATE`,
      [provider, externalUser.id]
    );

    if (identity.rowCount) {
      userId = await canonicalUserId(client, identity.rows[0].user_id);
    }

    if (!userId && provider === 'telegram') {
      const legacy = await client.query(
        'SELECT id FROM users WHERE telegram_id::text = $1 FOR UPDATE',
        [externalUser.id]
      );
      if (legacy.rowCount) userId = await canonicalUserId(client, legacy.rows[0].id);
    }

    const isOwner = provider === 'telegram'
      ? Boolean(ownerTelegramId && externalUser.id === ownerTelegramId)
      : Boolean(ownerVkId && externalUser.id === ownerVkId);

    if (!userId && isOwner && provider === 'vk' && ownerTelegramId) {
      const owner = await client.query(
        'SELECT id FROM users WHERE telegram_id::text = $1 FOR UPDATE',
        [ownerTelegramId]
      );
      if (owner.rowCount) userId = await canonicalUserId(client, owner.rows[0].id);
    }

    if (!userId) {
      const inserted = await client.query(
        `INSERT INTO users (
           telegram_id, username, first_name, last_name, photo_url, language_code, role,
           terms_accepted_at, terms_version, onboarding_completed_at, unlimited_bonus, profile_frame
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           NULL, NULL, NULL, $8, $9
         )
         RETURNING id`,
        [
          provider === 'telegram' ? externalUser.id : null,
          externalUser.username || null,
          externalUser.firstName,
          externalUser.lastName || null,
          externalUser.photoUrl || null,
          externalUser.languageCode || 'ru',
          isOwner ? 'admin' : 'client',
          isOwner,
          isOwner ? 'money' : 'none'
        ]
      );
      userId = String(inserted.rows[0].id);
    } else {
      const identityCount = await client.query(
        'SELECT COUNT(*)::int AS count FROM user_identities WHERE user_id = $1::bigint',
        [userId]
      );
      const shouldUpdateMainProfile = provider === 'telegram' || Number(identityCount.rows[0]?.count || 0) === 0;
      if (shouldUpdateMainProfile) {
        await client.query(
          `UPDATE users
           SET username = $2,
               first_name = $3,
               last_name = $4,
               photo_url = $5,
               language_code = $6,
               role = CASE WHEN $7 = 'admin' THEN 'admin' ELSE role END,
               unlimited_bonus = CASE WHEN $7 = 'admin' THEN TRUE ELSE unlimited_bonus END,
               profile_frame = CASE WHEN $7 = 'admin' THEN 'money' ELSE profile_frame END,
               telegram_id = CASE WHEN $8 = 'telegram' THEN COALESCE(telegram_id, $9::bigint) ELSE telegram_id END,
               updated_at = NOW()
           WHERE id = $1::bigint`,
          [
            userId,
            externalUser.username || null,
            externalUser.firstName,
            externalUser.lastName || null,
            externalUser.photoUrl || null,
            externalUser.languageCode || 'ru',
            isOwner ? 'admin' : 'client',
            provider,
            provider === 'telegram' ? externalUser.id : null
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO user_identities (
         user_id, provider, provider_user_id, provider_username, profile_url
       ) VALUES ($1::bigint, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_user_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           provider_username = EXCLUDED.provider_username,
           profile_url = EXCLUDED.profile_url,
           updated_at = NOW()`,
      [
        userId,
        provider,
        externalUser.id,
        externalUser.username || null,
        externalUser.photoUrl || null
      ]
    );

    await ensureBaseRecords(client, userId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const sessionResult = await pool.query(
    'SELECT session_version FROM users WHERE id = $1::bigint AND merged_into_user_id IS NULL',
    [userId]
  );
  const token = createSession(
    userId,
    provider,
    Number(sessionResult.rows[0]?.session_version || 1),
    { pid: String(externalUser.id) }
  );
  return { token, ...(await getAppPayload(userId, provider)) };
}

async function authenticateVk(body) {
  let vkAuth;
  if (allowDemo && body?.demoVkId) {
    vkAuth = { userId: String(body.demoVkId), languageCode: 'ru', platform: 'demo' };
  } else {
    vkAuth = validateVkLaunchParams(body?.launchParams);
  }

  const rawUser = body?.user && typeof body.user === 'object' ? body.user : {};
  if (String(rawUser.id || '') && String(rawUser.id) !== vkAuth.userId) {
    throw Object.assign(new Error('Данные профиля VK не совпадают с подписью запуска.'), { statusCode: 401 });
  }

  return resolveProviderUser('vk', {
    id: vkAuth.userId,
    username: safeText(rawUser.screen_name, 100, `id${vkAuth.userId}`),
    firstName: safeText(rawUser.first_name, 80, 'Пользователь'),
    lastName: safeText(rawUser.last_name, 80, ''),
    photoUrl: safeHttpsUrl(rawUser.photo_200 || rawUser.photo_100 || rawUser.photo_max_orig),
    languageCode: vkAuth.languageCode
  });
}

async function authenticateTelegram(body) {
  let user;
  const initData = String(body?.initData || '');
  if (initData) {
    user = validateTelegramInitData(initData);
  } else if (allowDemo) {
    user = {
      id: String(body?.demoTelegramId || ownerTelegramId || '999000111'),
      username: 'demo_owner',
      firstName: 'Кирилл',
      lastName: 'Гамильтон',
      photoUrl: null,
      languageCode: 'ru'
    };
  } else {
    throw Object.assign(new Error('Откройте приложение через Telegram.'), { statusCode: 401 });
  }
  return resolveProviderUser('telegram', user);
}

async function grantReward(db, userId, code, amount, source, reason, mode = 'adjustment') {
  const grant = await db.query(
    `INSERT INTO reward_grants (code, user_id, amount, source)
     VALUES ($1, $2::bigint, $3::bigint, $4)
     ON CONFLICT (code, user_id) DO NOTHING
     RETURNING user_id`,
    [code, userId, amount, source]
  );
  if (!grant.rowCount) return { granted: false, amount: 0 };

  const wallet = await db.query(
    `UPDATE wallets
     SET balance = balance + $1::bigint, updated_at = NOW()
     WHERE user_id = $2::bigint
     RETURNING balance`,
    [amount, userId]
  );
  const balanceAfter = Number(wallet.rows[0]?.balance || 0);
  await db.query(
    `INSERT INTO transactions (
       request_key, client_id, mode, status, bonus_earned,
       balance_after, reason, reward_code, completed_at
     ) VALUES (
       $1, $2::bigint, $3, 'completed', $4::bigint,
       $5::bigint, $6, $7, NOW()
     )`,
    [`reward:${userId}:${code}`, userId, mode, amount, balanceAfter, reason, code]
  );
  return { granted: true, amount, balanceAfter };
}

async function acceptConsent(userId, platform) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);
    await client.query(
      `UPDATE users
       SET terms_accepted_at = NOW(), terms_version = $1, updated_at = NOW()
       WHERE id = $2::bigint`,
      [TERMS_VERSION, canonical]
    );
    const reward = await grantReward(
      client,
      canonical,
      'welcome-100',
      WELCOME_BONUS,
      'consent',
      'Приветственный бонус за регистрацию',
      'welcome'
    );

    const ordinalResult = await client.query(
      `SELECT (SELECT COUNT(*)::integer
               FROM users ux
               WHERE ux.merged_into_user_id IS NULL
                 AND (ux.created_at < u.created_at OR (ux.created_at = u.created_at AND ux.id <= u.id))) AS beta_number
       FROM users u
       WHERE u.id = $1::bigint`,
      [canonical]
    );
    const betaNumber = Number(ordinalResult.rows[0]?.beta_number || 0);
    let betaReward = { granted: false };
    if (betaNumber > 0 && betaNumber <= 30) {
      betaReward = await grantReward(
        client,
        canonical,
        'beta-tester-legendary',
        BETA_TESTER_BONUS,
        'closed-beta',
        'Легендарное достижение «Тестировщик»',
        'adjustment'
      );
      await client.query(
        `INSERT INTO beta_grants (code, user_id, amount)
         VALUES ('beta-tester-legendary', $1::bigint, $2::bigint)
         ON CONFLICT (code, user_id) DO NOTHING`,
        [canonical, BETA_TESTER_BONUS]
      );
    }

    await client.query('COMMIT');
    return {
      ok: true,
      grantedWelcome: reward.granted,
      grantedBetaTester: betaReward.granted,
      profile: await getProfile(canonical, platform)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function claimBetaTester(userId, platform) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const canonical = await canonicalUserId(client, userId);
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [canonical]);

    const userResult = await client.query(
      `SELECT terms_accepted_at, terms_version,
              (SELECT COUNT(*)::integer
               FROM users ux
               WHERE ux.merged_into_user_id IS NULL
                 AND (ux.created_at < u.created_at OR (ux.created_at = u.created_at AND ux.id <= u.id))) AS beta_number
       FROM users u
       WHERE u.id = $1::bigint`,
      [canonical]
    );
    if (!userResult.rowCount) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });
    const row = userResult.rows[0];
    if (!row.terms_accepted_at || row.terms_version !== TERMS_VERSION) {
      throw Object.assign(new Error('Сначала примите правила программы.'), { statusCode: 428 });
    }

    const betaNumber = Number(row.beta_number || 0);
    if (!betaNumber || betaNumber > 30) {
      await client.query('COMMIT');
      return { eligible: false, granted: false, profile: await getProfile(canonical, platform) };
    }

    const reward = await grantReward(
      client,
      canonical,
      'beta-tester-legendary',
      BETA_TESTER_BONUS,
      'closed-beta',
      'Легендарное достижение «Тестировщик»',
      'adjustment'
    );
    await client.query(
      `INSERT INTO beta_grants (code, user_id, amount)
       VALUES ('beta-tester-legendary', $1::bigint, $2::bigint)
       ON CONFLICT (code, user_id) DO NOTHING`,
      [canonical, BETA_TESTER_BONUS]
    );
    await client.query('COMMIT');
    return {
      eligible: true,
      granted: reward.granted,
      profile: await getProfile(canonical, platform)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getCurrentProvider(db, userId, requestedProvider) {
  const provider = requestedProvider === 'vk' ? 'vk' : 'telegram';
  const result = await db.query(
    `SELECT provider FROM user_identities
     WHERE user_id = $1::bigint AND provider = $2`,
    [userId, provider]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('Текущая платформа не принадлежит этому профилю.'), { statusCode: 403 });
  }
  return provider;
}

async function createAccountLinkCode(userId, requestedProvider) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const canonical = await canonicalUserId(client, userId);
    const provider = await getCurrentProvider(client, canonical, requestedProvider);
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`account-link-code:${canonical}`]
    );
    const summary = await getIdentitySummary(client, canonical);
    if (summary.accountLinked) {
      await client.query('COMMIT');
      return {
        alreadyLinked: true,
        ...summary,
        profile: await getProfile(canonical, provider)
      };
    }

    const recentCodes = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM account_link_codes
       WHERE user_id = $1::bigint
         AND created_at > NOW() - INTERVAL '15 minutes'`,
      [canonical]
    );
    if (Number(recentCodes.rows[0]?.count || 0) >= 5) {
      throw Object.assign(
        new Error('Слишком много кодов. Повторите через 15 минут.'),
        { statusCode: 429 }
      );
    }

    await client.query(
      `UPDATE account_link_codes
       SET used_at = COALESCE(used_at, NOW())
       WHERE user_id = $1::bigint AND used_at IS NULL`,
      [canonical]
    );

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = makeLinkCode();
      try {
        const inserted = await client.query(
          `INSERT INTO account_link_codes (
             user_id, source_provider, code_hash, expires_at
           ) VALUES (
             $1::bigint, $2, $3, NOW() + INTERVAL '10 minutes'
           )
           ON CONFLICT (code_hash) DO NOTHING
           RETURNING expires_at`,
          [canonical, provider, linkCodeHash(code)]
        );
        if (!inserted.rowCount) continue;
        await client.query('COMMIT');
        return {
          alreadyLinked: false,
          code,
          expiresAt: inserted.rows[0].expires_at,
          sourceProvider: provider,
          validForSeconds: Math.floor(LINK_CODE_TTL_MS / 1000)
        };
      } catch (error) {
        throw error;
      }
    }
    throw new Error('Не удалось создать уникальный код привязки.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function mergeUsers(db, firstUserId, secondUserId) {
  const firstId = String(await canonicalUserId(db, firstUserId));
  const secondId = String(await canonicalUserId(db, secondUserId));
  if (firstId === secondId) {
    return { canonicalUserId: firstId, mergedUserId: null, duplicateBonusRemoved: 0 };
  }

  const ordered = [firstId, secondId].sort((a, b) => Number(a) - Number(b));
  await db.query(
    'SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
    [ordered]
  );

  const usersResult = await db.query(
    'SELECT * FROM users WHERE id = ANY($1::bigint[])',
    [[firstId, secondId]]
  );
  const first = usersResult.rows.find((row) => String(row.id) === firstId);
  const second = usersResult.rows.find((row) => String(row.id) === secondId);
  if (!first || !second) throw Object.assign(new Error('Один из профилей не найден.'), { statusCode: 404 });

  const activityResult = await db.query(
    `SELECT client_id,
            COUNT(*) FILTER (
              WHERE status = 'completed' AND mode IN ('accrue','redeem','shop','beer_gift')
            )::int AS real_operations,
            COALESCE(SUM(cash_paid_cents) FILTER (
              WHERE status = 'completed' AND mode IN ('accrue','redeem')
            ), 0)::bigint AS real_spend
     FROM transactions
     WHERE client_id = ANY($1::bigint[])
     GROUP BY client_id`,
    [[firstId, secondId]]
  );
  const activity = new Map(activityResult.rows.map((row) => [String(row.client_id), row]));
  const { canonical: source, archived: target } = chooseCanonicalUser(first, second, activity);
  const sourceId = String(source.id);
  const targetId = String(target.id);

  const identitiesResult = await db.query(
    `SELECT user_id, provider, provider_user_id
     FROM user_identities
     WHERE user_id = ANY($1::bigint[])
     ORDER BY user_id, provider`,
    [[sourceId, targetId]]
  );
  const sourceProviders = new Set(
    identitiesResult.rows
      .filter((row) => String(row.user_id) === sourceId)
      .map((row) => row.provider)
  );
  const targetProviders = new Set(
    identitiesResult.rows
      .filter((row) => String(row.user_id) === targetId)
      .map((row) => row.provider)
  );
  const overlap = [...sourceProviders].filter((provider) => targetProviders.has(provider));
  if (overlap.length) {
    throw Object.assign(
      new Error(`Нельзя объединить два разных аккаунта одной платформы: ${overlap.join(', ')}.`),
      { statusCode: 409 }
    );
  }

  if (target.qr_token || target.qr_short_code) {
    await db.query(
      `INSERT INTO qr_aliases (
         qr_token, qr_short_code, user_id, source_user_id
       ) VALUES ($1, $2, $3::bigint, $4::bigint)
       ON CONFLICT DO NOTHING`,
      [target.qr_token, target.qr_short_code, sourceId, targetId]
    );
    const aliasCheck = await db.query(
      `SELECT
         ($1::text IS NULL OR EXISTS(
           SELECT 1 FROM qr_aliases
           WHERE qr_token = $1 AND user_id = $3::bigint
         )) AS token_owned,
         ($2::text IS NULL OR EXISTS(
           SELECT 1 FROM qr_aliases
           WHERE qr_short_code = $2 AND user_id = $3::bigint
         )) AS short_owned`,
      [target.qr_token, target.qr_short_code, sourceId]
    );
    if (!aliasCheck.rows[0]?.token_owned || !aliasCheck.rows[0]?.short_owned) {
      throw new Error('Старый QR-код уже принадлежит другому профилю.');
    }
  }

  const walletResult = await db.query(
    'SELECT user_id, balance FROM wallets WHERE user_id = ANY($1::bigint[]) FOR UPDATE',
    [[sourceId, targetId]]
  );
  const sourceBalance = Number(
    walletResult.rows.find((row) => String(row.user_id) === sourceId)?.balance || 0
  );
  const targetBalance = Number(
    walletResult.rows.find((row) => String(row.user_id) === targetId)?.balance || 0
  );

  const duplicateRewards = await db.query(
    `SELECT s.code, LEAST(s.amount, t.amount)::bigint AS amount
     FROM reward_grants s
     JOIN reward_grants t ON t.code = s.code
     WHERE s.user_id = $1::bigint AND t.user_id = $2::bigint`,
    [sourceId, targetId]
  );
  const duplicateGrantBonus = duplicateRewards.rows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.amount || 0)),
    0
  );
  const duplicateRewardCodes = duplicateRewards.rows.map((row) => row.code);

  const ledgerResult = await db.query(
    `SELECT client_id,
            COALESCE(SUM(
              CASE WHEN status = 'completed'
                   THEN bonus_earned::bigint - bonus_spent::bigint
                   ELSE 0 END
            ), 0)::bigint AS ledger_balance
     FROM transactions
     WHERE client_id = ANY($1::bigint[])
     GROUP BY client_id`,
    [[sourceId, targetId]]
  );
  const ledgerByUser = new Map(
    ledgerResult.rows.map((row) => [String(row.client_id), Number(row.ledger_balance || 0)])
  );

  let cancelledDuplicateBonus = 0;
  if (duplicateRewardCodes.length) {
    const cancelledRewards = await db.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY reward_code
                  ORDER BY created_at, id
                ) AS reward_number
         FROM transactions
         WHERE client_id = ANY($1::bigint[])
           AND reward_code = ANY($2::text[])
           AND status = 'completed'
       )
       UPDATE transactions t
       SET status = 'cancelled',
           cancelled_at = NOW(),
           cancel_reason = 'Повторная автоматическая награда удалена при объединении аккаунтов'
       FROM ranked r
       WHERE t.id = r.id AND r.reward_number > 1
       RETURNING (t.bonus_earned::bigint - t.bonus_spent::bigint) AS removed_amount`,
      [[sourceId, targetId], duplicateRewardCodes]
    );
    cancelledDuplicateBonus = cancelledRewards.rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.removed_amount || 0)),
      0
    );
  }

  const confirmedDuplicateBonus = Math.max(duplicateGrantBonus, cancelledDuplicateBonus);
  const ledgerPlan = planMergedLedger({
    sourceWallet: sourceBalance,
    targetWallet: targetBalance,
    sourceLedger: ledgerByUser.get(sourceId) || 0,
    targetLedger: ledgerByUser.get(targetId) || 0,
    duplicateRewardAmount: confirmedDuplicateBonus
  });
  const {
    walletDifference,
    duplicateBonusRemoved,
    duplicateBonusUnrecovered,
    finalBalance
  } = ledgerPlan;
  const remainingDuplicateAdjustment = Math.max(
    0,
    duplicateBonusRemoved - cancelledDuplicateBonus
  );
  const cancelledBeyondRecoverableBalance = Math.max(
    0,
    cancelledDuplicateBonus - duplicateBonusRemoved
  );

  if (remainingDuplicateAdjustment) {
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status,
         bonus_spent, balance_after, reason, completed_at
       ) VALUES (
         $1, $2::bigint, 'adjustment', 'completed',
         $3::bigint, $4::bigint,
         'Удалена подтверждённая повторная автоматическая награда при объединении Telegram и VK',
         NOW()
       )`,
      [
        `merge:${sourceId}:${targetId}:duplicate-rewards`,
        sourceId,
        remainingDuplicateAdjustment,
        finalBalance
      ]
    );
  }
  if (cancelledBeyondRecoverableBalance) {
    await db.query(
      `INSERT INTO transactions (
         request_key, client_id, mode, status,
         bonus_earned, balance_after, reason, completed_at
       ) VALUES (
         $1, $2::bigint, 'adjustment', 'completed',
         $3::bigint, $4::bigint,
         'Сохранена уже использованная часть повторной награды при объединении аккаунтов',
         NOW()
       )`,
      [
        `merge:${sourceId}:${targetId}:spent-duplicate-preserved`,
        sourceId,
        cancelledBeyondRecoverableBalance,
        finalBalance
      ]
    );
  }

  const beerResult = await db.query(
    `SELECT user_id, paid_ml_total, gift_ml_balance
     FROM beer_loyalty
     WHERE user_id = ANY($1::bigint[])
     FOR UPDATE`,
    [[sourceId, targetId]]
  );
  const sourceBeer = beerResult.rows.find((row) => String(row.user_id) === sourceId) || {};
  const targetBeer = beerResult.rows.find((row) => String(row.user_id) === targetId) || {};
  const paidMlTotal = Number(sourceBeer.paid_ml_total || 0) + Number(targetBeer.paid_ml_total || 0);
  const giftMlBalance = Number(sourceBeer.gift_ml_balance || 0) + Number(targetBeer.gift_ml_balance || 0);

  const role = strongestRole(source.role, target.role);
  const profileFrame = profileFrameFromRow(source) !== 'none'
    ? profileFrameFromRow(source)
    : profileFrameFromRow(target);
  const telegramId = source.telegram_id || target.telegram_id || null;
  const sourceAvatarCustomized = String(source.avatar_source || 'preset_male') !== 'preset_male'
    || Boolean(source.avatar_key);
  const targetAvatarCustomized = String(target.avatar_source || 'preset_male') !== 'preset_male'
    || Boolean(target.avatar_key);
  const avatarOwner = sourceAvatarCustomized || !targetAvatarCustomized ? source : target;
  const mergedAvatarSource = avatarOwner.avatar_source || 'preset_male';
  const mergedAvatarKey = avatarOwner.avatar_key || null;

  await db.query(
    `UPDATE users
     SET telegram_id = NULL,
         qr_token = NULL,
         qr_short_code = NULL,
         updated_at = NOW()
     WHERE id = $1::bigint`,
    [targetId]
  );

  await db.query(
    `UPDATE users
     SET telegram_id = $2,
         role = $3,
         unlimited_bonus = $4,
         profile_frame = $5,
         staff_pin_hash = CASE
           WHEN role IN ('staff', 'admin')
             AND staff_pin_hash IS NOT NULL AND staff_pin_salt IS NOT NULL
           THEN staff_pin_hash ELSE $6
         END,
         staff_pin_salt = CASE
           WHEN role IN ('staff', 'admin')
             AND staff_pin_hash IS NOT NULL AND staff_pin_salt IS NOT NULL
           THEN staff_pin_salt ELSE $7
         END,
         staff_pin_updated_at = CASE
           WHEN role IN ('staff', 'admin')
             AND staff_pin_hash IS NOT NULL AND staff_pin_salt IS NOT NULL
           THEN staff_pin_updated_at ELSE $8
         END,
         terms_accepted_at = COALESCE(terms_accepted_at, $9),
         terms_version = CASE
           WHEN terms_version = $10::text OR $11::text = $10::text THEN $10::text
           ELSE COALESCE(terms_version, $11::text)
         END,
         onboarding_completed_at = COALESCE(onboarding_completed_at, $12),
         created_at = LEAST(created_at, $13),
         username = COALESCE(NULLIF(username, ''), $14::text),
         first_name = CASE
           WHEN first_name IN ('Пользователь', 'Гость') AND COALESCE($15::text, '') <> '' THEN $15::text
           ELSE first_name
         END,
         last_name = COALESCE(NULLIF(last_name, ''), $16::text),
         photo_url = COALESCE(photo_url, $17::text),
         language_code = COALESCE(language_code, $18::text),
         avatar_source = $19::text,
         avatar_key = $20::text,
         age_group = COALESCE(age_group, $21::text),
         profile_public = profile_public AND $22::boolean,
         show_name = show_name AND $23::boolean,
         show_avatar = show_avatar AND $24::boolean,
         show_leaderboard_amount = show_leaderboard_amount AND $25::boolean,
         show_stats = show_stats AND $26::boolean,
         session_version = session_version + 1,
         updated_at = NOW()
     WHERE id = $1::bigint`,
    [
      sourceId,
      telegramId,
      role,
      Boolean(source.unlimited_bonus || target.unlimited_bonus),
      profileFrame,
      target.staff_pin_hash,
      target.staff_pin_salt,
      target.staff_pin_updated_at,
      target.terms_accepted_at,
      TERMS_VERSION,
      target.terms_version,
      target.onboarding_completed_at,
      target.created_at,
      target.username,
      target.first_name,
      target.last_name,
      target.photo_url,
      target.language_code,
      mergedAvatarSource,
      mergedAvatarKey,
      target.age_group,
      target.profile_public !== false,
      target.show_name !== false,
      target.show_avatar !== false,
      target.show_leaderboard_amount !== false,
      target.show_stats !== false
    ]
  );

  await db.query(
    `UPDATE user_identities
     SET user_id = $1::bigint, updated_at = NOW()
     WHERE user_id = $2::bigint`,
    [sourceId, targetId]
  );

  await db.query(
    `INSERT INTO bar_customers (bar_id, user_id, status, joined_at, updated_at)
     SELECT bar_id, $1::bigint, status, joined_at, NOW()
     FROM bar_customers
     WHERE user_id = $2::bigint
     ON CONFLICT (bar_id, user_id) DO UPDATE
     SET status = CASE
       WHEN bar_customers.status = 'active' OR EXCLUDED.status = 'active' THEN 'active'
       WHEN bar_customers.status = 'blocked' OR EXCLUDED.status = 'blocked' THEN 'blocked'
       ELSE 'archived'
     END,
     joined_at = LEAST(bar_customers.joined_at, EXCLUDED.joined_at),
     updated_at = NOW()`,
    [sourceId, targetId]
  );
  await db.query('DELETE FROM bar_customers WHERE user_id = $1::bigint', [targetId]);

  await db.query(
    `INSERT INTO shift_members (shift_id, user_id, position)
     SELECT shift_id, $1::bigint, position
     FROM shift_members
     WHERE user_id = $2::bigint
     ON CONFLICT (shift_id, user_id) DO UPDATE
     SET position = LEAST(shift_members.position, EXCLUDED.position)`,
    [sourceId, targetId]
  );
  await db.query('DELETE FROM shift_members WHERE user_id = $1::bigint', [targetId]);

  await db.query(
    `INSERT INTO beta_grants (code, user_id, amount, created_at)
     SELECT code, $1::bigint, amount, created_at
     FROM beta_grants
     WHERE user_id = $2::bigint
     ON CONFLICT (code, user_id) DO NOTHING`,
    [sourceId, targetId]
  );
  await db.query('DELETE FROM beta_grants WHERE user_id = $1::bigint', [targetId]);

  await db.query(
    `INSERT INTO reward_grants (
       code, user_id, amount, source, achievement_code,
       achievement_period, reward_beer_ml, announced_at, created_at
     )
     SELECT code, $1::bigint, amount, source, achievement_code,
            achievement_period, reward_beer_ml, announced_at, created_at
     FROM reward_grants
     WHERE user_id = $2::bigint
     ON CONFLICT (code, user_id) DO NOTHING`,
    [sourceId, targetId]
  );
  await db.query('DELETE FROM reward_grants WHERE user_id = $1::bigint', [targetId]);

  await db.query(
    `INSERT INTO wallets (user_id, balance)
     VALUES ($1::bigint, $2::bigint)
     ON CONFLICT (user_id) DO UPDATE
     SET balance = EXCLUDED.balance, updated_at = NOW()`,
    [sourceId, finalBalance]
  );
  await db.query('DELETE FROM wallets WHERE user_id = $1::bigint', [targetId]);

  await db.query(
    `INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance)
     VALUES ($1::bigint, $2::bigint, $3::integer)
     ON CONFLICT (user_id) DO UPDATE
     SET paid_ml_total = EXCLUDED.paid_ml_total,
         gift_ml_balance = EXCLUDED.gift_ml_balance,
         updated_at = NOW()`,
    [sourceId, paidMlTotal, Math.min(2_147_483_647, giftMlBalance)]
  );
  await db.query('DELETE FROM beer_loyalty WHERE user_id = $1::bigint', [targetId]);

  await db.query('UPDATE transactions SET client_id = $1::bigint WHERE client_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE transactions SET staff_id = $1::bigint WHERE staff_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE transactions SET cancelled_by = $1::bigint WHERE cancelled_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE qr_sessions SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE shifts SET created_by = $1::bigint WHERE created_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE cancel_quota_resets SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE cancel_quota_resets SET reset_by = $1::bigint WHERE reset_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE app_settings SET updated_by = $1::bigint WHERE updated_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE promotions SET updated_by = $1::bigint WHERE updated_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE shop_items SET updated_by = $1::bigint WHERE updated_by = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE shop_inquiries SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE qr_aliases SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE account_link_codes SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE account_link_codes SET used_by_user_id = $1::bigint WHERE used_by_user_id = $2::bigint', [sourceId, targetId]);
  await db.query('UPDATE account_link_attempts SET user_id = $1::bigint WHERE user_id = $2::bigint', [sourceId, targetId]);

  const ledgerCheck = await db.query(
    `SELECT COALESCE(SUM(
       CASE WHEN status = 'completed'
            THEN bonus_earned::bigint - bonus_spent::bigint
            ELSE 0 END
     ), 0)::bigint AS balance
     FROM transactions
     WHERE client_id = $1::bigint`,
    [sourceId]
  );
  const verifiedLedgerBalance = Number(ledgerCheck.rows[0]?.balance || 0);
  if (verifiedLedgerBalance !== finalBalance) {
    throw new Error('Журнал операций не сошёлся с итоговым балансом при объединении.');
  }

  await db.query(
    `UPDATE users
     SET merged_into_user_id = $1::bigint,
         merged_at = NOW(),
         role = 'client',
         unlimited_bonus = FALSE,
         staff_pin_hash = NULL,
         staff_pin_salt = NULL,
         staff_pin_updated_at = NULL,
         session_version = session_version + 1,
         updated_at = NOW()
     WHERE id = $2::bigint`,
    [sourceId, targetId]
  );

  await db.query(
    `INSERT INTO account_merge_audit (
       canonical_user_id, merged_user_id,
       duplicate_bonus_removed, duplicate_bonus_unrecovered, details
     ) VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::jsonb)`,
    [
      sourceId,
      targetId,
      duplicateBonusRemoved,
      duplicateBonusUnrecovered,
      JSON.stringify({
        sourceBalance,
        targetBalance,
        finalBalance,
        ledgerBalanceBefore: ledgerPlan.ledgerTotal,
        walletDifference,
        cancelledDuplicateBonus,
        cancelledBeyondRecoverableBalance,
        duplicateRewardCodes: duplicateRewards.rows.map((row) => row.code),
        mergedAt: new Date().toISOString()
      })
    ]
  );

  return {
    canonicalUserId: sourceId,
    mergedUserId: targetId,
    duplicateBonusRemoved,
    duplicateBonusUnrecovered,
    finalBalance
  };
}

async function consumeAccountLinkCode(currentUserId, requestedProvider, rawCode) {
  const normalized = normalizeLinkCode(rawCode);
  const attemptUserId = await canonicalUserId(pool, currentUserId);
  if (!attemptUserId) {
    throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });
  }

  const attemptsResult = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM account_link_attempts
     WHERE user_id = $1::bigint
       AND success = FALSE
       AND attempted_at > NOW() - INTERVAL '15 minutes'`,
    [attemptUserId]
  );
  if (Number(attemptsResult.rows[0]?.count || 0) >= 10) {
    throw Object.assign(
      new Error('Слишком много попыток. Повторите через 15 минут.'),
      { statusCode: 429 }
    );
  }

  if (normalized.length !== 8) {
    await pool.query(
      'INSERT INTO account_link_attempts (user_id, success) VALUES ($1::bigint, FALSE)',
      [attemptUserId]
    );
    throw Object.assign(new Error('Введите полный код формата PIV-XXXX-XXXX.'), { statusCode: 400 });
  }

  const client = await pool.connect();
  let canonical;
  let mergeResult;
  try {
    await client.query('BEGIN');
    const currentCanonical = await canonicalUserId(client, attemptUserId);
    const currentProvider = await getCurrentProvider(client, currentCanonical, requestedProvider);

    const codeResult = await client.query(
      `SELECT *
       FROM account_link_codes
       WHERE code_hash = $1
       FOR UPDATE`,
      [linkCodeHash(rawCode)]
    );
    if (!codeResult.rowCount) {
      throw Object.assign(new Error('Код привязки не найден.'), { statusCode: 404 });
    }

    const link = validateLinkConsumption(codeResult.rows[0], currentProvider);

    const sourceCanonical = await canonicalUserId(client, link.user_id);
    mergeResult = await mergeUsers(client, sourceCanonical, currentCanonical);
    canonical = mergeResult.canonicalUserId;

    await client.query(
      `UPDATE account_link_codes
       SET used_at = NOW(), used_by_user_id = $1::bigint
       WHERE id = $2`,
      [canonical, link.id]
    );
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    await pool.query(
      'INSERT INTO account_link_attempts (user_id, success) VALUES ($1::bigint, FALSE)',
      [attemptUserId]
    ).catch((auditError) => console.warn('Link attempt audit failed:', auditError.message));
    throw error;
  } finally {
    client.release();
  }

  await pool.query(
    'INSERT INTO account_link_attempts (user_id, success) VALUES ($1::bigint, TRUE)',
    [canonical]
  ).catch((auditError) => console.warn('Link success audit failed:', auditError.message));

  const sessionResult = await pool.query(
    `SELECT u.session_version, ui.provider_user_id
     FROM users u
     JOIN user_identities ui ON ui.user_id = u.id AND ui.provider = $2
     WHERE u.id = $1::bigint AND u.merged_into_user_id IS NULL`,
    [canonical, requestedProvider]
  );
  if (!sessionResult.rowCount) {
    throw new Error('Привязанная платформа не найдена после объединения аккаунтов.');
  }
  const token = createSession(
    canonical,
    requestedProvider,
    Number(sessionResult.rows[0]?.session_version || 1),
    { pid: String(sessionResult.rows[0]?.provider_user_id || '') }
  );
  return {
    ok: true,
    token,
    merge: mergeResult,
    ...(await getAppPayload(canonical, requestedProvider))
  };
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Слишком большой запрос.'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Некорректный JSON.'), { statusCode: 400 });
  }
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function proxyRequest(req, res, bodyBuffer = null) {
  if (!childReady) {
    return sendJson(res, 503, { error: 'Приложение запускается. Повторите через несколько секунд.' });
  }
  if (
    bodyBuffer === null
    && !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())
  ) {
    bodyBuffer = await readRequestBody(req);
  }

  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
  const rawAuth = String(headers.authorization || '');
  if (rawAuth.startsWith('Bearer ')) {
    const normalized = await canonicalizeSessionToken(rawAuth.slice(7));
    if (normalized.payload) headers.authorization = `Bearer ${normalized.token}`;
  }

  const rawStaff = String(headers['x-staff-session'] || '');
  if (rawStaff) {
    const normalizedStaff = await canonicalizeSessionToken(rawStaff);
    if (!normalizedStaff.payload) {
      return sendJson(res, 401, { error: 'Сессия сотрудника истекла. Введите PIN снова.' });
    }
    headers['x-staff-session'] = normalizedStaff.token;
  }

  if (bodyBuffer !== null) headers['content-length'] = String(bodyBuffer.length);
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || 'https');

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: internalPort,
    method: req.method,
    path: req.url,
    headers
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });

  upstream.on('error', (error) => {
    console.error('Proxy error:', error.message);
    if (!res.headersSent) sendJson(res, 502, { error: 'Основной сервер временно недоступен.' });
    else res.end();
  });

  if (bodyBuffer !== null) upstream.end(bodyBuffer);
  else req.pipe(upstream);
}

export async function renderAppIndex(platform) {
  const source = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const withLoader = source.replace(
    /<link rel="stylesheet" href="styles\.css([^"]*)"\s*\/>/i,
    '<link rel="stylesheet" href="styles.css$1" />\n  <link rel="stylesheet" href="/loader-fix.css?v=2.1.0" />'
  );
  const withLinking = withLoader.replace(
    /<script defer src="app\.js([^"]*)"><\/script>/i,
    '<script defer src="/account-link.js?v=2.1.0"></script>\n  <script defer src="app.js$1"></script>'
  );

  if (platform !== 'vk') return withLinking;
  return withLinking
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(
      /<script defer src="\/account-link\.js([^"]*)"><\/script>/i,
      '<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\n  <script defer src="/vk-platform.js?v=2.2.0"></script>\n  <script defer src="/account-link.js$1"></script>'
    );
}

export function documentSecurityHeaders(platform) {
  const telegramScript = platform === 'telegram' ? ' https://telegram.org' : '';
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': [
      "default-src 'self'",
      `script-src 'self'${telegramScript}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'frame-ancestors https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru https://web.telegram.org https://*.telegram.org'
    ].join('; ')
  };
}

export function platformForDocumentRequest(url) {
  if (url.pathname === '/vk' || url.pathname === '/vk/') return 'vk';
  if (url.pathname !== '/' && url.pathname !== '/index.html') return null;

  const hasVkLaunchParams = url.searchParams.get('vk_app_id') === EXPECTED_VK_APP_ID
    || (
      url.searchParams.has('sign')
      && Array.from(url.searchParams.keys()).some((key) => key.startsWith('vk_'))
    );

  return hasVkLaunchParams ? 'vk' : 'telegram';
}

async function serveFile(res, filePath, contentType, cacheControl = 'no-store') {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Файл не найден.' });
  }
}

function platformFromRequest(req, fallback = 'unknown') {
  const signedPlatform = fallback === 'vk' ? 'vk' : 'telegram';
  const claimed = String(req.headers['x-pivnik-platform'] || '').toLowerCase();
  if (claimed && claimed !== signedPlatform) {
    throw Object.assign(new Error('Платформа запроса не совпадает с текущей сессией.'), {
      statusCode: 403
    });
  }
  return signedPlatform;
}

function isConsentExempt(pathname) {
  return pathname === '/api/health'
    || pathname === '/api/platform-health'
    || pathname === '/api/auth'
    || pathname === '/api/me'
    || pathname === '/api/me/consent'
    || pathname.startsWith('/api/account-link/');
}

const child = isTestImport ? null : spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, PORT: String(internalPort), PIVNIK_CHILD_SERVER: '1' },
  stdio: ['ignore', 'inherit', 'inherit']
});

child?.on('exit', (code, signal) => {
  childReady = false;
  if (!shuttingDown) {
    console.error(`Main server exited: code=${code}, signal=${signal}`);
    process.exitCode = 1;
    server?.close(() => process.exit(1));
  }
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) enforceMutationOrigin(req);

    const documentPlatform = platformForDocumentRequest(url);
    if (req.method === 'GET' && documentPlatform) {
      const html = Buffer.from(await renderAppIndex(documentPlatform));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': html.length,
        'cache-control': 'no-store',
        ...documentSecurityHeaders(documentPlatform)
      });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/vk-platform.js') {
      return serveFile(res, path.join(__dirname, 'vk-platform.js'), 'text/javascript; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/loader-fix.css') {
      return serveFile(res, path.join(__dirname, 'loader-fix.css'), 'text/css; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/vendor/vk-bridge.js') {
      return serveFile(
        res,
        path.join(__dirname, 'node_modules', '@vkontakte', 'vk-bridge', 'dist', 'browser.min.js'),
        'text/javascript; charset=utf-8',
        'public, max-age=31536000, immutable'
      );
    }

    if (req.method === 'GET' && url.pathname === '/account-link.js') {
      return serveFile(res, path.join(__dirname, 'account-link.js'), 'text/javascript; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/legal/privacy') {
      return serveFile(res, path.join(__dirname, 'legal', 'privacy.html'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/legal/terms') {
      return serveFile(res, path.join(__dirname, 'legal', 'terms.html'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!childReady || !platformReady) {
        return sendJson(res, 503, {
          ok: false,
          database: childReady ? 'initializing' : 'unavailable',
          unifiedAccounts: platformReady
        });
      }
      const upstreamHealth = await fetch(`http://127.0.0.1:${internalPort}/api/health`, {
        signal: AbortSignal.timeout(3000)
      });
      const health = await upstreamHealth.json().catch(() => ({}));
      if (!upstreamHealth.ok) {
        return sendJson(res, 503, {
          ok: false,
          database: 'error',
          unifiedAccounts: true
        });
      }
      return sendJson(res, 200, { ...health, ok: true, unifiedAccounts: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/platform-health') {
      return sendJson(res, platformReady ? 200 : 503, {
        ok: platformReady,
        telegram: Boolean(telegramBotToken),
        vk: Boolean(vkAppId && vkAppSecret),
        unifiedAccounts: true,
        linkCodes: true,
        bar: BAR_CODE,
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth') {
      if (!platformReady) {
        return sendJson(res, 503, { error: 'Система аккаунтов ещё запускается.' });
      }
      const body = parseJsonBody(await readRequestBody(req));
      const platform = body.platform === 'vk' ? 'vk' : 'telegram';
      enforceRateLimit(
        `auth:${requestAddress(req)}:${platform}`,
        30,
        10 * 60 * 1000
      );
      try {
        const data = platform === 'vk'
          ? await authenticateVk(body)
          : await authenticateTelegram(body);
        return sendJson(res, 200, data);
      } catch (error) {
        console.error(`${platform} auth failed:`, error.message);
        return sendJson(res, Number(error.statusCode || 500), {
          error: error.statusCode ? error.message : `Не удалось войти через ${platform === 'vk' ? 'VK' : 'Telegram'}.`
        });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = await requireGatewayUser(req);
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await getAppPayload(user.id, platform));
    }


    if (req.method === 'PUT' && url.pathname === '/api/me/profile') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      const body = parseJsonBody(await readRequestBody(req));
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await updateUnifiedProfile(user.id, platform, body));
    }

    if (req.method === 'GET' && url.pathname === '/api/leaderboard/monthly') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      return sendJson(res, 200, await getUnifiedMonthlyLeaderboard(user.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/users') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      const profile = await getProfile(user.id);
      if (!profile || !['viewer', 'admin'].includes(profile.role)) {
        return sendJson(res, 403, { error: 'Недостаточно прав.' });
      }
      return sendJson(res, 200, await getUnifiedAdminUsers());
    }

    if (req.method === 'POST' && url.pathname === '/api/me/consent') {
      const user = await requireGatewayUser(req);
      if (String(req.headers['x-pivnik-explicit-consent'] || '') !== '1') {
        return sendJson(res, 409, { error: 'Согласие можно подтвердить только кнопкой пользователя.' });
      }
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await acceptConsent(user.id, platform));
    }

    if (req.method === 'POST' && url.pathname === '/api/me/beta-tester/claim') {
      const user = await requireGatewayUser(req);
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await claimBetaTester(user.id, platform));
    }

    if (req.method === 'GET' && url.pathname === '/api/account-link/status') {
      const user = await requireGatewayUser(req);
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, {
        ...(await getIdentitySummary(pool, user.id)),
        profile: await getProfile(user.id, platform)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/account-link/code') {
      const user = await requireGatewayUser(req);
      enforceRateLimit(
        `link-code:${user.id}:${requestAddress(req)}`,
        5,
        15 * 60 * 1000
      );
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await createAccountLinkCode(user.id, platform));
    }

    if (req.method === 'POST' && url.pathname === '/api/account-link/consume') {
      const user = await requireGatewayUser(req);
      enforceRateLimit(
        `link-consume:${user.id}:${requestAddress(req)}`,
        10,
        15 * 60 * 1000
      );
      const body = parseJsonBody(await readRequestBody(req));
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await consumeAccountLinkCode(user.id, platform, body.code));
    }

    if (req.method === 'POST' && url.pathname === '/api/staff/qr/resolve') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      if (!['staff', 'admin'].includes((await getProfile(user.id)).role)) {
        return sendJson(res, 403, { error: 'Недостаточно прав.' });
      }
      enforceRateLimit(`qr:${user.id}:${requestAddress(req)}`, 60, 60 * 1000);
      const body = parseJsonBody(await readRequestBody(req));
      const resolved = await resolvePersonalQrRecord(pool, body.payload);
      if (!resolved) return sendJson(res, 404, { error: 'Персональный код не найден.' });
      return sendJson(res, 200, {
        qrToken: resolved.qr_token,
        shortCode: resolved.qr_short_code,
        client: await getProfile(resolved.id)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/staff/activate') {
      const user = await requireGatewayUser(req);
      if (!user.termsAccepted) {
        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
      }
      enforceRateLimit(`pin:${user.id}:${requestAddress(req)}`, 8, 15 * 60 * 1000);
      const bodyBuffer = await readRequestBody(req);
      return await proxyRequest(req, res, bodyBuffer);
    }

    if (url.pathname.startsWith('/api/') && !isConsentExempt(url.pathname)) {
      const rawAuth = String(req.headers.authorization || '');
      if (rawAuth.startsWith('Bearer ')) {
        const user = await requireGatewayUser(req);
        if (!user.termsAccepted) {
          return sendJson(res, 428, { error: 'Сначала примите правила программы.' });
        }
      }
    }

    return await proxyRequest(req, res);
  } catch (error) {
    console.error('Universal server error:', error?.code || error?.message || 'unknown');
    return sendJson(res, Number(error.statusCode || 500), {
      error: error.statusCode ? error.message : 'Внутренняя ошибка сервера.'
    });
  }
});

if (!isTestImport) {
  server.listen(publicPort, '0.0.0.0', async () => {
    console.log(`Pivnik universal gateway is running on port ${publicPort}`);
    try {
      await waitForChild();
      await initPlatformDatabase();
    } catch (error) {
      console.error(
        'Platform initialization failed:',
        error?.code || error?.message || 'unknown'
      );
      process.exitCode = 1;
      child?.kill('SIGTERM');
      server.close(() => process.exit(1));
    }
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: shutting down universal gateway`);
  child?.kill('SIGTERM');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
