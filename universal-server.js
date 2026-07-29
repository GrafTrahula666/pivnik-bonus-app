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
const vkAppId = String(process.env.VK_APP_ID || '').trim();
const vkAppSecret = String(process.env.VK_APP_SECRET || '').trim();
const allowDemo = String(process.env.ALLOW_DEMO || '').toLowerCase() === 'true';

const TERMS_VERSION = 'beta-0.4';
const WELCOME_BONUS = 100;
const QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BODY_BYTES = 1024 * 1024;
const VK_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
const BAR_CODE = 'pivnik';
const BAR_NAME = 'ПИВНИК';
const BAR_ADDRESS = 'Санкт-Петербург, пр. Энгельса, 55';

if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const useSsl = !databaseUrl.includes('railway.internal');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: 4,
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

function makeShortCode() {
  const chars = Array.from({ length: 8 }, () => QR_ALPHABET[crypto.randomInt(0, QR_ALPHABET.length)]).join('');
  return `PVK-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
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

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

async function waitForChild(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${internalPort}/api/health`, { signal: AbortSignal.timeout(1500) });
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
    await client.query(
      `INSERT INTO bars (code, name, address)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, updated_at = NOW()`,
      [BAR_CODE, BAR_NAME, BAR_ADDRESS]
    );
    await client.query(`
      INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url)
      SELECT id, 'telegram', telegram_id::text, username, photo_url
      FROM users
      WHERE telegram_id IS NOT NULL
      ON CONFLICT (provider, provider_user_id) DO UPDATE
      SET provider_username = EXCLUDED.provider_username,
          profile_url = EXCLUDED.profile_url,
          updated_at = NOW()
    `);
    await client.query(`
      INSERT INTO bar_customers (bar_id, user_id)
      SELECT b.id, u.id
      FROM bars b CROSS JOIN users u
      WHERE b.code = $1
      ON CONFLICT (bar_id, user_id) DO NOTHING
    `, [BAR_CODE]);
    await client.query('COMMIT');
    platformReady = true;
    console.log('VK platform schema is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensurePersonalQr(db, userId) {
  const current = await db.query('SELECT qr_token, qr_short_code FROM users WHERE id = $1', [userId]);
  if (current.rowCount && current.rows[0].qr_token && current.rows[0].qr_short_code) return;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await db.query(
        `UPDATE users SET qr_token = $1, qr_short_code = $2, updated_at = NOW() WHERE id = $3`,
        [crypto.randomBytes(24).toString('base64url'), makeShortCode(), userId]
      );
      return;
    } catch (error) {
      if (error.code === '23505') continue;
      throw error;
    }
  }
  throw new Error('Не удалось создать уникальный QR-код.');
}

async function resolveVkUser(vkAuth, rawUser) {
  const user = rawUser && typeof rawUser === 'object' ? rawUser : {};
  if (String(user.id || '') && String(user.id) !== vkAuth.userId) {
    throw Object.assign(new Error('Данные профиля VK не совпадают с подписью запуска.'), { statusCode: 401 });
  }
  return {
    id: vkAuth.userId,
    firstName: safeText(user.first_name, 80, 'Пользователь'),
    lastName: safeText(user.last_name, 80, ''),
    username: safeText(user.screen_name, 100, `id${vkAuth.userId}`),
    photoUrl: safeHttpsUrl(user.photo_200 || user.photo_100 || user.photo_max_orig),
    languageCode: vkAuth.languageCode
  };
}

async function authenticateVk(body) {
  let vkAuth;
  if (allowDemo && body?.demoVkId) {
    vkAuth = { userId: String(body.demoVkId), languageCode: 'ru', platform: 'demo' };
  } else {
    vkAuth = validateVkLaunchParams(body?.launchParams);
  }
  const vkUser = await resolveVkUser(vkAuth, body?.user);
  const client = await pool.connect();
  let userId;
  let isNew = false;

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vk:${vkUser.id}`]);

    const identityResult = await client.query(
      `SELECT ui.user_id, u.telegram_id
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider = 'vk' AND ui.provider_user_id = $1
       FOR UPDATE`,
      [vkUser.id]
    );

    if (identityResult.rowCount) {
      userId = identityResult.rows[0].user_id;
      if (!identityResult.rows[0].telegram_id) {
        await client.query(
          `UPDATE users SET username = $2, first_name = $3, last_name = $4, photo_url = $5,
             language_code = $6, updated_at = NOW() WHERE id = $1`,
          [userId, vkUser.username, vkUser.firstName, vkUser.lastName || null, vkUser.photoUrl, vkUser.languageCode]
        );
      }
    } else {
      const isOwner = Boolean(ownerVkId && vkUser.id === ownerVkId);
      if (isOwner && ownerTelegramId) {
        const ownerResult = await client.query('SELECT id FROM users WHERE telegram_id::text = $1 FOR UPDATE', [ownerTelegramId]);
        if (ownerResult.rowCount) userId = ownerResult.rows[0].id;
      }

      if (!userId) {
        const inserted = await client.query(
          `INSERT INTO users (
             telegram_id, username, first_name, last_name, photo_url, language_code, role,
             terms_accepted_at, terms_version, onboarding_completed_at, unlimited_bonus, profile_frame
           ) VALUES (
             NULL, $1, $2, $3, $4, $5, $6, NOW(), $7, NOW(), $8, $9
           ) RETURNING id`,
          [
            vkUser.username,
            vkUser.firstName,
            vkUser.lastName || null,
            vkUser.photoUrl,
            vkUser.languageCode,
            isOwner ? 'admin' : 'client',
            TERMS_VERSION,
            isOwner,
            isOwner ? 'money' : 'none'
          ]
        );
        userId = inserted.rows[0].id;
        isNew = true;
      }

      await client.query(
        `INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username, profile_url)
         VALUES ($1, 'vk', $2, $3, $4)
         ON CONFLICT (provider, provider_user_id) DO UPDATE
         SET provider_username = EXCLUDED.provider_username,
             profile_url = EXCLUDED.profile_url,
             updated_at = NOW()`,
        [userId, vkUser.id, vkUser.username, vkUser.photoUrl]
      );
    }

    const barResult = await client.query('SELECT id FROM bars WHERE code = $1', [BAR_CODE]);
    await client.query(
      `INSERT INTO bar_customers (bar_id, user_id) VALUES ($1, $2)
       ON CONFLICT (bar_id, user_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
      [barResult.rows[0].id, userId]
    );
    await client.query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, isNew ? WELCOME_BONUS : 0]
    );
    await client.query('INSERT INTO beer_loyalty (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);

    if (isNew && WELCOME_BONUS > 0) {
      await client.query(
        `INSERT INTO transactions (client_id, mode, status, bonus_earned, balance_after, reason, completed_at)
         VALUES ($1, 'welcome', 'completed', $2, $3, 'Приветственный бонус за регистрацию через VK', NOW())`,
[userId, WELCOME_BONUS, WELCOME_BONUS]
      );
    }

    await ensurePersonalQr(client, userId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const token = signSession({ uid: String(userId), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const response = await fetch(`http://127.0.0.1:${internalPort}/api/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'Не удалось открыть профиль.'), { statusCode: response.status });
  }

  data.profile = {
    ...data.profile,
    platform: 'vk',
    vkId: vkUser.id,
    bar: { code: BAR_CODE, name: BAR_NAME }
  };
  return { token, ...data };
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Слишком большой запрос.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

function proxyRequest(req, res, bodyBuffer = null) {
  if (!childReady) return sendJson(res, 503, { error: 'Приложение запускается. Повторите через несколько секунд.' });
  const headers = { ...req.headers, host: `127.0.0.1:${internalPort}` };
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

async function renderVkIndex() {
  const source = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  return source
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(
      /<script defer src="app\.js([^"]*)"><\/script>/i,
      '<script defer src="https://unpkg.com/@vkontakte/vk-bridge@2.15.11/dist/browser.min.js"></script>\n  <script defer src="/vk-platform.js?v=1.0.0"></script>\n  <script defer src="app.js$1"></script>'
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

    if (req.method === 'GET' && (url.pathname === '/vk' || url.pathname === '/vk/')) {
      const html = Buffer.from(await renderVkIndex());
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
    if (req.method === 'GET' && url.pathname === '/legal/privacy') {
      return serveFile(res, path.join(__dirname, 'legal', 'privacy.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/legal/terms') {
      return serveFile(res, path.join(__dirname, 'legal', 'terms.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/platform-health') {
      return sendJson(res, platformReady ? 200 : 503, {
        ok: platformReady,
        telegram: true,
        vk: Boolean(vkAppId && vkAppSecret),
        bar: BAR_CODE,
        timestamp: new Date().toISOString()
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth') {
      const bodyBuffer = await readRequestBody(req);
      let body = {};
      try { body = JSON.parse(bodyBuffer.toString('utf8') || '{}'); }
      catch { return sendJson(res, 400, { error: 'Некорректный JSON.' }); }

      if (body.platform === 'vk') {
        if (!platformReady) return sendJson(res, 503, { error: 'VK-версия приложения ещё запускается.' });
        try {
          return sendJson(res, 200, await authenticateVk(body));
        } catch (error) {
          console.error('VK auth failed:', error.message);
          return sendJson(res, Number(error.statusCode || 500), {
            error: error.statusCode ? error.message : 'Не удалось войти через VK.'
          });
        }
      }
      return proxyRequest(req, res, bodyBuffer);
    }

    return proxyRequest(req, res);
  } catch (error) {
    console.error('Universal server error:', error);
    return sendJson(res, Number(error.statusCode || 500), { error: error.message || 'Внутренняя ошибка сервера.' });
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
