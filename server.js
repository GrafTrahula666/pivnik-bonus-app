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
app.use(express.json({ limit: '1mb' }));

const STATUS_LEVELS = [
  { minCents: 0, name: 'Путник', bonusPercent: 5, discountPercent: 0, nextCents: 1_000_000 },
  { minCents: 1_000_000, name: 'Странник', bonusPercent: 6, discountPercent: 1, nextCents: 3_000_000 },
  { minCents: 3_000_000, name: 'Гость таверны', bonusPercent: 7, discountPercent: 2, nextCents: 7_000_000 },
  { minCents: 7_000_000, name: 'Завсегдатай', bonusPercent: 8, discountPercent: 3, nextCents: 10_000_000 },
  { minCents: 10_000_000, name: 'Местный пьяница', bonusPercent: 9, discountPercent: 4, nextCents: 15_000_000 },
  { minCents: 15_000_000, name: 'Легендарный пьяница', bonusPercent: 10, discountPercent: 5, nextCents: 50_000_000 },
  { minCents: 50_000_000, name: 'Король Пивника', bonusPercent: 20, discountPercent: 10, nextCents: null }
];

const DEFAULT_DESIGN = {
  colors: {
    background: '#0e0c0a',
    header: '#15110e',
    surface: '#1c1612',
    card: '#231a14',
    text: '#f7eee5',
    muted: '#a99580',
    accent: '#e9a83b',
    accentSoft: '#ffc96b'
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
    team: true,
    byline: true
  },
  radius: 20,
  splash: {
    enabled: false,
    imageUrl: ''
  }
};

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
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
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
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_client_date ON transactions(client_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_qr_expiry ON qr_sessions(expires_at)');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
    `SELECT u.*, w.balance
     FROM users u
     JOIN wallets w ON w.user_id = u.id
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
    role: row.role,
    balance: Number(row.balance || 0),
    spend12m: rubles(spend12mCents),
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
    staffName: row.staff_name
  };
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
      const userResult = await client.query(
        `INSERT INTO users (telegram_id, username, first_name, last_name, photo_url, language_code, role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (telegram_id) DO UPDATE SET
           username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           photo_url = EXCLUDED.photo_url,
           language_code = EXCLUDED.language_code,
           role = CASE WHEN $7 = 'admin' THEN 'admin' ELSE users.role END,
           updated_at = NOW()
         RETURNING id`,
        [telegramUser.id, telegramUser.username, telegramUser.firstName, telegramUser.lastName, telegramUser.photoUrl, telegramUser.languageCode, role]
      );
      const userId = userResult.rows[0].id;
      await client.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
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

app.post('/api/me/qr', authRequired, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM qr_sessions WHERE expires_at < NOW() - INTERVAL \'10 minutes\'');
    const token = crypto.randomBytes(18).toString('base64url');
    const shortCode = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 30_000);
    await pool.query('DELETE FROM qr_sessions WHERE user_id = $1 AND used_at IS NULL', [req.user.id]);
    await pool.query(
      'INSERT INTO qr_sessions (token, short_code, user_id, expires_at) VALUES ($1, $2, $3, $4)',
      [token, shortCode, req.user.id, expiresAt]
    );
    const payload = `PIVNIK:${token}`;
    const image = await QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
    res.json({ payload, shortCode, expiresAt: expiresAt.toISOString(), image });
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

app.get('/api/me/pending', authRequired, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE transactions SET status = 'expired'
       WHERE client_id = $1 AND status = 'pending' AND expires_at < NOW()`,
      [req.user.id]
    );
    const result = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name
       FROM transactions t
       LEFT JOIN users s ON s.id = t.staff_id
       WHERE t.client_id = $1 AND t.status = 'pending'
       ORDER BY t.created_at DESC
       LIMIT 1`,
      [req.user.id]
    );
    res.json({ pending: result.rowCount ? transactionResponse(result.rows[0]) : null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/me/pending/:id/decision', authRequired, async (req, res, next) => {
  const approved = Boolean(req.body?.approved);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txResult = await client.query(
      `SELECT t.*, u.telegram_id
       FROM transactions t
       JOIN users u ON u.id = t.client_id
       WHERE t.id = $1 AND t.client_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    if (!txResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Операция не найдена.' });
    }
    const tx = txResult.rows[0];
    if (tx.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Операция уже обработана.' });
    }
    if (new Date(tx.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE transactions SET status = 'expired' WHERE id = $1", [tx.id]);
      await client.query('COMMIT');
      return res.status(410).json({ error: 'Время подтверждения истекло.' });
    }

    if (!approved) {
      await client.query("UPDATE transactions SET status = 'declined', completed_at = NOW() WHERE id = $1", [tx.id]);
      await client.query('COMMIT');
      return res.json({ status: 'declined' });
    }

    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    const balance = Number(walletResult.rows[0].balance || 0);
    if (balance < Number(tx.bonus_spent)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'На счёте уже недостаточно бонусов.' });
    }
    const newBalance = balance - Number(tx.bonus_spent) + Number(tx.bonus_earned);
    await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, req.user.id]);
    const completed = await client.query(
      `UPDATE transactions
       SET status = 'completed', balance_after = $1, completed_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [newBalance, tx.id]
    );
    await client.query('COMMIT');

    await sendTelegramMessage(
      tx.telegram_id,
      `Покупка в баре «Пивник»\n\nЧек: ${rubles(tx.check_amount_cents).toFixed(2)} ₽\nСписано: ${tx.bonus_spent} бонусов\nНачислено: ${tx.bonus_earned} бонусов\nБаланс: ${newBalance} бонусов`
    );
    res.json({ transaction: transactionResponse(completed.rows[0]), profile: await getProfile(req.user.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/staff/qr/resolve', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const raw = String(req.body?.payload || '').trim();
    const token = raw.startsWith('PIVNIK:') ? raw.slice(7) : null;
    const result = await pool.query(
      `SELECT q.token, q.short_code, q.expires_at, q.used_at, q.user_id
       FROM qr_sessions q
       WHERE (${token ? 'q.token = $1' : 'q.short_code = $1'})
       LIMIT 1`,
      [token || raw]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'QR-код не найден.' });
    const qr = result.rows[0];
    if (qr.used_at) return res.status(409).json({ error: 'QR-код уже использован.' });
    if (new Date(qr.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'QR-код истёк.' });
    res.json({ qrToken: qr.token, client: await getProfile(qr.user_id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/staff/transactions', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  const mode = req.body?.mode === 'redeem' ? 'redeem' : 'accrue';
  const amountCents = centsFromInput(req.body?.amount);
  const qrToken = String(req.body?.qrToken || '');
  const requestKey = String(req.body?.requestKey || crypto.randomUUID());
  if (!amountCents) return res.status(400).json({ error: 'Введите сумму чека.' });
  if (!qrToken) return res.status(400).json({ error: 'Сначала отсканируйте QR.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM transactions WHERE request_key = $1', [requestKey]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.json({ transaction: transactionResponse(existing.rows[0]) });
    }
    const qrResult = await client.query(
      `SELECT * FROM qr_sessions WHERE token = $1 FOR UPDATE`,
      [qrToken]
    );
    if (!qrResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'QR-код не найден.' });
    }
    const qr = qrResult.rows[0];
    if (qr.used_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'QR-код уже использован.' });
    }
    if (new Date(qr.expires_at).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'QR-код истёк.' });
    }

    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [qr.user_id]);
    const balance = Number(walletResult.rows[0].balance || 0);
    const spend12mCents = await getRollingSpend(client, qr.user_id);
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

    const cashPaidCents = amountCents - discountCents - bonusSpent * 100;
    const bonusEarned = Math.max(0, Math.floor((cashPaidCents * status.bonusPercent) / 10_000));
    const txStatus = mode === 'redeem' ? 'pending' : 'completed';
    const expiresAt = mode === 'redeem' ? new Date(Date.now() + 60_000) : null;
    const balanceAfter = mode === 'accrue' ? balance + bonusEarned : null;

    const txResult = await client.query(
      `INSERT INTO transactions (
         request_key, client_id, staff_id, mode, status,
         check_amount_cents, discount_cents, bonus_spent, bonus_earned,
         cash_paid_cents, balance_after, expires_at, completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $5 = 'completed' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [requestKey, qr.user_id, req.user.id, mode, txStatus, amountCents, discountCents, bonusSpent, bonusEarned, cashPaidCents, balanceAfter, expiresAt]
    );
    await client.query('UPDATE qr_sessions SET used_at = NOW() WHERE token = $1', [qrToken]);
    if (mode === 'accrue') {
      await client.query('UPDATE wallets SET balance = $1, updated_at = NOW() WHERE user_id = $2', [balanceAfter, qr.user_id]);
    }
    const telegramResult = await client.query('SELECT telegram_id FROM users WHERE id = $1', [qr.user_id]);
    await client.query('COMMIT');

    const tx = txResult.rows[0];
    if (mode === 'accrue') {
      await sendTelegramMessage(
        telegramResult.rows[0].telegram_id,
        `Покупка в баре «Пивник»\n\nЧек: ${rubles(amountCents).toFixed(2)} ₽\nСкидка: ${rubles(discountCents).toFixed(2)} ₽\nНачислено: ${bonusEarned} бонусов\nБаланс: ${balanceAfter} бонусов`
      );
    } else {
      await sendTelegramMessage(
        telegramResult.rows[0].telegram_id,
        `Подтвердите списание в приложении «Пивник».\n\nЧек: ${rubles(amountCents).toFixed(2)} ₽\nК списанию: ${bonusSpent} бонусов\nК оплате: ${rubles(cashPaidCents).toFixed(2)} ₽`
      );
    }
    res.json({ transaction: transactionResponse(tx), client: await getProfile(qr.user_id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/staff/transactions/:id', authRequired, requireRole('staff', 'admin'), async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, CONCAT_WS(' ', c.first_name, c.last_name) AS client_name
       FROM transactions t
       JOIN users c ON c.id = t.client_id
       WHERE t.id = $1 AND t.staff_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Операция не найдена.' });
    res.json({ transaction: transactionResponse(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/summary', authRequired, requireRole('viewer', 'admin'), async (req, res, next) => {
  try {
    const summaryResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS clients,
        (SELECT COALESCE(SUM(bonus_earned),0)::bigint FROM transactions WHERE status='completed') AS issued,
        (SELECT COUNT(*)::int FROM transactions WHERE created_at::date = CURRENT_DATE) AS today_ops,
        (SELECT COALESCE(SUM(check_amount_cents),0)::bigint FROM transactions WHERE status='completed' AND created_at::date = CURRENT_DATE) AS today_check_cents
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
        todayCheck: rubles(summaryResult.rows[0].today_check_cents)
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
      `SELECT u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.role, u.created_at, w.balance
       FROM users u
       JOIN wallets w ON w.user_id = u.id
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

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/docs', express.static(path.join(__dirname, 'docs')));

app.get('/styles.css', (_req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
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
