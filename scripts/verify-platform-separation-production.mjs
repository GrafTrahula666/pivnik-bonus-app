import { pathToFileURL } from 'node:url';

function normalizeBaseUrl(value, name) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error(`${name} is required.`);
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`${name} must use HTTPS.`);
  }
  return url.toString().replace(/\/$/, '');
}

export function comparePlatformSeparation(telegram, vk, expectedCommit = '') {
  const failures = [];

  for (const [name, service] of [['Telegram', telegram], ['VK', vk]]) {
    const readiness = service?.readiness || {};
    const platformHealth = service?.platformHealth || {};

    if (!readiness.ok) failures.push(`${name}: readiness endpoint is not ready`);
    if (!platformHealth.ok) failures.push(`${name}: platform-health endpoint is not ready`);
    if (readiness.environment !== 'production') failures.push(`${name}: NODE_ENV is not production`);
    if (!readiness.databaseFingerprint) failures.push(`${name}: database fingerprint is missing`);
    if (!readiness.legalConfigured) failures.push(`${name}: legal configuration is incomplete`);
    if (!readiness.identityTombstoneSecretConfigured) {
      failures.push(`${name}: IDENTITY_TOMBSTONE_SECRET is not configured`);
    }

    for (const [endpoint, value] of [['readiness', readiness], ['platform-health', platformHealth]]) {
      if (value.accountMode !== 'separate') {
        failures.push(`${name}: ${endpoint} accountMode is not separate`);
      }
      if (value.unifiedAccounts !== false) {
        failures.push(`${name}: ${endpoint} still reports unified accounts`);
      }
      if (value.linkCodes !== false) {
        failures.push(`${name}: ${endpoint} still exposes account link codes`);
      }
    }

    if (expectedCommit && readiness.releaseCommit !== expectedCommit) {
      failures.push(`${name}: release commit is ${readiness.releaseCommit || 'missing'}`);
    }
  }

  const telegramReadiness = telegram?.readiness || {};
  const vkReadiness = vk?.readiness || {};
  if (
    telegramReadiness.databaseFingerprint
    && vkReadiness.databaseFingerprint
    && telegramReadiness.databaseFingerprint !== vkReadiness.databaseFingerprint
  ) {
    failures.push('VK and Telegram use different databases');
  }
  if (
    telegramReadiness.releaseCommit
    && vkReadiness.releaseCommit
    && telegramReadiness.releaseCommit !== 'unknown'
    && vkReadiness.releaseCommit !== 'unknown'
    && telegramReadiness.releaseCommit !== vkReadiness.releaseCommit
  ) {
    failures.push('VK and Telegram run different release commits');
  }
  if (telegramReadiness.termsVersion !== vkReadiness.termsVersion) {
    failures.push('VK and Telegram expose different terms versions');
  }

  return {
    ok: failures.length === 0,
    failures,
    accountMode: 'separate',
    databaseFingerprint: telegramReadiness.databaseFingerprint || vkReadiness.databaseFingerprint || null,
    releaseCommit: telegramReadiness.releaseCommit || vkReadiness.releaseCommit || 'unknown',
    termsVersion: telegramReadiness.termsVersion || vkReadiness.termsVersion || null
  };
}

async function fetchJson(baseUrl, pathname, name) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { accept: 'application/json', 'user-agent': 'pivnik-platform-separation-verifier/1.0' },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body?.ok) body.httpStatus = response.status;
  if (!response.ok) body.fetchError = `${name}: HTTP ${response.status}`;
  return body;
}

async function fetchService(baseUrl, name) {
  const [readiness, platformHealth] = await Promise.all([
    fetchJson(baseUrl, '/api/release-readiness', `${name} readiness`),
    fetchJson(baseUrl, '/api/platform-health', `${name} platform-health`)
  ]);
  return { readiness, platformHealth };
}

export async function verifyPlatformSeparationProduction({ telegramUrl, vkUrl, expectedCommit = '' }) {
  const telegramBase = normalizeBaseUrl(telegramUrl, 'TELEGRAM_APP_URL');
  const vkBase = normalizeBaseUrl(vkUrl, 'VK_APP_URL');
  const [telegram, vk] = await Promise.all([
    fetchService(telegramBase, 'Telegram'),
    fetchService(vkBase, 'VK')
  ]);
  return {
    ...comparePlatformSeparation(telegram, vk, expectedCommit),
    telegram,
    vk
  };
}

async function main() {
  const result = await verifyPlatformSeparationProduction({
    telegramUrl: process.env.TELEGRAM_APP_URL,
    vkUrl: process.env.VK_APP_URL,
    expectedCommit: String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim()
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const isDirectRun = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
