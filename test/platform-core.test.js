import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  chooseCanonicalUser,
  formatLinkCode,
  hashLinkCode,
  ledgerBalance,
  normalizeLinkCode,
  normalizePersonalQr,
  normalizeRequestKey,
  planMergedLedger,
  signSession,
  strongestRole,
  validateTelegramInitData,
  validateLinkConsumption,
  validateVkLaunchParams,
  verifySession
} from '../platform-core.js';

const NOW_SECONDS = 1_800_000_000;

function vkLaunchParams({
  appId = '54694987',
  appSecret = 'vk-test-secret',
  userId = '123456',
  timestamp = NOW_SECONDS
} = {}) {
  const params = new URLSearchParams({
    vk_app_id: appId,
    vk_user_id: userId,
    vk_ts: String(timestamp),
    vk_language: 'ru',
    vk_platform: 'mobile_web'
  });
  const signedQuery = new URLSearchParams(
    [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
  ).toString();
  params.set(
    'sign',
    crypto.createHmac('sha256', appSecret).update(signedQuery).digest('base64url')
  );
  return params.toString();
}

function telegramInitData({
  botToken = '123456:test-token',
  userId = 778899,
  authDate = NOW_SECONDS
} = {}) {
  const params = new URLSearchParams({
    query_id: 'AAE-test-query',
    auth_date: String(authDate),
    user: JSON.stringify({
      id: userId,
      first_name: 'Тест',
      last_name: 'Пользователь',
      username: 'pivnik_test',
      language_code: 'ru'
    })
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set(
    'hash',
    crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
  );
  return params.toString();
}

test('VK: корректная подпись возвращает подписанный user_id', () => {
  const result = validateVkLaunchParams(vkLaunchParams(), {
    appId: '54694987',
    appSecret: 'vk-test-secret',
    nowSeconds: NOW_SECONDS
  });
  assert.equal(result.userId, '123456');
  assert.equal(result.platform, 'mobile_web');
});

test('VK: подмена user_id после подписи отклоняется', () => {
  const params = new URLSearchParams(vkLaunchParams());
  params.set('vk_user_id', '999999');
  assert.throws(
    () => validateVkLaunchParams(params.toString(), {
      appId: '54694987',
      appSecret: 'vk-test-secret',
      nowSeconds: NOW_SECONDS
    }),
    /Подпись запуска VK недействительна/
  );
});

test('VK: неверный App ID отклоняется даже при валидной подписи', () => {
  assert.throws(
    () => validateVkLaunchParams(vkLaunchParams({ appId: '1' }), {
      appId: '54694987',
      appSecret: 'vk-test-secret',
      nowSeconds: NOW_SECONDS
    }),
    /Приложение VK не совпадает/
  );
});

test('VK: просроченные launch params отклоняются', () => {
  assert.throws(
    () => validateVkLaunchParams(vkLaunchParams({ timestamp: NOW_SECONDS - 86_401 }), {
      appId: '54694987',
      appSecret: 'vk-test-secret',
      nowSeconds: NOW_SECONDS,
      maxAgeSeconds: 86_400
    }),
    /устарела/
  );
});

test('VK: дублированный критический параметр отклоняется', () => {
  const raw = `${vkLaunchParams()}&vk_user_id=123456`;
  assert.throws(
    () => validateVkLaunchParams(raw, {
      appId: '54694987',
      appSecret: 'vk-test-secret',
      nowSeconds: NOW_SECONDS
    }),
    /идентификатор пользователя/
  );
});

test('Telegram: корректный initData проходит HMAC-проверку', () => {
  const result = validateTelegramInitData(telegramInitData(), {
    botToken: '123456:test-token',
    nowSeconds: NOW_SECONDS
  });
  assert.equal(result.id, '778899');
  assert.equal(result.username, 'pivnik_test');
});

test('Telegram: подмена профиля отклоняется', () => {
  const params = new URLSearchParams(telegramInitData());
  params.set('user', JSON.stringify({ id: 1, first_name: 'Подмена' }));
  assert.throws(
    () => validateTelegramInitData(params.toString(), {
      botToken: '123456:test-token',
      nowSeconds: NOW_SECONDS
    }),
    /Подпись Telegram недействительна/
  );
});

test('Telegram: просроченный initData отклоняется', () => {
  assert.throws(
    () => validateTelegramInitData(
      telegramInitData({ authDate: NOW_SECONDS - 86_401 }),
      {
        botToken: '123456:test-token',
        nowSeconds: NOW_SECONDS,
        maxAgeSeconds: 86_400
      }
    ),
    /устарела/
  );
});

test('Сессия: подпись, срок жизни и защита от подмены', () => {
  const secret = 'session-secret-for-tests';
  const token = signSession(
    { uid: '42', platform: 'vk', pid: '123456', sv: 7, exp: 50_000 },
    secret
  );
  assert.deepEqual(verifySession(token, secret, 49_999), {
    uid: '42',
    platform: 'vk',
    pid: '123456',
    sv: 7,
    exp: 50_000
  });
  assert.equal(verifySession(token, secret, 50_000), null);
  assert.equal(verifySession(`${token.slice(0, -1)}x`, secret, 49_999), null);
  assert.equal(verifySession(token, 'other-secret', 49_999), null);
});

test('Код привязки: форматирование стабильно, хранение зависит от секрета', () => {
  assert.equal(normalizeLinkCode(' piv-abcd-2345 '), 'ABCD2345');
  assert.equal(formatLinkCode('ABCD2345'), 'PIV-ABCD-2345');
  assert.equal(
    hashLinkCode('PIV-ABCD-2345', 'secret'),
    hashLinkCode('abcd2345', 'secret')
  );
  assert.notEqual(
    hashLinkCode('PIV-ABCD-2345', 'secret'),
    hashLinkCode('PIV-ABCD-2345', 'other-secret')
  );
});

test('Код привязки: просроченный, повторный и код той же платформы отклоняются', () => {
  const valid = {
    source_provider: 'telegram',
    expires_at: new Date(20_000).toISOString(),
    used_at: null
  };
  assert.equal(validateLinkConsumption(valid, 'vk', 10_000), valid);
  assert.throws(
    () => validateLinkConsumption({ ...valid, expires_at: new Date(9_999).toISOString() }, 'vk', 10_000),
    (error) => error.statusCode === 410
  );
  assert.throws(
    () => validateLinkConsumption({ ...valid, used_at: new Date().toISOString() }, 'vk', 10_000),
    (error) => error.statusCode === 409
  );
  assert.throws(
    () => validateLinkConsumption(valid, 'telegram', 10_000),
    /другой платформе/
  );
  assert.throws(
    () => validateLinkConsumption(null, 'vk', 10_000),
    (error) => error.statusCode === 404
  );
});

test('requestKey: принимает UUID и отклоняет короткие/опасные значения', () => {
  assert.equal(
    normalizeRequestKey('550e8400-e29b-41d4-a716-446655440000'),
    '550e8400-e29b-41d4-a716-446655440000'
  );
  assert.equal(normalizeRequestKey('short'), '');
  assert.equal(normalizeRequestKey('bad key with spaces'), '');
});

test('QR: регистр постоянного токена сохраняется, короткий код нормализуется', () => {
  assert.deepEqual(
    normalizePersonalQr(' PIVNIK:AbC_def-123 '),
    { type: 'token', value: 'AbC_def-123' }
  );
  assert.deepEqual(
    normalizePersonalQr('pvk-ab12-cd34'),
    { type: 'short', value: 'PVK-AB12-CD34' }
  );
});

test('Журнал: отменённые операции не влияют на баланс', () => {
  assert.equal(ledgerBalance([
    { status: 'completed', bonus_earned: 100, bonus_spent: 0 },
    { status: 'completed', bonus_earned: 20, bonus_spent: 35 },
    { status: 'cancelled', bonus_earned: 999, bonus_spent: 0 }
  ]), 85);
});

test('Объединение: баланс берётся из журнала, а не из суммы wallet', () => {
  assert.deepEqual(planMergedLedger({
    sourceWallet: 9_000,
    targetWallet: 8_000,
    sourceLedger: 300,
    targetLedger: 450,
    duplicateRewardAmount: 250
  }), {
    walletTotal: 17_000,
    ledgerTotal: 750,
    walletDifference: 16_250,
    duplicateBonusRemoved: 250,
    duplicateBonusUnrecovered: 0,
    finalBalance: 500
  });
});

test('Объединение: уже потраченная часть дубля не создаёт отрицательный баланс', () => {
  assert.deepEqual(planMergedLedger({
    sourceWallet: 20,
    targetWallet: 30,
    sourceLedger: 20,
    targetLedger: 30,
    duplicateRewardAmount: 100
  }), {
    walletTotal: 50,
    ledgerTotal: 50,
    walletDifference: 0,
    duplicateBonusRemoved: 50,
    duplicateBonusUnrecovered: 50,
    finalBalance: 0
  });
});

test('Канонический профиль: защищённая роль важнее активности', () => {
  const admin = {
    id: '10',
    role: 'admin',
    unlimited_bonus: true,
    created_at: '2026-01-02T00:00:00Z'
  };
  const client = {
    id: '11',
    role: 'client',
    unlimited_bonus: false,
    created_at: '2026-01-01T00:00:00Z'
  };
  const activity = new Map([
    ['10', { real_operations: 0, real_spend: 0 }],
    ['11', { real_operations: 100, real_spend: 1_000_000 }]
  ]);
  assert.equal(chooseCanonicalUser(admin, client, activity).canonical.id, '10');
});

test('Канонический профиль: постоянный маркер создателя не архивируется', () => {
  const creator = {
    id: '12',
    role: 'client',
    unlimited_bonus: false,
    is_creator: true,
    created_at: '2026-01-02T00:00:00Z'
  };
  const activeClient = {
    id: '13',
    role: 'client',
    unlimited_bonus: false,
    is_creator: false,
    created_at: '2026-01-01T00:00:00Z'
  };
  const activity = new Map([
    ['12', { real_operations: 0, real_spend: 0 }],
    ['13', { real_operations: 100, real_spend: 1_000_000 }]
  ]);
  assert.equal(chooseCanonicalUser(creator, activeClient, activity).canonical.id, '12');
});

test('Канонический профиль: при равных правах сохраняется реальная активность', () => {
  const first = {
    id: '20',
    role: 'client',
    unlimited_bonus: false,
    created_at: '2026-01-01T00:00:00Z'
  };
  const second = {
    id: '21',
    role: 'staff',
    unlimited_bonus: false,
    created_at: '2025-01-01T00:00:00Z'
  };
  const activity = new Map([
    ['20', { real_operations: 4, real_spend: 5_000 }],
    ['21', { real_operations: 1, real_spend: 10_000 }]
  ]);
  assert.equal(chooseCanonicalUser(first, second, activity).canonical.id, '20');
  assert.equal(strongestRole(first.role, second.role), 'staff');
});
