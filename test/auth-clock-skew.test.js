import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  validateTelegramInitData,
  validateVkLaunchParams
} from '../platform-core.js';

const NOW_SECONDS = 1_800_000_000;
const CLOCK_SKEW_SECONDS = 300;

function vkLaunchParams(timestamp) {
  const appSecret = 'vk-test-secret';
  const params = new URLSearchParams({
    vk_app_id: '54694987',
    vk_user_id: '123456',
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

function telegramInitData(authDate) {
  const botToken = '123456:test-token';
  const params = new URLSearchParams({
    query_id: 'AAE-test-query',
    auth_date: String(authDate),
    user: JSON.stringify({
      id: 778899,
      first_name: 'Тест',
      username: 'pivnik_test'
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

test('VK: небольшое расхождение часов допускается', () => {
  const result = validateVkLaunchParams(vkLaunchParams(NOW_SECONDS + CLOCK_SKEW_SECONDS), {
    appId: '54694987',
    appSecret: 'vk-test-secret',
    nowSeconds: NOW_SECONDS,
    clockSkewSeconds: CLOCK_SKEW_SECONDS
  });
  assert.equal(result.userId, '123456');
});

test('VK: launch params из далёкого будущего отклоняются', () => {
  assert.throws(
    () => validateVkLaunchParams(vkLaunchParams(NOW_SECONDS + CLOCK_SKEW_SECONDS + 1), {
      appId: '54694987',
      appSecret: 'vk-test-secret',
      nowSeconds: NOW_SECONDS,
      clockSkewSeconds: CLOCK_SKEW_SECONDS
    }),
    /устарела/
  );
});

test('Telegram: небольшое расхождение часов допускается', () => {
  const result = validateTelegramInitData(telegramInitData(NOW_SECONDS + CLOCK_SKEW_SECONDS), {
    botToken: '123456:test-token',
    nowSeconds: NOW_SECONDS,
    clockSkewSeconds: CLOCK_SKEW_SECONDS
  });
  assert.equal(result.id, '778899');
});

test('Telegram: initData из далёкого будущего отклоняется', () => {
  assert.throws(
    () => validateTelegramInitData(
      telegramInitData(NOW_SECONDS + CLOCK_SKEW_SECONDS + 1),
      {
        botToken: '123456:test-token',
        nowSeconds: NOW_SECONDS,
        clockSkewSeconds: CLOCK_SKEW_SECONDS
      }
    ),
    /устарела/
  );
});
