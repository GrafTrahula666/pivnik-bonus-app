import crypto from 'node:crypto';

export const DEFAULT_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;
export const DEFAULT_AUTH_CLOCK_SKEW_SECONDS = 5 * 60;
export const LINK_CODE_PATTERN = /^PIV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{7,127}$/;
export const ROLE_RANK = Object.freeze({ client: 0, viewer: 1, staff: 2, admin: 3 });

export class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireSingleParam(params, key, message) {
  const values = params.getAll(key);
  if (values.length !== 1 || !values[0]) throw new HttpError(message, 401);
  return values[0];
}

function validateSignedTimestamp(
  rawTimestamp,
  {
    nowSeconds,
    maxAgeSeconds,
    clockSkewSeconds,
    message
  }
) {
  const timestamp = Number(rawTimestamp);
  const now = Number(nowSeconds);
  const maxAge = Math.max(0, Number(maxAgeSeconds) || 0);
  const clockSkew = Math.max(0, Number(clockSkewSeconds) || 0);
  const ageSeconds = now - timestamp;

  if (
    !Number.isSafeInteger(timestamp)
    || timestamp <= 0
    || !Number.isFinite(now)
    || ageSeconds > maxAge
    || ageSeconds < -clockSkew
  ) {
    throw new HttpError(message, 401);
  }

  return timestamp;
}

export function validateVkLaunchParams(
  rawLaunchParams,
  {
    appId,
    appSecret,
    nowSeconds = Math.floor(Date.now() / 1000),
    maxAgeSeconds = DEFAULT_AUTH_MAX_AGE_SECONDS,
    clockSkewSeconds = DEFAULT_AUTH_CLOCK_SKEW_SECONDS
  }
) {
  if (!appId || !appSecret) {
    throw new HttpError('VK_APP_ID или VK_APP_SECRET не настроены.', 503);
  }

  const raw = String(rawLaunchParams || '').replace(/^\?/, '');
  if (!raw || raw.length > 16_384) {
    throw new HttpError('VK не передал корректные параметры запуска.', 401);
  }

  const params = new URLSearchParams(raw);
  const receivedSign = requireSingleParam(params, 'sign', 'VK не передал подпись запуска.');
  const receivedAppId = requireSingleParam(
    params,
    'vk_app_id',
    'VK не передал идентификатор приложения.'
  );
  const userId = requireSingleParam(
    params,
    'vk_user_id',
    'VK не передал идентификатор пользователя.'
  );
  const rawTimestamp = requireSingleParam(
    params,
    'vk_ts',
    'VK не передал время запуска приложения.'
  );

  const signedPairs = [...params.entries()]
    .filter(([key]) => key.startsWith('vk_'))
    .sort(([left], [right]) => left.localeCompare(right));
  const signedQuery = new URLSearchParams(signedPairs).toString();
  const calculatedSign = crypto
    .createHmac('sha256', appSecret)
    .update(signedQuery)
    .digest('base64url');
  if (!timingSafeTextEqual(receivedSign, calculatedSign)) {
    throw new HttpError('Подпись запуска VK недействительна.', 401);
  }
  if (receivedAppId !== String(appId)) {
    throw new HttpError('Приложение VK не совпадает с настройками сервера.', 401);
  }
  if (!/^\d+$/.test(userId)) {
    throw new HttpError('VK передал некорректный идентификатор пользователя.', 401);
  }

  validateSignedTimestamp(rawTimestamp, {
    nowSeconds,
    maxAgeSeconds,
    clockSkewSeconds,
    message: 'Ссылка запуска VK устарела. Откройте приложение повторно.'
  });

  return {
    userId,
    languageCode: String(params.get('vk_language') || 'ru'),
    platform: String(params.get('vk_platform') || 'vk')
  };
}

export function validateTelegramInitData(
  initData,
  {
    botToken,
    nowSeconds = Math.floor(Date.now() / 1000),
    maxAgeSeconds = DEFAULT_AUTH_MAX_AGE_SECONDS,
    clockSkewSeconds = DEFAULT_AUTH_CLOCK_SKEW_SECONDS
  }
) {
  if (!botToken) throw new HttpError('TELEGRAM_BOT_TOKEN не настроен.', 503);
  const raw = String(initData || '');
  if (!raw || raw.length > 16_384) {
    throw new HttpError('Telegram не передал данные входа.', 401);
  }

  const params = new URLSearchParams(raw);
  const receivedHash = requireSingleParam(params, 'hash', 'Telegram не передал подпись.');
  if (!/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new HttpError('Подпись Telegram недействительна.', 401);
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  if (!timingSafeTextEqual(receivedHash.toLowerCase(), calculatedHash)) {
    throw new HttpError('Подпись Telegram недействительна.', 401);
  }

  validateSignedTimestamp(params.get('auth_date') || 0, {
    nowSeconds,
    maxAgeSeconds,
    clockSkewSeconds,
    message: 'Ссылка запуска Telegram устарела. Откройте приложение повторно.'
  });

  let user;
  try {
    user = JSON.parse(requireSingleParam(params, 'user', 'Telegram не передал профиль.'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('Telegram передал повреждённый профиль.', 401);
  }
  const id = String(user?.id || '').trim();
  if (!/^\d+$/.test(id)) throw new HttpError('Некорректный Telegram ID.', 401);

  return {
    id,
    username: user.username || null,
    firstName: user.first_name || 'Гость',
    lastName: user.last_name || null,
    photoUrl: user.photo_url || null,
    languageCode: user.language_code || 'ru'
  };
}

function sessionKey(secret) {
  if (Buffer.isBuffer(secret)) return secret;
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionKey(secret))
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(token, secret, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', sessionKey(secret))
    .update(body)
    .digest('base64url');
  if (!timingSafeTextEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isFinite(Number(payload.exp)) || Number(nowMs) >= Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function normalizeLinkCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = compact.startsWith('PIV') ? compact.slice(3) : compact;
  return body.slice(0, 8);
}

export function formatLinkCode(value) {
  const body = normalizeLinkCode(value);
  return `PIV-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export function hashLinkCode(value, secret) {
  return crypto
    .createHmac('sha256', sessionKey(secret))
    .update(`account-link:${normalizeLinkCode(value)}`)
    .digest('hex');
}

export function validateLinkConsumption(link, currentProvider, nowMs = Date.now()) {
  if (!link) throw new HttpError('Код привязки не найден.', 404);
  if (link.used_at) throw new HttpError('Этот код уже использован.', 409);
  if (new Date(link.expires_at).getTime() <= Number(nowMs)) {
    throw new HttpError('Срок действия кода истёк. Создайте новый.', 410);
  }
  if (link.source_provider === currentProvider) {
    throw new HttpError('Код нужно ввести на другой платформе: Telegram ↔ VK.', 409);
  }
  return link;
}

export function normalizeRequestKey(value) {
  const key = String(value || '').trim();
  return REQUEST_KEY_PATTERN.test(key) ? key : '';
}

export function normalizePersonalQr(value, prefix = 'PIVNIK:', depth = 0) {
  if (depth > 4) return null;
  let original = value && typeof value === 'object'
    ? String(value.payload || value.code || value.qr || value.qrToken || value.shortCode || '')
    : String(value || '');
  original = original.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!original) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const decoded = decodeURIComponent(original);
      if (decoded === original) break;
      original = decoded.trim();
    } catch {
      break;
    }
  }
  original = original.replace(/^["']|["']$/g, '').trim();

  try {
    const parsed = JSON.parse(original);
    if (parsed && typeof parsed === 'object') {
      return normalizePersonalQr(parsed, prefix, depth + 1);
    }
  } catch {}

  try {
    const url = new URL(original);
    const embedded = url.searchParams.get('payload')
      || url.searchParams.get('code')
      || url.searchParams.get('qr')
      || url.searchParams.get('token');
    if (embedded) return normalizePersonalQr(embedded, prefix, depth + 1);
    const tail = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
    if (tail) original = tail;
  } catch {}

  const prefixPosition = original.toUpperCase().indexOf(prefix.toUpperCase());
  if (prefixPosition >= 0) {
    const token = original.slice(prefixPosition + prefix.length).trim();
    return /^[A-Za-z0-9_-]{8,128}$/.test(token)
      ? { type: 'token', value: token }
      : null;
  }

  const compact = original.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^PVK[A-Z0-9]{8}$/.test(compact)) {
    return {
      type: 'short',
      value: `PVK-${compact.slice(3, 7)}-${compact.slice(7, 11)}`
    };
  }
  if (/^[A-Za-z0-9_-]{8,128}$/.test(original)) {
    return { type: 'token', value: original };
  }
  return null;
}

export function ledgerBalance(transactions) {
  return (Array.isArray(transactions) ? transactions : []).reduce((total, transaction) => {
    if (transaction?.status !== 'completed') return total;
    return total
      + Math.max(0, Math.trunc(Number(transaction.bonus_earned || 0)))
      - Math.max(0, Math.trunc(Number(transaction.bonus_spent || 0)));
  }, 0);
}

export function planMergedLedger({
  sourceWallet,
  targetWallet,
  sourceLedger,
  targetLedger,
  duplicateRewardAmount
}) {
  const walletTotal = Math.max(0, Math.trunc(Number(sourceWallet || 0)))
    + Math.max(0, Math.trunc(Number(targetWallet || 0)));
  const ledgerTotal = Math.trunc(Number(sourceLedger || 0))
    + Math.trunc(Number(targetLedger || 0));
  const duplicate = Math.max(0, Math.trunc(Number(duplicateRewardAmount || 0)));
  const duplicateBonusRemoved = Math.min(Math.max(0, ledgerTotal), duplicate);
  const duplicateBonusUnrecovered = Math.max(0, duplicate - duplicateBonusRemoved);
  return {
    walletTotal,
    ledgerTotal,
    walletDifference: walletTotal - ledgerTotal,
    duplicateBonusRemoved,
    duplicateBonusUnrecovered,
    finalBalance: Math.max(0, ledgerTotal - duplicateBonusRemoved)
  };
}

export function chooseCanonicalUser(first, second, activityByUser = new Map()) {
  const score = (row) => {
    const activity = activityByUser.get(String(row.id)) || {};
    return {
      protectedAccount: Boolean(row.role === 'admin' || row.unlimited_bonus),
      realOperations: Number(activity.real_operations || 0),
      realSpend: Number(activity.real_spend || 0),
      createdAt: new Date(row.created_at).getTime(),
      id: Number(row.id)
    };
  };
  const left = score(first);
  const right = score(second);
  const firstWins = left.protectedAccount !== right.protectedAccount
    ? left.protectedAccount
    : left.realOperations !== right.realOperations
      ? left.realOperations > right.realOperations
      : left.realSpend !== right.realSpend
        ? left.realSpend > right.realSpend
        : left.createdAt !== right.createdAt
          ? left.createdAt < right.createdAt
          : left.id < right.id;
  return firstWins ? { canonical: first, archived: second } : { canonical: second, archived: first };
}

export function strongestRole(left, right) {
  return (ROLE_RANK[right] || 0) > (ROLE_RANK[left] || 0) ? right : left;
}
