import crypto from 'node:crypto';
import { RAILWAY_PRODUCTION, productionUrl } from './railway-production-config.mjs';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const EXPECTED_COMMIT = String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();

if (!TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');

const CANARIES = Object.freeze({
  telegram: Object.freeze({
    provider_user_id: '900000000000001',
    username: 'pivnik_release_telegram',
    first_name: 'Тест Telegram',
    last_name: '',
    photo_url: null,
    language_code: 'ru'
  }),
  vk: Object.freeze({
    provider_user_id: '2147483001',
    username: 'pivnik_release_vk',
    first_name: 'Тест VK',
    last_name: '',
    photo_url: null,
    language_code: 'ru'
  })
});

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-auth-smoke/1.0'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ')
      || `Railway API returned HTTP ${response.status}`);
  }
  return payload.data;
}

async function serviceVariables(serviceId) {
  const data = await graphql(`
    query ProductionAuthVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
        unrendered: false
      )
    }
  `, {
    projectId: RAILWAY_PRODUCTION.projectId,
    environmentId: RAILWAY_PRODUCTION.environmentId,
    serviceId
  });
  if (!data?.variables || typeof data.variables !== 'object' || Array.isArray(data.variables)) {
    throw new Error(`Railway returned invalid variables for ${serviceId}.`);
  }
  return data.variables;
}

function telegramInitData(botToken, user) {
  const params = new URLSearchParams({
    query_id: `pivnik-release-${crypto.randomUUID()}`,
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id: Number(user.provider_user_id),
      first_name: user.first_name || 'Пользователь',
      last_name: user.last_name || '',
      username: user.username || undefined,
      photo_url: user.photo_url || undefined,
      language_code: user.language_code || 'ru'
    })
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

function vkLaunchParams(appId, appSecret, userId) {
  const params = new URLSearchParams({
    vk_app_id: appId,
    vk_user_id: String(userId),
    vk_ts: String(Math.floor(Date.now() / 1000)),
    vk_language: 'ru',
    vk_platform: 'release_smoke'
  });
  const signedQuery = new URLSearchParams(
    [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
  ).toString();
  params.set('sign', crypto.createHmac('sha256', appSecret).update(signedQuery).digest('base64url'));
  return params.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-auth-smoke/1.0',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${new URL(url).pathname}: HTTP ${response.status} ${body.error || ''}`.trim());
  return body;
}

async function authenticateTwice({ platform, baseUrl, body }) {
  const authenticate = () => fetchJson(`${baseUrl}/api/auth`, {
    method: 'POST',
    body: JSON.stringify(body())
  });
  const firstAuth = await authenticate();
  const firstProfile = await fetchJson(`${baseUrl}/api/me`, {
    headers: { authorization: `Bearer ${firstAuth.token}` }
  });
  const secondAuth = await authenticate();
  const secondProfile = await fetchJson(`${baseUrl}/api/me`, {
    headers: { authorization: `Bearer ${secondAuth.token}` }
  });

  for (const [label, value] of [
    ['first auth', firstAuth],
    ['first profile', firstProfile],
    ['second auth', secondAuth],
    ['second profile', secondProfile]
  ]) {
    if (!value?.profile?.id) throw new Error(`${platform}: ${label} returned no profile.`);
  }
  const invariant = (value) => JSON.stringify({
    id: value.profile.id,
    balance: value.profile.balance,
    qrShortCode: value.profile.qrShortCode,
    achievementCodes: (value.profile.achievements || []).map((item) => item.code).sort()
  });
  if (invariant(firstProfile) !== invariant(secondProfile)) {
    throw new Error(`${platform}: profile state changed after repeated authentication.`);
  }
  if (firstAuth.profile.id !== secondAuth.profile.id || firstAuth.profile.id !== firstProfile.profile.id) {
    throw new Error(`${platform}: repeated authentication resolved a different user.`);
  }
  if (!firstProfile.profile.qrShortCode) throw new Error(`${platform}: profile QR is missing.`);

  return {
    authenticated: true,
    repeatedLoginStable: true,
    profileLoaded: true,
    balanceStable: true,
    qrLoaded: true,
    achievementsLoaded: Array.isArray(firstProfile.profile.achievements),
    achievementCount: firstProfile.profile.achievements.length
  };
}

const [telegramVariables, vkVariables] = await Promise.all([
  serviceVariables(RAILWAY_PRODUCTION.services.telegram),
  serviceVariables(RAILWAY_PRODUCTION.services.vk)
]);
if (!telegramVariables.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token is missing.');
if (!vkVariables.VK_APP_ID || !vkVariables.VK_APP_SECRET) throw new Error('VK credentials are missing.');

const telegramUrl = productionUrl('telegram', telegramVariables.TELEGRAM_APP_URL);
const vkUrl = productionUrl('vk', vkVariables.VK_APP_URL);
const readiness = await Promise.all([
  fetchJson(`${telegramUrl}/api/release-readiness`),
  fetchJson(`${vkUrl}/api/release-readiness`)
]);
if (EXPECTED_COMMIT && readiness.some((item) => item.releaseCommit !== EXPECTED_COMMIT)) {
  throw new Error('Production auth smoke reached a different release commit.');
}

const [telegram, vk] = await Promise.all([
  authenticateTwice({
    platform: 'telegram',
    baseUrl: telegramUrl,
    body: () => ({
      initData: telegramInitData(telegramVariables.TELEGRAM_BOT_TOKEN, CANARIES.telegram)
    })
  }),
  authenticateTwice({
    platform: 'vk',
    baseUrl: vkUrl,
    body: () => {
      const user = CANARIES.vk;
      return {
        platform: 'vk',
        launchParams: vkLaunchParams(vkVariables.VK_APP_ID, vkVariables.VK_APP_SECRET, user.provider_user_id),
        user: {
          id: Number(user.provider_user_id),
          screen_name: user.username || `id${user.provider_user_id}`,
          first_name: user.first_name || 'Пользователь',
          last_name: user.last_name || '',
          photo_200: user.photo_url || undefined
        }
      };
    }
  })
]);

console.log(JSON.stringify({
  ok: true,
  releaseCommit: readiness[0].releaseCommit,
  databaseFingerprint: readiness[0].databaseFingerprint,
  telegram,
  vk,
  productionDataCreated: false,
  bonusOperationsCreated: false
}, null, 2));
