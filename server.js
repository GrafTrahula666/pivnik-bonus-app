import compression from 'compression';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import QRCode from 'qrcode';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number(process.env.PORT || 3000);
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const ownerTelegramId = String(process.env.OWNER_TELEGRAM_ID || '').trim();
const allowDemo = String(process.env.ALLOW_DEMO || '').toLowerCase() === 'true';
const sessionSecret = crypto
  .createHash('sha256')
  .update(process.env.SESSION_SECRET || `pivnik:${botToken || 'local-development'}`)
  .digest();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const useSsl = !String(process.env.DATABASE_URL).includes('railway.internal');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '1h' }));

const STATUS_LEVELS = [
  { minCents: 0, name: 'Путник', bonusPercent: 5, discountPercent: 0, nextCents: 1_000_000 },
  { minCents: 1_000_000, name: 'Странник', bonusPercent: 6, discountPercent: 1, nextCents: 3_000_000 },
  { minCents: 3_000_000, name: 'Гость таверны', bonusPercent: 7, discountPercent: 2, nextCents: 7_000_000 },
  { minCents: 7_000_000, name: 'Завсегдатай', bonusPercent: 8, discountPercent: 3, nextCents: 10_000_000 },
  { minCents: 10_000_000, name: 'Местный пьяница', bonusPercent: 9, discountPercent: 4, nextCents: 15_000_000 },
  { minCents: 15_000_000, name: 'Легендарный пьяница', bonusPercent: 10, discountPercent: 5, nextCents: 50_000_000 },
  { minCents: 50_000_000, name: 'Король Пивника', bonusPercent: 20, discountPercent: 10, nextCents: null }
];

const PERSONAL_QR_PREFIX = 'PIVNIK:';
const SUSPICIOUS_THRESHOLD_CENTS = 300_000;
const TERMS_VERSION = 'beta-0.4';
const BEER_PAID_TARGET_ML = 14_000;
const BEER_GIFT_ML = 1_000;
const MAX_BEER_ML_PER_TRANSACTION = 100_000;
const WELCOME_BONUS = 100;
const REFERRAL_REWARD = 200;
const STAFF_CANCEL_LIMIT = 3;
const MAX_CONTENT_IMAGE_BYTES = 3_200_000;
const AVATAR_SOURCES = new Set(['preset_male', 'preset_female', 'telegram', 'animal']);
const ANIMAL_AVATARS = new Set([
  '01-panda','02-cat','03-dog','04-fox','05-bear','06-rabbit','07-owl','08-raccoon','09-wolf','10-deer',
  '11-koala','12-tiger','13-red-panda','14-penguin','15-mouse','16-dragon','17-unicorn','18-griffin','19-fire-imp'
]);
const AGE_GROUPS = new Set(['18-24', '25-34', '35-44', '45-54', '55+']);
const DEFAULT_PROMOTIONS = [
  { code: 'welcome-100', title: '100 бонусов за первый вход', description: 'Начисляются автоматически при первой регистрации в приложении.', badge: '+100 Б', active: true, sortOrder: 10 },
  { code: 'beer-15', title: 'Каждый 15-й литр — подарок', description: 'Оплатите 14 литров разливного пива и получите 1 литр бесплатно.', badge: '14 → 1', active: true, sortOrder: 20 },
  { code: 'referral-beta', title: 'Пригласить друга', description: 'После бета-теста: 200 бонусов после первой покупки приглашённого. Без процентов и цепочек.', badge: 'После беты', active: false, sortOrder: 30 }
];
const DEFAULT_SHOP_ITEMS = [
  { code: 'craft-05', title: 'Крафт из витрины · 0,5 л', subtitle: 'Любая доступная позиция из отмеченной категории. Выдача только в баре, 18+.', bonusPrice: 600, active: true, sortOrder: 10 },
  { code: 'combo', title: 'Комбо Пивника', subtitle: 'Готовим состав и цену. Появится после бета-теста.', bonusPrice: 900, active: false, sortOrder: 20 }
];
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const DEFAULT_DESIGN = {
  version: 9,
  colors: {
    background: '#07090c',
    header: '#0b0e13',
    surface: '#10141a',
    card: '#131820',
    text: '#f4f6f8',
    muted: '#98a0ab',
    accent: '#f4f6f8',
    accentSoft: '#cfd5dc'
  },
  texts: {
    brand: 'Пивник',
    balanceLabel: 'Ваш баланс',
    byline: 'by Kirill Gamilton',
    qrButton: 'Показать QR'
  },
  sections: {
    promos: true,
    featured: true,
    leaderboard: true,
    team: true,
    byline: true
  },
  radius: 20,
  splash: {
    enabled: false,
    imageUrl: ''
  }
};

function makeShortCode() {
  const chars = Array.from({ length: 8 }, () => QR_ALPHABET[crypto.randomInt(0, QR_ALPHABET.length)]).join('');
  return `PVK-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function normalizeStaffPin(value) {
  const pin = String(value || '').trim();
  return /^\d{4,6}$/.test(pin) ? pin : '';
}

function normalizeAvatarSource(value) {
  const source = String(value || '').trim();
  return AVATAR_SOURCES.has(source) ? source : 'preset_male';
}

function normalizeAvatarKey(source, value) {
  if (source !== 'animal') return null;
  const key = String(value || '').trim();
  return ANIMAL_AVATARS.has(key) ? key : null;
}

function normalizeAgeGroup(value) {
  const age = String(value || '').trim();
  return AGE_GROUPS.has(age) ? age : null;
}

function profileAppearanceFromRow(row) {
  return {
    avatarSource: row.avatar_source || 'preset_male',
    avatarKey: row.avatar_key || null,
    photoUrl: row.photo_url || null,
    onboardingComplete: Boolean(row.onboarding_completed_at),
    ageGroup: row.age_group || null,
    privacy: {
      publicProfile: row.profile_public !== false,
      showName: row.show_name !== false,
      showAvatar: row.show_avatar !== false,
      showMonthlySpend: row.show_leaderboard_amount !== false,
      showStats: row.show_stats !== false
    }
  };
}


function normalizeContentImage(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (/^https:\/\/[^\s]+$/i.test(source)) {
    if (source.length > 2_000) throw Object.assign(new Error('Ссылка на изображение слишком длинная.'), { statusCode: 400 });
    return source;
  }
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(source)) {
    if (Buffer.byteLength(source, 'utf8') > MAX_CONTENT_IMAGE_BYTES) {
      throw Object.assign(new Error('Изображение слишком большое. После сжатия должно быть не больше 3 МБ.'), { statusCode: 400 });
    }
    return source;
  }
  throw Object.assign(new Error('Разрешены JPG, PNG, WEBP или HTTPS-ссылка.'), { statusCode: 400 });
}

function makeContentCode(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function promotionResponse(row) {
  return {
    id: String(row.id), code: row.code, title: row.title, description: row.description || '',
    badge: row.badge || '', imageSrc: row.image_src || '', active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0), updatedAt: row.updated_at
  };
}

function shopItemResponse(row) {
  return {
    id: String(row.id), code: row.code, title: row.title, subtitle: row.subtitle || '',
    bonusPrice: Number(row.bonus_price || 0), imageSrc: row.image_src || '',
    active: Boolean(row.active), sortOrder: Number(row.sort_order || 0), updatedAt: row.updated_at
  };
}

function contentText(value, maxLength, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function createStaffPinHash(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') };
}

function verifyStaffPin(pin, salt, expectedHash) {
  if (!pin || !salt || !expectedHash) return false;
  const actual = Buffer.from(crypto.scryptSync(pin, salt, 32).toString('hex'), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function ensurePersonalQr(db, userId, force = false) {
  if (!force) {
    const current = await db.query('SELECT qr_token, qr_short_code FROM users WHERE id = $1', [userId]);
    if (current.rowCount && current.rows[0].qr_token && current.rows[0].qr_short_code) {
      return current.rows[0];
    }
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const token = crypto.randomBytes(24).toString('base64url');
    const shortCode = makeShortCode();
    try {
      const result = await db.query(
        `UPDATE users
         SET qr_token = $1, qr_short_code = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING qr_token, qr_short_code`,
        [token, shortCode, userId]
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

function getStatus(spendCents) {
  return [...STATUS_LEVELS].reverse().find((item) => spendCents >= item.minCents) || STATUS_LEVELS[0];
}

function centsFromInput(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  const number = Number(normalized);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number * 100);
}

function rubles(cents) {
  return Number(cents || 0) / 100;
}

function mlFromLiters(value) {
  const normalized = String(value ?? '').replace(',', '.').trim();
  if (!normalized) return 0;
  const liters = Number(normalized);
  if (!Number.isFinite(liters) || liters < 0) return 0;
  return Math.min(MAX_BEER_ML_PER_TRANSACTION, Math.round(liters * 1000));
}

function litersFromMl(ml) {
  return Number(ml || 0) / 1000;
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function validateTelegramInitData(initData) {
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  if (!initData) throw new Error('Telegram initData is missing');

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram hash is missing');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(receivedHash, 'hex');
  const b = Buffer.from(calculatedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Telegram signature is invalid');
  }

  const authDate = Number(params.get('auth_date') || 0);
  const maxAgeSeconds = 24 * 60 * 60;
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > maxAgeSeconds) {
    throw new Error('Telegram authorization is outdated');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Telegram user is missing');
  const user = JSON.parse(rawUser);
  return {
    id: String(user.id),
    username: user.username || null,
    firstName: user.first_name || 'Гость',
    lastName: user.last_name || null,
    photoUrl: user.photo_url || null,
    languageCode: user.language_code || null
  };
}

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        telegram_id BIGINT NOT NULL UNIQUE,
        username TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT,
        photo_url TEXT,
        language_code TEXT,
        role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','staff','viewer','admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_token TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS qr_short_code TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_pin_hash TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_pin_salt TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_pin_updated_at TIMESTAMPTZ');
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_source TEXT NOT NULL DEFAULT 'preset_male'");
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS age_group TEXT');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_name BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_avatar BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_leaderboard_amount BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS show_stats BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qr_token_unique ON users(qr_token) WHERE qr_token IS NOT NULL');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_qr_short_unique ON users(qr_short_code) WHERE qr_short_code IS NOT NULL');

    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS beer_loyalty (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        paid_ml_total BIGINT NOT NULL DEFAULT 0 CHECK (paid_ml_total >= 0),
        gift_ml_balance INTEGER NOT NULL DEFAULT 0 CHECK (gift_ml_balance >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_sessions (
        token TEXT PRIMARY KEY,
        short_code TEXT NOT NULL UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        request_key TEXT UNIQUE,
        client_id BIGINT NOT NULL REFERENCES users(id),
        staff_id BIGINT REFERENCES users(id),
        mode TEXT NOT NULL CHECK (mode IN ('accrue','redeem','adjustment')),
        status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','declined','expired','cancelled')),
        check_amount_cents BIGINT NOT NULL DEFAULT 0,
        discount_cents BIGINT NOT NULL DEFAULT 0,
        bonus_spent INTEGER NOT NULL DEFAULT 0,
        bonus_earned INTEGER NOT NULL DEFAULT 0,
        cash_paid_cents BIGINT NOT NULL DEFAULT 0,
        balance_after INTEGER,
        reason TEXT,
        expires_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_suspicious BOOLEAN NOT NULL DEFAULT FALSE');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS beer_ml INTEGER NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS beer_gift_earned_ml INTEGER NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS beer_gift_spent_ml INTEGER NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cancelled_by BIGINT REFERENCES users(id)');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ');
    await client.query('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cancel_reason TEXT');
    await client.query('ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_mode_check');
    await client.query("ALTER TABLE transactions ADD CONSTRAINT transactions_mode_check CHECK (mode IN ('accrue','redeem','adjustment','beer_gift','welcome','shop'))");
    await client.query(`
      UPDATE transactions
      SET status = 'cancelled', completed_at = COALESCE(completed_at, NOW()),
          reason = COALESCE(reason, 'Отменено при переходе на мгновенное списание')
      WHERE status = 'pending'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id BIGSERIAL PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        note TEXT,
        created_by BIGINT REFERENCES users(id),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_members (
        shift_id BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position SMALLINT NOT NULL DEFAULT 0,
        PRIMARY KEY (shift_id, user_id)
      )
    `);
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_single_active ON shifts ((1)) WHERE ended_at IS NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_shift_members_user ON shift_members(user_id, shift_id)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS cancel_quota_resets (
        id BIGSERIAL PRIMARY KEY,
        shift_id BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reset_by BIGINT NOT NULL REFERENCES users(id),
        reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_cancel_quota_resets ON cancel_quota_resets(shift_id, user_id, reset_at DESC)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        draft JSONB NOT NULL,
        published JSONB NOT NULL,
        updated_by BIGINT REFERENCES users(id),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(
      `INSERT INTO app_settings (id, draft, published)
       VALUES (1, $1::jsonb, $1::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(DEFAULT_DESIGN)]
    );
    await client.query(
      `UPDATE app_settings
       SET draft = $1::jsonb, published = $1::jsonb, updated_at = NOW()
       WHERE COALESCE((published->>'version')::int, 0) < 9`,
      [JSON.stringify(DEFAULT_DESIGN)]
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS promotions (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        badge TEXT NOT NULL DEFAULT '',
        image_src TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT REFERENCES users(id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS shop_items (
        id BIGSERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        bonus_price INTEGER NOT NULL CHECK (bonus_price >= 0),
        image_src TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by BIGINT REFERENCES users(id)
      )
    `);
    for (const item of DEFAULT_PROMOTIONS) {
      await client.query(
        `INSERT INTO promotions (code, title, description, badge, active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
        [item.code, item.title, item.description, item.badge, item.active, item.sortOrder]
      );
    }
    for (const item of DEFAULT_SHOP_ITEMS) {
      await client.query(
        `INSERT INTO shop_items (code, title, subtitle, bonus_price, active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
        [item.code, item.title, item.subtitle, item.bonusPrice, item.active, item.sortOrder]
      );
    }
    await client.query('CREATE INDEX IF NOT EXISTS idx_promotions_sort ON promotions(sort_order, id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_shop_items_sort ON shop_items(sort_order, id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_client_date ON transactions(client_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_cancelled_by ON transactions(cancelled_by, cancelled_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qr_expiry ON qr_sessions(expires_at)');
    await client.query('INSERT INTO beer_loyalty (user_id) SELECT id FROM users ON CONFLICT (user_id) DO NOTHING');
    const usersWithoutQr = await client.query('SELECT id FROM users WHERE qr_token IS NULL OR qr_short_code IS NULL');
    for (const row of usersWithoutQr.rows) await ensurePersonalQr(client, row.id);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getCurrentShift(db = pool) {
  const shiftResult = await db.query(
    `SELECT id, started_at, ended_at, note, updated_at
     FROM shifts
     WHERE ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`
  );
  if (!shiftResult.rowCount) return null;
  const shift = shiftResult.rows[0];
  const membersResult = await db.query(
    `SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.photo_url, u.avatar_source, u.avatar_key, u.show_name, u.show_avatar, u.role, sm.position
     FROM shift_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.shift_id = $1
     ORDER BY sm.position, u.first_name, u.id`,
    [shift.id]
  );
  return {
    id: String(shift.id),
    startedAt: shift.started_at,
    updatedAt: shift.updated_at,
    note: shift.note || '',
    members: membersResult.rows.map((row) => ({
      id: String(row.id),
      telegramId: String(row.telegram_id),
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      photoUrl: row.photo_url,
      avatarSource: row.avatar_source || 'preset_male',
      avatarKey: row.avatar_key || null,
      showName: row.show_name !== false,
      showAvatar: row.show_avatar !== false,
      role: row.role
    }))
  };
}

async function getRollingSpend(client, userId) {
  const result = await client.query(
    `SELECT COALESCE(SUM(cash_paid_cents), 0)::bigint AS spend
     FROM transactions
     WHERE client_id = $1
       AND status = 'completed'
       AND mode IN ('accrue','redeem')
       AND created_at >= NOW() - INTERVAL '12 months'`,
    [userId]
  );
  return Number(result.rows[0].spend || 0);
}

async function getProfile(userId, db = pool) {
  const userResult = await db.query(
    `SELECT u.*, w.balance, bl.paid_ml_total, bl.gift_ml_balance
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!userResult.rowCount) return null;
  const row = userResult.rows[0];
  const spend12mCents = await getRollingSpend(db, userId);
  const status = getStatus(spend12mCents);
  return {
    id: String(row.id),
    telegramId: String(row.telegram_id),
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    avatarSource: row.avatar_source || 'preset_male',
    avatarKey: row.avatar_key || null,
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
    balance: Number(row.balance || 0),
    qrShortCode: row.qr_short_code,
    termsAccepted: Boolean(row.terms_accepted_at && row.terms_version === TERMS_VERSION),
    termsAcceptedAt: row.terms_accepted_at,
    termsVersion: row.terms_version,
    spend12m: rubles(spend12mCents),
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
    }
  };
}

async function authRequired(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  const payload = verifySession(token);
  if (!payload) return res.status(401).json({ error: 'Требуется вход через Telegram.' });
  try {
    const profile = await getProfile(payload.uid);
    if (!profile) return res.status(401).json({ error: 'Пользователь не найден.' });
    req.user = profile;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав.' });
    }
    next();
  };
}

async function resolveActingStaff(req) {
  const raw = String(req.headers['x-staff-session'] || '').trim();
  let profile = req.user;
  if (raw) {
    const payload = verifySession(raw);
    if (!payload || payload.kind !== 'staff' || String(payload.terminalUid) !== String(req.user.id)) return null;
    profile = await getProfile(payload.staffUid);
  }
  if (!profile || !['staff', 'admin'].includes(profile.role)) return null;
  const shift = await getCurrentShift();
  if (profile.role !== 'admin' && shift?.members?.length && !shift.members.some((member) => String(member.id) === String(profile.id))) return null;
  return profile;
}

async function sendTelegramMessage(telegramId, text) {
  if (!botToken || !telegramId) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramId, text })
    });
    if (!response.ok) {
      const body = await response.text();
      console.error('Telegram sendMessage failed:', body);
    }
  } catch (error) {
    console.error('Telegram sendMessage error:', error.message);
  }
}

function transactionResponse(row) {
  return {
    id: String(row.id),
    mode: row.mode,
    status: row.status,
    checkAmount: rubles(row.check_amount_cents),
    discount: rubles(row.discount_cents),
    bonusSpent: Number(row.bonus_spent || 0),
    bonusEarned: Number(row.bonus_earned || 0),
    cashPaid: rubles(row.cash_paid_cents),
    balanceAfter: row.balance_after === null ? null : Number(row.balance_after),
    reason: row.reason,
    expiresAt: row.expires_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    clientName: row.client_name,
    staffName: row.staff_name,
    isSuspicious: Boolean(row.is_suspicious),
    beerMl: Number(row.beer_ml || 0),
    beerLiters: litersFromMl(row.beer_ml),
    beerGiftEarnedMl: Number(row.beer_gift_earned_ml || 0),
    beerGiftEarnedLiters: litersFromMl(row.beer_gift_earned_ml),
    beerGiftSpentMl: Number(row.beer_gift_spent_ml || 0),
    beerGiftSpentLiters: litersFromMl(row.beer_gift_spent_ml),
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : null,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason
  };
}

function publicLeaderboardName(row) {
  const first = String(row.first_name || 'Гость').trim();
  const last = String(row.last_name || '').trim();
  return last ? `${first} ${last.slice(0, 1)}.` : first;
}

async function getCancellationQuota(staffId, db = pool) {
  const shift = await getCurrentShift(db);
  if (!shift || !shift.members.some((member) => String(member.id) === String(staffId))) {
    return { active: false, limit: STAFF_CANCEL_LIMIT, used: 0, remaining: 0, shiftId: null };
  }
  const resetResult = await db.query(
    'SELECT MAX(reset_at) AS reset_at FROM cancel_quota_resets WHERE shift_id = $1 AND user_id = $2',
    [shift.id, staffId]
  );
  const shiftStart = new Date(shift.startedAt);
  const resetAt = resetResult.rows[0]?.reset_at ? new Date(resetResult.rows[0].reset_at) : null;
  const countFrom = resetAt && resetAt > shiftStart ? resetAt : shiftStart;
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM transactions
     WHERE cancelled_by = $1 AND cancelled_at >= $2`,
    [staffId, countFrom]
  );
  const used = Number(countResult.rows[0]?.count || 0);
  return { active: true, limit: STAFF_CANCEL_LIMIT, used, remaining: Math.max(0, STAFF_CANCEL_LIMIT - used), shiftId: shift.id, countFrom };
}

async function cancelCompletedTransaction(db, transactionId, actorId, reason, options = {}) {
  const txResult = await db.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [transactionId]);
  if (!txResult.rowCount) throw Object.assign(new Error('Операция не найдена.'), { statusCode: 404 });
  const tx = txResult.rows[0];
  if (tx.status !== 'completed') throw Object.assign(new Error('Эта операция уже отменена или не завершена.'), { statusCode: 400 });
  if (!['accrue', 'redeem', 'beer_gift', 'shop'].includes(tx.mode)) {
    throw Object.assign(new Error('Эту операцию нельзя отменить таким способом.'), { statusCode: 400 });
  }
  if (options.staffId && String(tx.staff_id) !== String(options.staffId)) {
    throw Object.assign(new Error('Сотрудник может отменить только свою операцию.'), { statusCode: 403 });
  }
  if (options.notBefore && new Date(tx.created_at) < new Date(options.notBefore)) {
    throw Object.assign(new Error('Можно отменять только операции текущей смены.'), { statusCode: 403 });
  }

  const walletResult = await db.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [tx.client_id]);
  const beerResult = await db.query('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE', [tx.client_id]);
  if (!walletResult.rowCount || !beerResult.rowCount) throw new Error('Счёт клиента не найден.');

  const currentBalance = Number(walletResult.rows[0].balance || 0);
  const newBalance = currentBalance - Number(tx.bonus_earned || 0) + Number(tx.bonus_spent || 0);
  const currentPaidMl = Number(beerResult.rows[0].paid_ml_total || 0);
  const currentGiftMl = Number(beerResult.rows[0].gift_ml_balance || 0);
  const newPaidMl = currentPaidMl - Number(tx.beer_ml || 0);
  const newGiftMl = currentGiftMl - Number(tx.beer_gift_earned_ml || 0) + Number(tx.beer_gift_spent_ml || 0);
  if (newBalance < 0) throw Object.assign(new Error('Отмена невозможна: начисленные бонусы уже использованы.'), { statusCode: 409 });
  if (newPaidMl < 0 || newGiftMl < 0) throw Object.assign(new Error('Отмена невозможна: подарочный объём уже использован. Нужна ручная корректировка владельца.'), { statusCode: 409 });

  await db.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, tx.client_id]);
  await db.query(
    'UPDATE beer_loyalty SET paid_ml_total = $1, gift_ml_balance = $2, updated_at = NOW() WHERE user_id = $3',
    [newPaidMl, newGiftMl, tx.client_id]
  );
  const updated = await db.query(
    `UPDATE transactions
     SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW(), cancel_reason = $2
     WHERE id = $3
     RETURNING *`,
    [actorId, reason, transactionId]
  );
  return updated.rows[0];
}

app.get('/api/health', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM transactions) AS transactions
    `);
    res.json({ ok: true, database: 'ok', ...result.rows[0], timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'error', error: error.message });
  }
});

app.post('/api/auth', async (req, res, next) => {
  try {
    let telegramUser;
    const initData = String(req.body?.initData || '');
    if (initData) {
      telegramUser = validateTelegramInitData(initData);
    } else if (allowDemo) {
      telegramUser = {
        id: String(req.body?.demoTelegramId || ownerTelegramId || '999000111'),
        username: 'demo_owner',
        firstName: 'Кирилл',
        lastName: 'Гамильтон',
        photoUrl: null,
        languageCode: 'ru'
      };
    } else {
      return res.status(401).json({ error: 'Откройте приложение через Telegram.' });
    }

    const role = ownerTelegramId && telegramUser.id === ownerTelegramId ? 'admin' : 'client';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, language_code, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (telegram_id) DO NOTHING
         RETURNING id`,
        [telegramUser.id, telegramUser.username, telegramUser.firstName, telegramUser.lastName, telegramUser.photoUrl, telegramUser.languageCode, role]
      );
      const isNew = inserted.rowCount > 0;
      let userId;
      if (isNew) {
        userId = inserted.rows[0].id;
      } else {
        const updated = await client.query(
          `UPDATE users SET
             username = $2,
             first_name = $3,
             last_name = $4,
             photo_url = $5,
             language_code = $6,
             role = CASE WHEN $7 = 'admin' THEN 'admin' ELSE role END,
             updated_at = NOW()
           WHERE telegram_id = $1
           RETURNING id`,
          [telegramUser.id, telegramUser.username, telegramUser.firstName, telegramUser.lastName, telegramUser.photoUrl, telegramUser.languageCode, role]
        );
        userId = updated.rows[0].id;
      }
      await client.query(
        'INSERT INTO wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [userId, isNew ? WELCOME_BONUS : 0]
      );
      await client.query('INSERT INTO beer_loyalty (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
      if (isNew && WELCOME_BONUS > 0) {
        await client.query(
          `INSERT INTO transactions (client_id, mode, status, bonus_earned, balance_after, reason, completed_at)
           VALUES ($1, 'welcome', 'completed', $2, $2, 'Приветственный бонус за регистрацию', NOW())`,
          [userId, WELCOME_BONUS]
        );
      }
      await ensurePersonalQr(client, userId);
      await client.query('COMMIT');

      const profile = await getProfile(userId);
      const designResult = await pool.query('SELECT published FROM app_settings WHERE id = 1');
      const token = signSession({ uid: String(userId), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      res.json({ token, profile, statuses: STATUS_LEVELS.map((item) => ({ ...item, min: rubles(item.minCents), next: item.nextCents ? rubles(item.nextCents) : null })), design: designResult.rows[0].published });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', authRequired, async (req, res, next) => {
  try {
    const designResult = await pool.query('SELECT published FROM app_settings WHERE id = 1');
    res.json({ profile: req.user, statuses: STATUS_LEVELS.map((item) => ({ ...item, min: rubles(item.minCents), next: item.nextCents ? rubles(item.nextCents) : null })), design: designResult.rows[0].published });
  } catch (error) {
    next(error);
  }
});

app.post('/api/me/consent', authRequired, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE users SET terms_accepted_at = NOW(), terms_version = $1, updated_at = NOW() WHERE id = $2',
      [TERMS_VERSION, req.user.id]
    );
    res.json({ ok: true, profile: await getProfile(req.user.id) });
  } catch (error) {
    next(error);
  }
});


app.put('/api/me/profile', authRequired, async (req, res, next) => {
  try {
    const avatarSource = normalizeAvatarSource(req.body?.avatarSource);
    const avatarKey = normalizeAvatarKey(avatarSource, req.body?.avatarKey);
    if (avatarSource === 'animal' && !avatarKey) return res.status(400).json({ error: 'Выберите аватар из коллекции.' });
    if (avatarSource === 'telegram' && !req.user.photoUrl) return res.status(400).json({ error: 'В профиле Telegram нет доступной фотографии.' });
    const ageGroup = normalizeAgeGroup(req.body?.ageGroup);
    const privacy = req.body?.privacy && typeof req.body.privacy === 'object' ? req.body.privacy : {};
    await pool.query(
      `UPDATE users SET
         avatar_source = $1,
         avatar_key = $2,
         age_group = $3,
         profile_public = $4,
         show_name = $5,
         show_avatar = $6,
         show_leaderboard_amount = $7,
         show_stats = $8,
         onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()),
         updated_at = NOW()
       WHERE id = $9`,
      [
        avatarSource,
        avatarKey,
        ageGroup,
        privacy.publicProfile !== false,
        privacy.showName !== false,
        privacy.showAvatar !== false,
        privacy.showMonthlySpend !== false,
        privacy.showStats !== false,
        req.user.id
      ]
    );
    res.json({ ok: true, profile: await getProfile(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/me/qr', authRequired, async (req, res, next) => {
  try {
    const qr = await ensurePersonalQr(pool, req.user.id);
    const payload = `${PERSONAL_QR_PREFIX}${qr.qr_token}`;
    const image = await QRCode.toDataURL(payload, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#18100b', light: '#fffaf2' }
    });
    res.json({ payload, shortCode: qr.qr_short_code, permanent: true, image });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me/transactions', authRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name
       FROM transactions t
       LEFT JOIN users s ON s.id = t.staff_id
       WHERE t.client_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ transactions: result.rows.map(transactionResponse) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leaderboard/monthly', authRequired, async (req, res, next) => {
  try {
    const ranked = await pool.query(
      `WITH totals AS (
         SELECT u.id, u.first_name, u.last_name, u.photo_url, u.avatar_source, u.avatar_key,
                u.show_name, u.show_avatar, u.show_leaderboard_amount,
                COALESCE(SUM(t.cash_paid_cents), 0)::bigint AS spend_cents
         FROM users u
         JOIN transactions t ON t.client_id = u.id
         WHERE t.status = 'completed'
           AND t.mode IN ('accrue','redeem')
           AND t.created_at >= date_trunc('month', CURRENT_DATE)
           AND t.created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY u.id, u.first_name, u.last_name, u.photo_url, u.avatar_source, u.avatar_key,
                  u.show_name, u.show_avatar, u.show_leaderboard_amount
       ), positions AS (
         SELECT *, RANK() OVER (ORDER BY spend_cents DESC, id ASC) AS rank
         FROM totals
       )
       SELECT * FROM positions ORDER BY rank, id LIMIT 10`
    );
    const myResult = await pool.query(
      `WITH totals AS (
         SELECT u.id, COALESCE(SUM(t.cash_paid_cents), 0)::bigint AS spend_cents
         FROM users u
         LEFT JOIN transactions t ON t.client_id = u.id
           AND t.status = 'completed'
           AND t.mode IN ('accrue','redeem')
           AND t.created_at >= date_trunc('month', CURRENT_DATE)
           AND t.created_at < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
         GROUP BY u.id
       ), positions AS (
         SELECT *, RANK() OVER (ORDER BY spend_cents DESC, id ASC) AS rank FROM totals
       )
       SELECT rank, spend_cents FROM positions WHERE id = $1`,
      [req.user.id]
    );
    const month = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date());
    res.json({
      month,
      prizeNote: 'Награды за 1–3 место будут объявлены после бета-теста.',
      leaders: ranked.rows.map((row) => {
        const isMe = String(row.id) === String(req.user.id);
        return {
          rank: Number(row.rank),
          name: isMe || row.show_name ? publicLeaderboardName(row) : 'Скрытый гость',
          spend: isMe || row.show_leaderboard_amount ? rubles(row.spend_cents) : null,
          isMe,
          avatarSource: isMe || row.show_avatar ? (row.avatar_source || 'preset_male') : null,
          avatarKey: isMe || row.show_avatar ? (row.avatar_key || null) : null,
          photoUrl: isMe || row.show_avatar ? (row.photo_url || null) : null,
          showAvatar: Boolean(isMe || row.show_avatar)
        };
      }),
      me: myResult.rowCount ? { rank: Number(myResult.rows[0].rank), spend: rubles(myResult.rows[0].spend_cents) } : null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/promotions', authRequired, async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM promotions ORDER BY sort_order, id');
    res.json({ promotions: result.rows.map(promotionResponse) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/shop/catalog', authRequired, async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM shop_items ORDER BY sort_order, id');
    res.json({ items: result.rows.map(shopItemResponse), note: 'Цены указаны в бонусах. Выдача — только в баре после проверки сотрудником.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/staff/session', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const shift = await getCurrentShift();
    const shiftIds = shift?.members?.length ? shift.members.map((member) => member.id) : [];
    const result = await pool.query(
      `SELECT id, telegram_id, username, first_name, last_name, photo_url, avatar_source, avatar_key, role,
              (staff_pin_hash IS NOT NULL AND staff_pin_salt IS NOT NULL) AS pin_configured
       FROM users
       WHERE role IN ('staff','admin')
       ORDER BY CASE WHEN role = 'admin' THEN 1 ELSE 0 END, first_name, id`
    );
    const available = result.rows
      .filter((row) => !shiftIds.length || shiftIds.includes(String(row.id)))
      .map((row) => ({
        id: String(row.id), telegramId: String(row.telegram_id), username: row.username,
        firstName: row.first_name, lastName: row.last_name,
        name: [row.first_name, row.last_name].filter(Boolean).join(' '), role: row.role,
        photoUrl: row.photo_url,
        avatarSource: row.avatar_source || 'preset_male',
        avatarKey: row.avatar_key || null,
        pinConfigured: Boolean(row.pin_configured)
      }));
    const activeStaff = await resolveActingStaff(req);
    res.json({ shift, available, activeStaff: activeStaff ? { id: activeStaff.id, firstName: activeStaff.firstName, lastName: activeStaff.lastName, role: activeStaff.role } : null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/activate', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const userId = String(req.body?.userId || '');
    const pin = normalizeStaffPin(req.body?.pin);
    if (!userId || !pin) return res.status(400).json({ error: 'Введите PIN сотрудника из 4–6 цифр.' });
    const result = await pool.query(
      `SELECT id, first_name, last_name, role, staff_pin_hash, staff_pin_salt
       FROM users WHERE id = $1 AND role IN ('staff','admin')`,
      [userId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Сотрудник не найден.' });
    const row = result.rows[0];
    if (!verifyStaffPin(pin, row.staff_pin_salt, row.staff_pin_hash)) return res.status(403).json({ error: 'Неверный PIN сотрудника.' });
    const shift = await getCurrentShift();
    if (shift?.members?.length && !shift.members.some((member) => String(member.id) === String(row.id))) {
      return res.status(403).json({ error: 'Этот сотрудник не выбран в текущей смене.' });
    }
    const token = signSession({ kind: 'staff', terminalUid: String(req.user.id), staffUid: String(row.id), exp: Date.now() + 16 * 60 * 60 * 1000 });
    res.json({ token, staff: { id: String(row.id), firstName: row.first_name, lastName: row.last_name, role: row.role } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/qr/resolve', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const raw = String(req.body?.payload || '').trim().toUpperCase();
    const token = raw.startsWith(PERSONAL_QR_PREFIX) ? String(req.body.payload).trim().slice(PERSONAL_QR_PREFIX.length) : null;
    const result = await pool.query(
      `SELECT id, qr_token, qr_short_code
       FROM users
       WHERE ${token ? 'qr_token = $1' : 'UPPER(qr_short_code) = $1'}
       LIMIT 1`,
      [token || raw]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Персональный код не найден.' });
    const user = result.rows[0];
    res.json({ qrToken: user.qr_token, shortCode: user.qr_short_code, client: await getProfile(user.id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/transactions', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  const mode = req.body?.mode === 'redeem' ? 'redeem' : 'accrue';
  const amountCents = centsFromInput(req.body?.amount);
  const beerMl = mlFromLiters(req.body?.beerLiters);
  const qrToken = String(req.body?.qrToken || '');
  const requestKey = String(req.body?.requestKey || crypto.randomUUID());
  if (!amountCents) return res.status(400).json({ error: 'Введите сумму чека.' });
  if (!qrToken) return res.status(400).json({ error: 'Сначала отсканируйте QR.' });
  const actingStaff = await resolveActingStaff(req);
  if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM transactions WHERE request_key = $1', [requestKey]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ transaction: transactionResponse(existing.rows[0]), client: await getProfile(existing.rows[0].client_id) });
    }

    const userResult = await client.query(
      `SELECT id, telegram_id, first_name, last_name, qr_short_code
       FROM users WHERE qr_token = $1 FOR UPDATE`,
      [qrToken]
    );
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Персональный QR-код не найден.' });
    }
    const targetUser = userResult.rows[0];

    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [targetUser.id]);
    if (!walletResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Бонусный счёт клиента не найден.' });
    }
    const balance = Number(walletResult.rows[0].balance || 0);
    const beerResult = await client.query('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE', [targetUser.id]);
    if (!beerResult.rowCount) {
      await client.query('INSERT INTO beer_loyalty (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [targetUser.id]);
    }
    const beerWallet = beerResult.rows[0] || { paid_ml_total: 0, gift_ml_balance: 0 };
    const previousPaidMl = Number(beerWallet.paid_ml_total || 0);
    const newPaidMl = previousPaidMl + beerMl;
    const previousGiftCount = Math.floor(previousPaidMl / BEER_PAID_TARGET_ML);
    const newGiftCount = Math.floor(newPaidMl / BEER_PAID_TARGET_ML);
    const beerGiftEarnedMl = Math.max(0, newGiftCount - previousGiftCount) * BEER_GIFT_ML;
    const newGiftBalanceMl = Number(beerWallet.gift_ml_balance || 0) + beerGiftEarnedMl;
    const spend12mCents = await getRollingSpend(client, targetUser.id);
    const status = getStatus(spend12mCents);

    let discountCents = 0;
    let bonusSpent = 0;
    if (mode === 'accrue') {
      discountCents = Math.round((amountCents * status.discountPercent) / 100);
    } else {
      const requested = Math.max(0, Math.floor(Number(req.body?.bonusToSpend || 0)));
      const maxByCheck = Math.floor((amountCents * 30) / 10_000);
      bonusSpent = Math.min(balance, maxByCheck, requested || maxByCheck);
      if (bonusSpent <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Нет доступных бонусов для списания.' });
      }
    }

    const cashPaidCents = Math.max(0, amountCents - discountCents - bonusSpent * 100);
    const bonusEarned = Math.max(0, Math.floor((cashPaidCents * status.bonusPercent) / 10_000));
    const balanceAfter = balance - bonusSpent + bonusEarned;
    const isSuspicious = amountCents > SUSPICIOUS_THRESHOLD_CENTS;

    const txResult = await client.query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, discount_cents, bonus_spent, bonus_earned,
         cash_paid_cents, balance_after, is_suspicious,
         beer_ml, beer_gift_earned_ml, completed_at
       ) VALUES ($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       RETURNING *`,
      [requestKey, targetUser.id, actingStaff.id, mode, amountCents, discountCents, bonusSpent, bonusEarned, cashPaidCents, balanceAfter, isSuspicious, beerMl, beerGiftEarnedMl]
    );
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [balanceAfter, targetUser.id]);
    await client.query(
      'UPDATE beer_loyalty SET paid_ml_total = $1, gift_ml_balance = $2, updated_at = NOW() WHERE user_id = $3',
      [newPaidMl, newGiftBalanceMl, targetUser.id]
    );
    await client.query('COMMIT');

    const tx = txResult.rows[0];
    const beerText = beerMl > 0
      ? `
Разливное: ${litersFromMl(beerMl).toFixed(2).replace(/\.00$/, '')} л${beerGiftEarnedMl ? `
Подарок начислен: ${litersFromMl(beerGiftEarnedMl)} л` : ''}`
      : '';
    const operationText = mode === 'redeem'
      ? `Списано: ${bonusSpent} бонусов
Начислено: ${bonusEarned} бонусов${beerText}`
      : `Начислено: ${bonusEarned} бонусов${beerText}`;
    await sendTelegramMessage(
      targetUser.telegram_id,
      `Операция в баре «Пивник»

Чек: ${rubles(amountCents).toFixed(2)} ₽
${operationText}
К оплате: ${rubles(cashPaidCents).toFixed(2)} ₽
Баланс: ${balanceAfter} бонусов

Если вы не совершали эту операцию, обратитесь к администратору.`
    );

    if (isSuspicious && ownerTelegramId) {
      const clientName = [targetUser.first_name, targetUser.last_name].filter(Boolean).join(' ');
      await sendTelegramMessage(
        ownerTelegramId,
        `⚠️ Подозрительная операция свыше 3000 ₽

Клиент: ${clientName || targetUser.telegram_id}
Сотрудник: ${actingStaff.firstName}
Тип: ${mode === 'redeem' ? 'списание' : 'начисление'}
Чек: ${rubles(amountCents).toFixed(2)} ₽`
      );
    }

    res.json({ transaction: transactionResponse(tx), client: await getProfile(targetUser.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/staff/beer-gift', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  const qrToken = String(req.body?.qrToken || '');
  const requestKey = String(req.body?.requestKey || crypto.randomUUID());
  const giftMl = mlFromLiters(req.body?.giftLiters);
  if (!qrToken) return res.status(400).json({ error: 'Сначала отсканируйте QR.' });
  if (![500, 1000].includes(giftMl)) return res.status(400).json({ error: 'Можно выдать 0,5 или 1 литр подарка.' });
  const actingStaff = await resolveActingStaff(req);
  if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM transactions WHERE request_key = $1', [requestKey]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ transaction: transactionResponse(existing.rows[0]), client: await getProfile(existing.rows[0].client_id) });
    }

    const userResult = await client.query(
      `SELECT id, telegram_id, first_name, last_name
       FROM users WHERE qr_token = $1 FOR UPDATE`,
      [qrToken]
    );
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Персональный QR-код не найден.' });
    }
    const targetUser = userResult.rows[0];
    const beerResult = await client.query('SELECT paid_ml_total, gift_ml_balance FROM beer_loyalty WHERE user_id = $1 FOR UPDATE', [targetUser.id]);
    if (!beerResult.rowCount || Number(beerResult.rows[0].gift_ml_balance || 0) < giftMl) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'На счету недостаточно подарочных литров.' });
    }
    const newGiftBalance = Number(beerResult.rows[0].gift_ml_balance) - giftMl;
    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1', [targetUser.id]);
    const txResult = await client.query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, cash_paid_cents, balance_after,
         beer_gift_spent_ml, reason, completed_at
       ) VALUES ($1,$2,$3,'beer_gift','completed',0,0,$4,$5,$6,NOW())
       RETURNING *`,
      [requestKey, targetUser.id, actingStaff.id, Number(walletResult.rows[0]?.balance || 0), giftMl, `Выдан подарочный объём ${litersFromMl(giftMl)} л`]
    );
    await client.query('UPDATE beer_loyalty SET gift_ml_balance = $1, updated_at = NOW() WHERE user_id = $2', [newGiftBalance, targetUser.id]);
    await client.query('COMMIT');

    await sendTelegramMessage(
      targetUser.telegram_id,
      `Подарок в баре «Пивник»

Выдано бесплатно: ${litersFromMl(giftMl)} л разливного пива.
Осталось подарочного объёма: ${litersFromMl(newGiftBalance)} л.`
    );
    res.json({ transaction: transactionResponse(txResult.rows[0]), client: await getProfile(targetUser.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/staff/shop/purchase', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  const qrToken = String(req.body?.qrToken || '');
  const itemCode = String(req.body?.itemCode || '');
  const requestKey = String(req.body?.requestKey || crypto.randomUUID());
  if (!qrToken) return res.status(400).json({ error: 'Сначала отсканируйте QR.' });
  const itemResult = await pool.query('SELECT * FROM shop_items WHERE code = $1 AND active = TRUE', [itemCode]);
  if (!itemResult.rowCount) return res.status(400).json({ error: 'Товар недоступен.' });
  const item = shopItemResponse(itemResult.rows[0]);
  const actingStaff = await resolveActingStaff(req);
  if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM transactions WHERE request_key = $1', [requestKey]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ transaction: transactionResponse(existing.rows[0]), client: await getProfile(existing.rows[0].client_id) });
    }
    const userResult = await client.query('SELECT id, telegram_id, first_name FROM users WHERE qr_token = $1 FOR UPDATE', [qrToken]);
    if (!userResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Персональный QR-код не найден.' });
    }
    const target = userResult.rows[0];
    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [target.id]);
    const balance = Number(walletResult.rows[0]?.balance || 0);
    if (balance < item.bonusPrice) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Недостаточно бонусов. Нужно ${item.bonusPrice} Б.` });
    }
    const balanceAfter = balance - item.bonusPrice;
    const txResult = await client.query(
      `INSERT INTO transactions (request_key, client_id, staff_id, mode, status, bonus_spent, balance_after, reason, completed_at)
       VALUES ($1,$2,$3,'shop','completed',$4,$5,$6,NOW()) RETURNING *`,
      [requestKey, target.id, actingStaff.id, item.bonusPrice, balanceAfter, item.title]
    );
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [balanceAfter, target.id]);
    await client.query('COMMIT');
    await sendTelegramMessage(target.telegram_id, `Покупка в лавке «Пивника»

${item.title}
Списано: ${item.bonusPrice} бонусов
Баланс: ${balanceAfter} бонусов`);
    res.json({ transaction: transactionResponse(txResult.rows[0]), client: await getProfile(target.id), item });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/staff/recent', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const actingStaff = await resolveActingStaff(req);
    if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });
    const quota = await getCancellationQuota(actingStaff.id);
    const from = quota.active ? quota.countFrom : new Date(Date.now() - 16 * 60 * 60 * 1000);
    const result = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name
       FROM transactions t JOIN users c ON c.id = t.client_id
       WHERE t.staff_id = $1 AND t.created_at >= $2
       ORDER BY t.created_at DESC LIMIT 12`,
      [actingStaff.id, from]
    );
    res.json({ transactions: result.rows.map(transactionResponse), quota });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/transactions/:id/cancel', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Укажите причину отмены.' });
  const actingStaff = await resolveActingStaff(req);
  if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });
  const quota = await getCancellationQuota(actingStaff.id);
  if (!quota.active) return res.status(403).json({ error: 'Отмена доступна только в активной смене.' });
  if (quota.remaining <= 0) return res.status(403).json({ error: 'Лимит отмен исчерпан. Следующую отмену проводит владелец.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = await cancelCompletedTransaction(client, req.params.id, actingStaff.id, reason, { staffId: actingStaff.id, notBefore: quota.countFrom });
    await client.query('COMMIT');
    const profile = await getProfile(tx.client_id);
    await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена.
Причина: ${reason}
Текущий баланс: ${profile.balance} бонусов.`);
    res.json({ ok: true, transaction: transactionResponse(tx), client: profile, quota: await getCancellationQuota(actingStaff.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/staff/transactions/:id', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const actingStaff = await resolveActingStaff(req);
    if (!actingStaff) return res.status(401).json({ error: 'Сессия сотрудника истекла. Введите PIN снова.' });
    const result = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name
       FROM transactions t
       JOIN users c ON c.id = t.client_id
       WHERE t.id = $1 AND t.staff_id = $2`,
      [req.params.id, actingStaff.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Операция не найдена.' });
    res.json({ transaction: transactionResponse(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/shift/current', authRequired, async (_req, res, next) => {
  try {
    res.json({ shift: await getCurrentShift() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/shift', authRequired, requireRole('viewer', 'admin'), async (_req, res, next) => {
  try {
    const staffResult = await pool.query(
      `SELECT id, telegram_id, username, first_name, last_name, photo_url, avatar_source, avatar_key, role
       FROM users
       WHERE role IN ('staff','admin')
       ORDER BY CASE WHEN role = 'admin' THEN 1 ELSE 0 END, first_name, id`
    );
    res.json({
      shift: await getCurrentShift(),
      staff: staffResult.rows.map((row) => ({
        id: String(row.id),
        telegramId: String(row.telegram_id),
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        name: [row.first_name, row.last_name].filter(Boolean).join(' '),
        photoUrl: row.photo_url,
        avatarSource: row.avatar_source || 'preset_male',
        avatarKey: row.avatar_key || null,
        role: row.role
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/shift', authRequired, requireRole('admin'), async (req, res, next) => {
  const staffIds = [...new Set((Array.isArray(req.body?.staffIds) ? req.body.staffIds : []).map(String))].slice(0, 20);
  const note = String(req.body?.note || '').trim().slice(0, 120);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activeResult = await client.query(
      `SELECT id FROM shifts WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE`
    );

    if (!staffIds.length) {
      if (activeResult.rowCount) {
        await client.query('UPDATE shifts SET ended_at = NOW(), updated_at = NOW() WHERE id = $1', [activeResult.rows[0].id]);
      }
      await client.query('COMMIT');
      return res.json({ ok: true, shift: null });
    }

    const validResult = await client.query(
      `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND role IN ('staff','admin')`,
      [staffIds]
    );
    const validIds = validResult.rows.map((row) => String(row.id));
    if (validIds.length !== staffIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В составе смены есть пользователь без роли сотрудника.' });
    }

    let shiftId;
    if (activeResult.rowCount) {
      shiftId = activeResult.rows[0].id;
      await client.query('UPDATE shifts SET note = $1, updated_at = NOW() WHERE id = $2', [note || null, shiftId]);
      await client.query('DELETE FROM shift_members WHERE shift_id = $1', [shiftId]);
    } else {
      const shiftResult = await client.query(
        'INSERT INTO shifts (note, created_by) VALUES ($1,$2) RETURNING id',
        [note || null, req.user.id]
      );
      shiftId = shiftResult.rows[0].id;
    }

    for (let index = 0; index < staffIds.length; index += 1) {
      await client.query(
        'INSERT INTO shift_members (shift_id, user_id, position) VALUES ($1,$2,$3)',
        [shiftId, staffIds[index], index]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, shift: await getCurrentShift() });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/admin/summary', authRequired, requireRole('viewer', 'admin'), async (req, res, next) => {
  try {
    const summaryResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS clients,
        (SELECT COALESCE(SUM(bonus_earned),0)::bigint FROM transactions WHERE status='completed') AS issued,
        (SELECT COUNT(*)::int FROM transactions WHERE created_at::date = CURRENT_DATE) AS today_ops,
        (SELECT COALESCE(SUM(check_amount_cents),0)::bigint FROM transactions WHERE status='completed' AND created_at::date = CURRENT_DATE) AS today_check_cents,
        (SELECT COUNT(*)::int FROM transactions WHERE is_suspicious = TRUE AND status = 'completed') AS suspicious_ops,
        (SELECT COUNT(*)::int FROM transactions WHERE status = 'cancelled' AND cancelled_at::date = CURRENT_DATE) AS cancelled_today
    `);
    const opsResult = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name,
              CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name
       FROM transactions t
       JOIN users c ON c.id = t.client_id
       LEFT JOIN users s ON s.id = t.staff_id
       ORDER BY t.created_at DESC
       LIMIT 30`
    );
    const settingsResult = await pool.query('SELECT draft, published, updated_at FROM app_settings WHERE id = 1');
    res.json({
      summary: {
        clients: summaryResult.rows[0].clients,
        issued: Number(summaryResult.rows[0].issued || 0),
        todayOperations: summaryResult.rows[0].today_ops,
        todayCheck: rubles(summaryResult.rows[0].today_check_cents),
        suspiciousOperations: summaryResult.rows[0].suspicious_ops,
        cancelledToday: summaryResult.rows[0].cancelled_today
      },
      operations: opsResult.rows.map(transactionResponse),
      settings: settingsResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', authRequired, requireRole('viewer', 'admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.role, u.created_at, u.qr_short_code, w.balance,
              bl.paid_ml_total, bl.gift_ml_balance,
              (u.staff_pin_hash IS NOT NULL AND u.staff_pin_salt IS NOT NULL) AS pin_configured
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
       ORDER BY u.created_at DESC
       LIMIT 200`
    );
    res.json({ users: result.rows.map((row) => ({
      id: String(row.id),
      telegramId: String(row.telegram_id),
      username: row.username,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      role: row.role,
      balance: Number(row.balance || 0),
      qrShortCode: row.qr_short_code,
      beerPaidLitersTotal: litersFromMl(row.paid_ml_total),
      beerGiftLitersBalance: litersFromMl(row.gift_ml_balance),
      pinConfigured: Boolean(row.pin_configured),
      createdAt: row.created_at
    })) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/role', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const role = String(req.body?.role || 'client');
    if (!['client', 'staff', 'viewer'].includes(role)) return res.status(400).json({ error: 'Недопустимая роль.' });
    const target = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.params.id]);
    if (!target.rowCount) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (String(target.rows[0].telegram_id) === ownerTelegramId) return res.status(400).json({ error: 'Роль владельца менять нельзя.' });
    await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/pin', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const pin = normalizeStaffPin(req.body?.pin);
    if (!pin) return res.status(400).json({ error: 'PIN должен содержать 4–6 цифр.' });
    const target = await pool.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (!target.rowCount) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (!['staff','admin'].includes(target.rows[0].role)) return res.status(400).json({ error: 'PIN можно назначить только сотруднику.' });
    const { salt, hash } = createStaffPinHash(pin);
    await pool.query(
      'UPDATE users SET staff_pin_hash = $1, staff_pin_salt = $2, staff_pin_updated_at = NOW(), updated_at = NOW() WHERE id = $3',
      [hash, salt, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/reissue-qr', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const qr = await ensurePersonalQr(pool, req.params.id, true);
    res.json({ ok: true, shortCode: qr.qr_short_code });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/adjust', authRequired, requireRole('admin'), async (req, res, next) => {
  const amount = Math.trunc(Number(req.body?.amount || 0));
  const reason = String(req.body?.reason || '').trim();
  if (!amount || !reason) return res.status(400).json({ error: 'Укажите сумму и причину.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [req.params.id]);
    if (!walletResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден.' });
    }
    const oldBalance = Number(walletResult.rows[0].balance || 0);
    const newBalance = oldBalance + amount;
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Баланс не может стать отрицательным.' });
    }
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, req.params.id]);
    await client.query(
      `INSERT INTO transactions (client_id, staff_id, mode, status, bonus_spent, bonus_earned, balance_after, reason, completed_at)
       VALUES ($1,$2,'adjustment','completed',$3,$4,$5,$6,NOW())`,
      [req.params.id, req.user.id, amount < 0 ? Math.abs(amount) : 0, amount > 0 ? amount : 0, newBalance, reason]
    );
    await client.query('COMMIT');
    res.json({ ok: true, balance: newBalance });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/admin/transactions/:id/cancel', authRequired, requireRole('admin'), async (req, res, next) => {
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Укажите причину отмены.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = await cancelCompletedTransaction(client, req.params.id, req.user.id, reason);
    await client.query('COMMIT');
    const profile = await getProfile(tx.client_id);
    await sendTelegramMessage(profile.telegramId, `Операция в баре «Пивник» отменена владельцем.
Причина: ${reason}
Текущий баланс: ${profile.balance} бонусов.`);
    res.json({ ok: true, transaction: transactionResponse(tx), client: profile });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/admin/users/:id/cancel-limit/reset', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const shift = await getCurrentShift();
    if (!shift) return res.status(400).json({ error: 'Сейчас нет активной смены.' });
    if (!shift.members.some((member) => String(member.id) === String(req.params.id))) {
      return res.status(400).json({ error: 'Сотрудник не входит в текущую смену.' });
    }
    await pool.query(
      'INSERT INTO cancel_quota_resets (shift_id, user_id, reset_by) VALUES ($1,$2,$3)',
      [shift.id, req.params.id, req.user.id]
    );
    res.json({ ok: true, quota: await getCancellationQuota(req.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/content', authRequired, requireRole('viewer', 'admin'), async (_req, res, next) => {
  try {
    const [promotions, shopItems] = await Promise.all([
      pool.query('SELECT * FROM promotions ORDER BY sort_order, id'),
      pool.query('SELECT * FROM shop_items ORDER BY sort_order, id')
    ]);
    res.json({ promotions: promotions.rows.map(promotionResponse), shopItems: shopItems.rows.map(shopItemResponse) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/promotions', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const title = contentText(req.body?.title, 120);
    if (!title) return res.status(400).json({ error: 'Укажите название акции.' });
    const description = contentText(req.body?.description, 500);
    const badge = contentText(req.body?.badge, 40);
    const imageSrc = normalizeContentImage(req.body?.imageSrc);
    const active = req.body?.active !== false;
    const sortOrder = Math.max(-9999, Math.min(9999, Math.trunc(Number(req.body?.sortOrder || 0))));
    const result = await pool.query(
      `INSERT INTO promotions (code,title,description,badge,image_src,active,sort_order,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [makeContentCode('promo'), title, description, badge, imageSrc, active, sortOrder, req.user.id]
    );
    res.json({ promotion: promotionResponse(result.rows[0]) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

app.put('/api/admin/promotions/:id', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const title = contentText(req.body?.title, 120);
    if (!title) return res.status(400).json({ error: 'Укажите название акции.' });
    const imageSrc = normalizeContentImage(req.body?.imageSrc);
    const result = await pool.query(
      `UPDATE promotions SET title=$1, description=$2, badge=$3, image_src=$4, active=$5, sort_order=$6, updated_by=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [title, contentText(req.body?.description, 500), contentText(req.body?.badge, 40), imageSrc,
       req.body?.active !== false, Math.max(-9999, Math.min(9999, Math.trunc(Number(req.body?.sortOrder || 0)))), req.user.id, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Акция не найдена.' });
    res.json({ promotion: promotionResponse(result.rows[0]) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

app.delete('/api/admin/promotions/:id', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM promotions WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Акция не найдена.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/admin/shop-items', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const title = contentText(req.body?.title, 120);
    const bonusPrice = Math.trunc(Number(req.body?.bonusPrice || 0));
    if (!title) return res.status(400).json({ error: 'Укажите название товара.' });
    if (bonusPrice < 1 || bonusPrice > 1_000_000) return res.status(400).json({ error: 'Цена должна быть от 1 до 1 000 000 бонусов.' });
    const imageSrc = normalizeContentImage(req.body?.imageSrc);
    const result = await pool.query(
      `INSERT INTO shop_items (code,title,subtitle,bonus_price,image_src,active,sort_order,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [makeContentCode('item'), title, contentText(req.body?.subtitle, 500), bonusPrice, imageSrc,
       req.body?.active !== false, Math.max(-9999, Math.min(9999, Math.trunc(Number(req.body?.sortOrder || 0)))), req.user.id]
    );
    res.json({ item: shopItemResponse(result.rows[0]) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

app.put('/api/admin/shop-items/:id', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const title = contentText(req.body?.title, 120);
    const bonusPrice = Math.trunc(Number(req.body?.bonusPrice || 0));
    if (!title) return res.status(400).json({ error: 'Укажите название товара.' });
    if (bonusPrice < 1 || bonusPrice > 1_000_000) return res.status(400).json({ error: 'Цена должна быть от 1 до 1 000 000 бонусов.' });
    const imageSrc = normalizeContentImage(req.body?.imageSrc);
    const result = await pool.query(
      `UPDATE shop_items SET title=$1, subtitle=$2, bonus_price=$3, image_src=$4, active=$5, sort_order=$6, updated_by=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [title, contentText(req.body?.subtitle, 500), bonusPrice, imageSrc, req.body?.active !== false,
       Math.max(-9999, Math.min(9999, Math.trunc(Number(req.body?.sortOrder || 0)))), req.user.id, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Товар не найден.' });
    res.json({ item: shopItemResponse(result.rows[0]) });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
});

app.delete('/api/admin/shop-items/:id', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM shop_items WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Товар не найден.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.put('/api/admin/design/draft', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const design = req.body?.design;
    if (!design || typeof design !== 'object') return res.status(400).json({ error: 'Некорректные настройки дизайна.' });
    await pool.query(
      'UPDATE app_settings SET draft = $1::jsonb, updated_by = $2, updated_at = NOW() WHERE id = 1',
      [JSON.stringify(design), req.user.id]
    );
    res.json({ ok: true, draft: design });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/design/publish', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE app_settings
       SET published = draft, updated_by = $1, updated_at = NOW()
       WHERE id = 1
       RETURNING published`,
      [req.user.id]
    );
    res.json({ ok: true, design: result.rows[0].published });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/design/reset', authRequired, requireRole('admin'), async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE app_settings SET draft = $1::jsonb, updated_by = $2, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(DEFAULT_DESIGN), req.user.id]
    );
    res.json({ ok: true, draft: DEFAULT_DESIGN });
  } catch (error) {
    next(error);
  }
});

app.get('/styles.css', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'app.js')));
app.get('/', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'index.html')));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error(error);
  const message = process.env.NODE_ENV === 'production' ? 'Внутренняя ошибка сервера.' : error.message;
  res.status(500).json({ error: message });
});

await initDatabase();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Pivnik app is running on port ${port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
