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

export function compareReadiness(telegram, vk) {
  const failures = [];
  for (const [name, value] of [['Telegram', telegram], ['VK', vk]]) {
    if (!value?.ok) failures.push(`${name}: readiness endpoint is not ready`);
    if (!value?.databaseFingerprint) failures.push(`${name}: database fingerprint is missing`);
    if (!value?.unifiedAccounts && value?.unifiedAccounts !== undefined) {
      failures.push(`${name}: unified accounts are disabled`);
    }
    if (value?.environment !== 'production') failures.push(`${name}: NODE_ENV is not production`);
    if (!value?.legalConfigured) failures.push(`${name}: legal configuration is incomplete`);
    if (!value?.identityTombstoneSecretConfigured) {
      failures.push(`${name}: IDENTITY_TOMBSTONE_SECRET is not configured`);
    }
  }

  if (
    telegram?.databaseFingerprint
    && vk?.databaseFingerprint
    && telegram.databaseFingerprint !== vk.databaseFingerprint
  ) {
    failures.push('VK and Telegram use different databases');
  }

  if (
    telegram?.releaseCommit
    && vk?.releaseCommit
    && telegram.releaseCommit !== 'unknown'
    && vk.releaseCommit !== 'unknown'
    && telegram.releaseCommit !== vk.releaseCommit
  ) {
    failures.push('VK and Telegram run different release commits');
  }

  if (telegram?.termsVersion !== vk?.termsVersion) {
    failures.push('VK and Telegram expose different terms versions');
  }

  return {
    ok: failures.length === 0,
    failures,
    databaseFingerprint: telegram?.databaseFingerprint || vk?.databaseFingerprint || null,
    releaseCommit: telegram?.releaseCommit || vk?.releaseCommit || 'unknown',
    termsVersion: telegram?.termsVersion || vk?.termsVersion || null
  };
}

async function fetchReadiness(baseUrl, name) {
  const response = await fetch(`${baseUrl}/api/release-readiness`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body?.ok) {
    body.httpStatus = response.status;
  }
  return body;
}

export async function verifyUnifiedProduction({ telegramUrl, vkUrl }) {
  const telegramBase = normalizeBaseUrl(telegramUrl, 'TELEGRAM_APP_URL');
  const vkBase = normalizeBaseUrl(vkUrl, 'VK_APP_URL');
  const [telegram, vk] = await Promise.all([
    fetchReadiness(telegramBase, 'Telegram'),
    fetchReadiness(vkBase, 'VK')
  ]);
  return {
    ...compareReadiness(telegram, vk),
    telegram,
    vk
  };
}

async function main() {
  const result = await verifyUnifiedProduction({
    telegramUrl: process.env.TELEGRAM_APP_URL,
    vkUrl: process.env.VK_APP_URL
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
