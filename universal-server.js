import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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

const TERMS_VERSION = 'beta-0.4';
const WELCOME_BONUS = 100;
const BETA_TESTER_BONUS = 150;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const VK_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PERSONAL_QR_PREFIX = 'PIVNIK:';
const BAR_CODE = 'pivnik';
const BAR_NAME = 'ПИВНИК';
const BAR_ADDRESS = 'Санкт-Петербург, пр. Энгельса, 55';
const BEER_PAID_TARGET_ML = 14_000;
const UNLIMITED_BONUS_BALANCE = 9_999_999_999_999;

const STATUS_LEVELS = [
  { minCents: 0, name: 'Путник', bonusPercent: 5, discountPercent: 0, nextCents: 1_000_000 },
  { minCents: 1_000_000, name: 'Странник', bonusPercent: 6, discountPercent: 0, nextCents: 3_000_000 },
  { minCents: 3_000_000, name: 'Гость таверны', bonusPercent: 7, discountPercent: 0, nextCents: 7_000_000 },
  { minCents: 7_000_000, name: 'Завсегдатай', bonusPercent: 8, discountPercent: 0, nextCents: 10_000_000 },
  { minCents: 10_000_000, name: 'Местный пьяница', bonusPercent: 9, discountPercent: 0, nextCents: 15_000_000 },
  { minCents: 15_000_000, name: 'Легендарный пьяница', bonusPercent: 10, discountPercent: 0, nextCents: 50_000_000 },
  { minCents: 50_000_000, name: 'Король Пивника', bonusPercent: 20, discountPercent: 10, nextCents: null }
];

const ROLE_RANK = { client: 0, viewer: 1, staff: 2, admin: 3 };

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
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
  .update(process.env.SESSION_SECRET || `pivnik:${telegramBotToken || 'local-development'}`)
  .digest();

let platformReady = false;
let childReady = false;
let shuttingDown = false;

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

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^PIV/, '')
    .slice(0, 8);
}

function linkCodeHash(value) {
  return crypto.createHmac('sha256', sessionSecret).update(`account-link:${normalizeLinkCode(value)}`).digest('hex');
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = String(token).split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  if (!timingSafeTextEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSession(userId, platform = 'unknown', extra = {}) {
  return signSession({
    uid: String(userId),
    platform,
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

function strongestRole(a, b) {
  return (ROLE_RANK[b] || 0) > (ROLE_RANK[a] || 0) ? b : a;
}

function isOwnerRow(row) {
  return Boolean(ownerTelegramId && String(row?.telegram_id || '') === ownerTelegramId)
    || Boolean(row?.role === 'admin' && row?.unlimited_bonus);
}

function isAnnaRow(row) {
  const telegramId = String(row?.telegram_id || '');
  if (annaTelegramId && telegramId === annaTelegramId) return true;
  const fullName = `${String(row?.first_name || '').trim()} ${String(row?.last_name || '').trim()}`
    .trim()
    .toLocaleLowerCase('ru-RU');
  return ['анна берман', 'аня берман', 'берман анна', 'берман аня'].includes(fullName);
}

function hasUnlimitedBonus(row) {
  return Boolean(row?.unlimited_bonus) || isOwnerRow(row) || row?.role === 'viewer';
}

function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  return ['money', 'fire', 'diamond', 'anna'].includes(String(row?.profile_frame || ''))
    ? String(row.profile_frame)
    : 'none';
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
  if (!vkAppId || !vkAppSecret) {
    throw Object.assign(new Error('VK_APP_ID или VK_APP_SECRET не настроены.'), { statusCode: 503 });
  }

  const raw = String(rawLaunchParams || '').replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  const receivedSign = params.get('sign') || '';
  if (!receivedSign) throw Object.assign(new Error('VK не передал подпись запуска.'), { statusCode: 401 });

  const signedPairs = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([a], [b]) => a.localeCompare(b));
  const signedQuery = new URLSearchParams(signedPairs).toString();
  const calculatedSign = crypto.createHmac('sha256', vkAppSecret).update(signedQuery).digest('base64url');
  if (!timingSafeTextEqual(receivedSign, calculatedSign)) {
    throw Object.assign(new Error('Подпись запуска VK недействительна.'), { statusCode: 401 });
  }

  const receivedAppId = params.get('vk_app_id') || '';
  if (receivedAppId !== vkAppId) {
    throw Object.assign(new Error('Приложение VK не совпадает с настройками сервера.'), { statusCode: 401 });
  }

  const timestamp = Number(params.get('vk_ts') || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!timestamp || Math.abs(nowSeconds - timestamp) > VK_AUTH_MAX_AGE_SECONDS) {
    throw Object.assign(new Error('Ссылка запуска VK устарела. Откройте приложение повторно.'), { statusCode: 401 });
  }

  const userId = String(params.get('vk_user_id') || '').trim();
  if (!/^\d+$/.test(userId)) {
    throw Object.assign(new Error('VK не передал идентификатор пользователя.'), { statusCode: 401 });
  }

  return {
    userId,
    languageCode: safeText(params.get('vk_language'), 12, 'ru'),
    platform: safeText(params.get('vk_platform'), 40, 'vk')
  };
}

function validateTelegramInitData(initData) {
  if (!telegramBotToken) {
    throw Object.assign(new Error('TELEGRAM_BOT_TOKEN не настроен.'), { statusCode: 503 });
  }
  if (!initData) {
    throw Object.assign(new Error('Telegram не передал данные входа.'), { statusCode: 401 });
  }

  const params = new URLSearchParams(String(initData));
  const receivedHash = params.get('hash') || '';
  if (!receivedHash) throw Object.assign(new Error('Telegram не передал подпись.'), { statusCode: 401 });

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(telegramBotToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!timingSafeTextEqual(receivedHash, calculatedHash)) {
    throw Object.assign(new Error('Подпись Telegram недействительна.'), { statusCode: 401 });
  }

  const authDate = Number(params.get('auth_date') || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || Math.abs(nowSeconds - authDate) > 24 * 60 * 60) {
    throw Object.assign(new Error('Ссылка запуска Telegram устарела. Откройте приложение повторно.'), { statusCode: 401 });
  }

  const rawUser = params.get('user');
  if (!rawUser) throw Object.assign(new Error('Telegram не передал профиль.'), { statusCode: 401 });
  const user = JSON.parse(rawUser);
  const id = String(user.id || '').trim();
  if (!/^\d+$/.test(id)) throw Object.assign(new Error('Некорректный Telegram ID.'), { statusCode: 401 });

  return {
    id,
    username: safeText(user.username, 100, ''),
    firstName: safeText(user.first_name, 80, 'Гость'),
    lastName: safeText(user.last_name, 80, ''),
    photoUrl: safeHttpsUrl(user.photo_url),
    languageCode: safeText(user.language_code, 12, 'ru')
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

async function initPlatformDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_into_user_id BIGINT REFERENCES users(id)');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_merged_into ON users(merged_into_user_id)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS bars (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        address TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_identities (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('telegram','vk')),
        provider_user_id TEXT NOT NULL,
        provider_username TEXT,
        profile_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_user_id),
        UNIQUE(user_id, provider)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bar_customers (
        bar_id BIGINT NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','archived')),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (bar_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reward_grants (
        code TEXT NOT NULL,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount BIGINT NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (code, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS platform_migrations (
        code TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_link_codes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_provider TEXT NOT NULL CHECK (source_provider IN ('telegram','vk')),
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        used_by_user_id BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_account_link_codes_user ON account_link_codes(user_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_account_link_codes_expiry ON account_link_codes(expires_at)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_link_attempts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        success BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_account_link_attempts_user ON account_link_attempts(user_id, attempted_at DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_aliases (
        id BIGSERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE,
        qr_short_code TEXT UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_user_id BIGINT REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (qr_token IS NOT NULL OR qr_short_code IS NOT NULL)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_merge_audit (
        id BIGSERIAL PRIMARY KEY,
        canonical_user_id BIGINT NOT NULL REFERENCES users(id),
        merged_user_id BIGINT NOT NULL REFERENCES users(id),
        duplicate_bonus_removed BIGINT NOT NULL DEFAULT 0,
        duplicate_bonus_unrecovered BIGINT NOT NULL DEFAULT 0,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `INSERT INTO bars (code, name, address)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name, address = EXCLUDED.address, updated_at = NOW()`,
      [BAR_CODE, BAR_NAME, BAR_ADDRESS]
    );

    await client.query(`
      INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url)
      SELECT id, 'telegram', telegram_id::text, username, photo_url
      FROM users
      WHERE telegram_id IS NOT NULL AND merged_into_user_id IS NULL
      ON CONFLICT (provider, provider_user_id) DO UPDATE
      SET provider_username = EXCLUDED.provider_username,
          profile_url = EXCLUDED.profile_url,
          updated_at = NOW()
    `);

    await client.query(`
      INSERT INTO reward_grants (code, user_id, amount, source, created_at)
      SELECT 'welcome-100', t.client_id, MAX(t.bonus_earned)::bigint, 'legacy-transaction', MIN(t.created_at)
      FROM transactions t
      JOIN users u ON u.id = t.client_id
      WHERE t.mode = 'welcome' AND t.status = 'completed' AND u.merged_into_user_id IS NULL
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

    const explicitConsentMigration = await client.query(`
      INSERT INTO platform_migrations (code)
      VALUES ('force-explicit-consent-beta-0.4-v1')
      ON CONFLICT (code) DO NOTHING
      RETURNING code
    `);
    if (explicitConsentMigration.rowCount) {
      await client.query(`
        UPDATE users
        SET terms_accepted_at = NULL,
            terms_version = NULL,
            updated_at = NOW()
        WHERE merged_into_user_id IS NULL
      `);
    }

    await client.query(`
      INSERT INTO bar_customers (bar_id, user_id)
      SELECT b.id, u.id
      FROM bars b CROSS JOIN users u
      WHERE b.code = $1 AND u.merged_into_user_id IS NULL
      ON CONFLICT (bar_id, user_id) DO NOTHING
    `, [BAR_CODE]);

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
    await client.query('ROLLBACK');
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

  const mapped = { ...payload };
  let changed = false;
  for (const field of ['uid', 'terminalUid', 'staffUid']) {
    if (!mapped[field]) continue;
    const canonical = await canonicalUserId(pool, mapped[field]);
    if (canonical && String(canonical) !== String(mapped[field])) {
      mapped[field] = String(canonical);
      changed = true;
    }
  }
  return {
    token: changed ? signSession(mapped) : rawToken,
    payload: mapped,
    userId: mapped.uid ? String(mapped.uid) : null
  };
}

async function requireGatewayUser(req) {
  const raw = String(req.headers.authorization || '');
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const normalized = await canonicalizeSessionToken(token);
  if (!normalized.payload || !normalized.userId) {
    throw Object.assign(new Error('Требуется вход в приложение.'), { statusCode: 401 });
  }
  const result = await pool.query(
    `SELECT id, terms_accepted_at, terms_version
     FROM users
     WHERE id = $1::bigint AND merged_into_user_id IS NULL`,
    [normalized.userId]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 401 });
  }
  return {
    id: String(result.rows[0].id),
    token: normalized.token,
    payload: normalized.payload,
    termsAccepted: Boolean(
      result.rows[0].terms_accepted_at
      && result.rows[0].terms_version === TERMS_VERSION
    )
  };
}

async function ensurePersonalQr(db, userId) {
  const current = await db.query(
    'SELECT qr_token, qr_short_code FROM users WHERE id = $1::bigint',
    [userId]
  );
  if (current.rowCount && current.rows[0].qr_token && current.rows[0].qr_short_code) {
    return current.rows[0];
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await db.query(
        `UPDATE users
         SET qr_token = $1, qr_short_code = $2, updated_at = NOW()
         WHERE id = $3::bigint
         RETURNING qr_token, qr_short_code`,
        [crypto.randomBytes(24).toString('base64url'), makeShortCode(), userId]
      );
      if (!result.rowCount) throw new Error('Пользователь для QR-кода не найден.');
      return result.rows[0];
    } catch (error) {
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
  const spend12mCents = await getRollingSpend(db, canonical);
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
    achievements: achievementsFromRow(row),
    unannouncedAchievements: [],
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

async function getAppPayload(userId, platform = 'unknown') {
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

  const token = createSession(userId, provider);
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
       client_id, mode, status, bonus_earned, balance_after, reason, completed_at
     ) VALUES (
       $1::bigint, $2, 'completed', $3::integer, $4::bigint, $5, NOW()
     )`,
    [userId, mode, amount, balanceAfter, reason]
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
    const summary = await getIdentitySummary(client, canonical);
    if (summary.accountLinked) {
      await client.query('COMMIT');
      return {
        alreadyLinked: true,
        ...summary,
        profile: await getProfile(canonical, provider)
      };
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
           RETURNING expires_at`,
          [canonical, provider, linkCodeHash(code)]
        );
        await client.query('COMMIT');
        return {
          alreadyLinked: false,
          code,
          expiresAt: inserted.rows[0].expires_at,
          sourceProvider: provider,
          validForSeconds: Math.floor(LINK_CODE_TTL_MS / 1000)
        };
      } catch (error) {
        if (error.code === '23505') continue;
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

async function mergeUsers(db, firstUserId, secondUserId) {
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
  const score = (row) => {
    const stats = activity.get(String(row.id)) || {};
    return {
      protectedAccount: Boolean(row.role === 'admin' || row.unlimited_bonus),
      realOperations: Number(stats.real_operations || 0),
      realSpend: Number(stats.real_spend || 0),
      createdAt: new Date(row.created_at).getTime(),
      id: Number(row.id)
    };
  };
  const firstScore = score(first);
  const secondScore = score(second);
  const firstWins = firstScore.protectedAccount !== secondScore.protectedAccount
    ? firstScore.protectedAccount
    : firstScore.realOperations !== secondScore.realOperations
      ? firstScore.realOperations > secondScore.realOperations
      : firstScore.realSpend !== secondScore.realSpend
        ? firstScore.realSpend > secondScore.realSpend
        : firstScore.createdAt !== secondScore.createdAt
          ? firstScore.createdAt < secondScore.createdAt
          : firstScore.id < secondScore.id;

  const source = firstWins ? first : second;
  const target = firstWins ? second : first;
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
    `SELECT t.code, t.amount
     FROM reward_grants s
     JOIN reward_grants t ON t.code = s.code
     WHERE s.user_id = $1::bigint AND t.user_id = $2::bigint`,
    [sourceId, targetId]
  );
  const duplicateBonus = duplicateRewards.rows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.amount || 0)),
    0
  );
  const combinedBalance = sourceBalance + targetBalance;
  const duplicateBonusRemoved = Math.min(combinedBalance, duplicateBonus);
  const duplicateBonusUnrecovered = Math.max(0, duplicateBonus - duplicateBonusRemoved);
  const finalBalance = Math.max(0, combinedBalance - duplicateBonusRemoved);

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
         staff_pin_hash = COALESCE(staff_pin_hash, $6),
         staff_pin_salt = COALESCE(staff_pin_salt, $7),
         staff_pin_updated_at = COALESCE(staff_pin_updated_at, $8),
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
    `INSERT INTO reward_grants (code, user_id, amount, source, created_at)
     SELECT code, $1::bigint, amount, source, created_at
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

  if (duplicateBonusRemoved > 0) {
    await db.query(
      `INSERT INTO transactions (
         client_id, mode, status, bonus_spent, balance_after, reason, completed_at
       ) VALUES (
         $1::bigint, 'adjustment', 'completed', $2::integer, $3::bigint,
         'Удалены повторные регистрационные награды при объединении Telegram и VK', NOW()
       )`,
      [sourceId, duplicateBonusRemoved, finalBalance]
    );
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

    const link = codeResult.rows[0];
    if (link.used_at) {
      throw Object.assign(new Error('Этот код уже использован.'), { statusCode: 409 });
    }
    if (new Date(link.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error('Срок действия кода истёк. Создайте новый.'), { statusCode: 410 });
    }
    if (link.source_provider === currentProvider) {
      throw Object.assign(
        new Error('Код нужно ввести на другой платформе: Telegram ↔ VK.'),
        { statusCode: 409 }
      );
    }

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

  const token = createSession(canonical, requestedProvider);
  return {
    ok: true,
    token,
    merge: mergeResult,
    ...(await getAppPayload(canonical, requestedProvider))
  };
}

async function resolvePersonalQr(payload) {
  const original = String(payload || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const upper = original.toUpperCase();
  const token = upper.startsWith(PERSONAL_QR_PREFIX)
    ? original.slice(PERSONAL_QR_PREFIX.length)
    : null;

  const direct = await pool.query(
    `SELECT id, qr_token, qr_short_code
     FROM users
     WHERE merged_into_user_id IS NULL
       AND ${token ? 'qr_token = $1' : 'UPPER(qr_short_code) = $1'}
     LIMIT 1`,
    [token || upper]
  );
  if (direct.rowCount) return direct.rows[0];

  const alias = await pool.query(
    `SELECT u.id, u.qr_token, u.qr_short_code
     FROM qr_aliases qa
     JOIN users u ON u.id = qa.user_id
     WHERE u.merged_into_user_id IS NULL
       AND ${token ? 'qa.qr_token = $1' : 'UPPER(qa.qr_short_code) = $1'}
     LIMIT 1`,
    [token || upper]
  );
  return alias.rows[0] || null;
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
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function proxyRequest(req, res, bodyBuffer = null) {
  if (!childReady) {
    return sendJson(res, 503, { error: 'Приложение запускается. Повторите через несколько секунд.' });
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
    if (normalizedStaff.payload) headers['x-staff-session'] = normalizedStaff.token;
  }

  if (bodyBuffer) headers['content-length'] = String(bodyBuffer.length);
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

  if (bodyBuffer) upstream.end(bodyBuffer);
  else req.pipe(upstream);
}

async function renderAppIndex(platform) {
  const source = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const withLoaderFix = source.replace(
    /<link rel="stylesheet" href="styles\.css([^"]*)" \/>/i,
    '<link rel="stylesheet" href="styles.css$1" />\n  <link rel="stylesheet" href="/loader-fix.css?v=1.0.0" />'
  );
  const withLinking = withLoaderFix.replace(
    /<script defer src="app\.js([^"]*)"><\/script>/i,
    '<script defer src="/account-link.js?v=2.0.0"></script>\n  <script defer src="app.js$1"></script>'
  );

  if (platform !== 'vk') return withLinking;
  return withLinking
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(
      /<script defer src="\/account-link\.js([^"]*)"><\/script>/i,
      '<script defer src="https://unpkg.com/@vkontakte/vk-bridge@2.15.11/dist/browser.min.js"></script>\n  <script defer src="/vk-platform.js?v=2.0.0"></script>\n  <script defer src="/account-link.js$1"></script>'
    );
}

async function serveFile(res, filePath, contentType, cacheControl = 'no-store') {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': cacheControl
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Файл не найден.' });
  }
}

function platformFromRequest(req, fallback = 'unknown') {
  const value = String(req.headers['x-pivnik-platform'] || fallback).toLowerCase();
  return value === 'vk' ? 'vk' : value === 'telegram' ? 'telegram' : fallback;
}

function isConsentExempt(pathname) {
  return pathname === '/api/health'
    || pathname === '/api/platform-health'
    || pathname === '/api/auth'
    || pathname === '/api/me'
    || pathname === '/api/me/consent'
    || pathname.startsWith('/api/account-link/');
}

const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, PORT: String(internalPort) },
  stdio: ['ignore', 'inherit', 'inherit']
});

child.on('exit', (code, signal) => {
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

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = Buffer.from(await renderAppIndex('telegram'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': html.length,
        'cache-control': 'no-store'
      });
      return res.end(html);
    }

    if (req.method === 'GET' && (url.pathname === '/vk' || url.pathname === '/vk/')) {
      const html = Buffer.from(await renderAppIndex('vk'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': html.length,
        'cache-control': 'no-store'
      });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/vk-platform.js') {
      return serveFile(res, path.join(__dirname, 'vk-platform.js'), 'text/javascript; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/account-link.js') {
      return serveFile(res, path.join(__dirname, 'account-link.js'), 'text/javascript; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/loader-fix.css') {
      return serveFile(res, path.join(__dirname, 'loader-fix.css'), 'text/css; charset=utf-8', 'no-cache');
    }

    if (req.method === 'GET' && url.pathname === '/legal/privacy') {
      return serveFile(res, path.join(__dirname, 'legal', 'privacy.html'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/legal/terms') {
      return serveFile(res, path.join(__dirname, 'legal', 'terms.html'), 'text/html; charset=utf-8');
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
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await createAccountLinkCode(user.id, platform));
    }

    if (req.method === 'POST' && url.pathname === '/api/account-link/consume') {
      const user = await requireGatewayUser(req);
      const body = parseJsonBody(await readRequestBody(req));
      const platform = platformFromRequest(req, user.payload.platform || 'unknown');
      return sendJson(res, 200, await consumeAccountLinkCode(user.id, platform, body.code));
    }

    if (req.method === 'POST' && url.pathname === '/api/staff/qr/resolve') {
      const user = await requireGatewayUser(req);
      if (!['staff', 'admin'].includes((await getProfile(user.id)).role)) {
        return sendJson(res, 403, { error: 'Недостаточно прав.' });
      }
      const body = parseJsonBody(await readRequestBody(req));
      const resolved = await resolvePersonalQr(body.payload);
      if (!resolved) return sendJson(res, 404, { error: 'Персональный код не найден.' });
      return sendJson(res, 200, {
        qrToken: resolved.qr_token,
        shortCode: resolved.qr_short_code,
        client: await getProfile(resolved.id)
      });
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
    console.error('Universal server error:', error);
    return sendJson(res, Number(error.statusCode || 500), {
      error: error.message || 'Внутренняя ошибка сервера.'
    });
  }
});

server.listen(publicPort, '0.0.0.0', async () => {
  console.log(`Pivnik universal gateway is running on port ${publicPort}`);
  try {
    await waitForChild();
    await initPlatformDatabase();
  } catch (error) {
    console.error('Platform initialization failed:', error);
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: shutting down universal gateway`);
  child.kill('SIGTERM');
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
