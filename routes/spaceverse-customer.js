import { createSpaceverseCustomerAuth } from '../spaceverse-customer-auth.js';
import { validateTelegramInitData, validateVkLaunchParams } from '../platform-core.js';

function error(code, message, statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
function exact(raw, fields) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !fields.includes(key))) {
    throw error('SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN', 'Не передавайте роли или область заведения в запросе.');
  }
  return raw;
}
export function createSpaceverseSignedIdentityVerifier({ telegramBotToken = '', vkAppId = '', vkAppSecret = '' } = {}) {
  return async function verifyIdentity(raw) {
    const credentials = exact(raw, ['platform', 'initData', 'launchParams']);
    if (credentials.platform === 'telegram') {
      if (credentials.launchParams !== undefined) throw error('SPACEVERSE_AUTH_INVALID', 'Платформа входа не совпадает.');
      const user = validateTelegramInitData(credentials.initData, { botToken: telegramBotToken });
      return { provider: 'telegram', providerUserId: String(user.id), firstName: user.firstName,
        lastName: user.lastName, username: user.username, photoUrl: user.photoUrl };
    }
    if (credentials.platform === 'vk') {
      if (credentials.initData !== undefined) throw error('SPACEVERSE_AUTH_INVALID', 'Платформа входа не совпадает.');
      const user = validateVkLaunchParams(credentials.launchParams, { appId: vkAppId, appSecret: vkAppSecret });
      // A VK signature identifies the account, not an untrusted browser profile/role.
      return { provider: 'vk', providerUserId: String(user.userId), firstName: 'Гость',
        lastName: null, username: null, photoUrl: null };
    }
    throw error('SPACEVERSE_AUTH_INVALID', 'Откройте приложение через Telegram или VK.');
  };
}
async function readJson(req) {
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 20_000) throw error('SPACEVERSE_AUTH_BODY_TOO_LARGE', 'Запрос входа слишком большой.', 413);
    return req.body;
  }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw error('SPACEVERSE_AUTH_INVALID', 'Ожидается JSON-запрос.', 415);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000) throw error('SPACEVERSE_AUTH_BODY_TOO_LARGE', 'Запрос входа слишком большой.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error('SPACEVERSE_AUTH_INVALID', 'Некорректный JSON-запрос.'); }
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

/** Shared Express/public-gateway adapter; tenant requests never reach legacy APIs.
 * It is mounted only after runtime preflight, which still refuses not_provisioned.
 */
export function createSpaceverseCustomerHttp({ runtime, pool, sessionSecret, verifyIdentity, ...providerConfig } = {}) {
  const auth = createSpaceverseCustomerAuth({ runtime, connect: () => pool.connect(),
    query: (sql, params) => pool.query(sql, params), sessionSecret,
    verifyIdentity: verifyIdentity || createSpaceverseSignedIdentityVerifier(providerConfig) });
  const attempts = new Map();
  return async function handleSpaceverseCustomerHttp(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (url.search) throw error('SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN', 'Область заведения определяется сервером.');
      if (req.headers['x-tenant-id'] || req.headers['x-company-id'] || req.headers['x-venue-id'] || req.headers['x-runtime-key']) {
        throw error('SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN', 'Область заведения определяется сервером.');
      }
      if (req.method === 'POST' && url.pathname === '/api/auth') {
        const address = req.socket?.remoteAddress || 'unknown';
        const current = attempts.get(address);
        const now = Date.now();
        if (current && current.until > now && current.count >= 30) throw error('SPACEVERSE_AUTH_RATE_LIMIT', 'Слишком много попыток входа. Подождите минуту.', 429);
        // Bound memory and use the socket, not a spoofable forwarded header.
        if (attempts.size >= 1000) for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        if (!current && attempts.size >= 1000) throw error('SPACEVERSE_AUTH_RATE_LIMIT', 'Слишком много попыток входа. Подождите минуту.', 429);
        if (!current || current.until <= now) attempts.set(address, { count: 1, until: now + 60_000 });
        else current.count += 1;
        const body = exact(await readJson(req), ['requestKey', 'platform', 'initData', 'launchParams']);
        const credentials = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'requestKey'));
        send(res, 200, await auth.authenticate({ requestKey: body.requestKey, credentials }));
      } else if (req.method === 'GET' && ['/api/me', '/api/bootstrap', '/api/wallet/balance', '/api/wallet/config', '/api/wallet/apple', '/api/wallet/google'].includes(url.pathname)) {
        const authorization = String(req.headers.authorization || '');
        if (!authorization.startsWith('Bearer ')) throw error('SPACEVERSE_AUTH_SESSION_INVALID', 'Требуется вход.', 401);
        const profile = await auth.authorize(authorization.slice(7));
        if (url.pathname === '/api/wallet/config') send(res, 200, { appleAvailable: false, googleAvailable: false,
          fallbackAvailable: false, status: 'not_configured', reason: 'Выпуск карт ещё не подключён для этого заведения.' });
        else if (['/api/wallet/apple', '/api/wallet/google'].includes(url.pathname)) {
          throw error('SPACEVERSE_WALLET_ISSUER_NOT_CONFIGURED', 'Выпуск карты для этого заведения ещё не подключён.', 503);
        } else send(res, 200, url.pathname === '/api/wallet/balance'
          ? { wallet: profile.wallet, status: 'active', hasData: true }
          : { profile, runtimeStatus: 'not_provisioned' });
      } else throw error('SPACEVERSE_RUNTIME_ROUTE_NOT_PROVISIONED', 'Этот модуль заведения ещё не подключён.', 503);
    } catch (err) {
      const status = Number(err.statusCode || 503);
      send(res, status, { code: err.code || 'SPACEVERSE_AUTH_UNAVAILABLE',
        error: err.statusCode ? err.message : 'Не удалось проверить вход или кошелёк. Повторите запрос.' });
    }
    return true;
  };
}
