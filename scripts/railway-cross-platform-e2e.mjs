import crypto from 'node:crypto';
import pg from 'pg';

const { Client, types } = pg;
types.setTypeParser(20, (value) => value);

const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const RAILWAY_TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const CONFIRMATION = String(process.env.PIVNIK_CROSS_PLATFORM_E2E_CONFIRM || '').trim();
const REQUIRED_CONFIRMATION = 'E2E_ROLLBACK_ONLY_20260804';
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const SERVICES = Object.freeze({
  telegramApp: '4c4d5f11-e3af-4ffb-8ae9-21a8854b6c90',
  vkApp: '61352beb-78fe-4293-939c-c1f93294b204',
  canonicalDatabase: 'beb858e1-c412-42b8-b570-bda36ca82b59'
});

if (!RAILWAY_TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');
if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
  throw new Error(`PIVNIK_CROSS_PLATFORM_E2E_CONFIRM must equal ${REQUIRED_CONFIRMATION}.`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RAILWAY_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-cross-platform-e2e/1.0'
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

async function serviceVariables(serviceId, unrendered = false) {
  const data = await railwayGraphql(`
    query ServiceVariables($projectId: String!, $environmentId: String!, $serviceId: String!, $unrendered: Boolean!) {
      variables(
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
        unrendered: $unrendered
      )
    }
  `, {
    projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    serviceId,
    unrendered
  });
  if (!data?.variables || typeof data.variables !== 'object' || Array.isArray(data.variables)) {
    throw new Error(`Railway returned invalid variables for service ${serviceId}.`);
  }
  return data.variables;
}

function databaseClient(connectionString) {
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
    query_timeout: 120_000,
    connectionTimeoutMillis: 30_000
  });
}

function syntheticIdentity() {
  const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  const digits = String(900_000_000_000_000 + crypto.randomInt(1_000_000));
  return {
    suffix,
    telegramProviderId: digits,
    vkProviderId: String(800_000_000 + crypto.randomInt(100_000_000)),
    telegramQrToken: `E2E-TG-${crypto.randomUUID()}`,
    vkQrToken: `E2E-VK-${crypto.randomUUID()}`,
    telegramQrShort: `PVK-${suffix.slice(0, 4)}-${suffix.slice(4, 8)}`,
    vkQrShort: `PVK-${suffix.slice(2, 6)}-${suffix.slice(6, 10)}`
  };
}

async function insertSyntheticUsers(client, identity) {
  const telegram = await client.query(`
    INSERT INTO users (
      telegram_id, username, first_name, role,
      qr_token, qr_short_code, terms_accepted_at, terms_version,
      onboarding_completed_at
    ) VALUES ($1, $2, 'E2E Telegram', 'client', $3, $4, NOW(), '2026-08-04', NOW())
    RETURNING id
  `, [
    identity.telegramProviderId,
    `e2e_tg_${identity.suffix.toLowerCase()}`,
    identity.telegramQrToken,
    identity.telegramQrShort
  ]);
  const vk = await client.query(`
    INSERT INTO users (
      username, first_name, role,
      qr_token, qr_short_code, terms_accepted_at, terms_version,
      onboarding_completed_at
    ) VALUES ($1, 'E2E VK', 'client', $2, $3, NOW(), '2026-08-04', NOW())
    RETURNING id
  `, [
    `e2e_vk_${identity.suffix.toLowerCase()}`,
    identity.vkQrToken,
    identity.vkQrShort
  ]);

  const telegramUserId = telegram.rows[0].id;
  const vkUserId = vk.rows[0].id;

  await client.query(`
    INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username)
    VALUES
      ($1, 'telegram', $2, $3),
      ($4, 'vk', $5, $6)
  `, [
    telegramUserId,
    identity.telegramProviderId,
    `e2e_tg_${identity.suffix.toLowerCase()}`,
    vkUserId,
    identity.vkProviderId,
    `e2e_vk_${identity.suffix.toLowerCase()}`
  ]);

  await client.query(
    'INSERT INTO wallets (user_id, balance) VALUES ($1, 150), ($2, 130)',
    [telegramUserId, vkUserId]
  );
  await client.query(
    'INSERT INTO beer_loyalty (user_id, paid_ml_total, gift_ml_balance) VALUES ($1, 2000, 0), ($2, 3000, 500)',
    [telegramUserId, vkUserId]
  );

  await client.query(`
    INSERT INTO reward_grants (code, user_id, amount, source)
    VALUES
      ('welcome-100', $1, 100, 'consent'),
      ('welcome-100', $2, 100, 'consent')
  `, [telegramUserId, vkUserId]);
  await client.query(`
    INSERT INTO reward_grants (
      code, user_id, amount, source, achievement_code,
      achievement_period, reward_beer_ml
    ) VALUES ($1, $2, 30, 'achievement', 'e2e-cross-platform', '2026-08', 500)
  `, [`achievement:e2e-cross-platform:${identity.suffix}`, vkUserId]);

  const requestKeys = {
    telegramWelcome: crypto.randomUUID(),
    telegramPurchase: crypto.randomUUID(),
    vkWelcome: crypto.randomUUID(),
    vkAchievement: crypto.randomUUID(),
    vkAccrue: crypto.randomUUID(),
    telegramRedeem: crypto.randomUUID()
  };

  await client.query(`
    INSERT INTO transactions (
      request_key, client_id, mode, status, bonus_earned,
      balance_after, reason, reward_code, completed_at
    ) VALUES
      ($1, $2, 'welcome', 'completed', 100, 100, 'E2E welcome Telegram', 'welcome-100', NOW()),
      ($3, $2, 'accrue', 'completed', 50, 150, 'E2E purchase Telegram', NULL, NOW()),
      ($4, $5, 'welcome', 'completed', 100, 100, 'E2E welcome VK', 'welcome-100', NOW()),
      ($6, $5, 'achievement', 'completed', 30, 130, 'E2E achievement VK', $7, NOW())
  `, [
    requestKeys.telegramWelcome,
    telegramUserId,
    requestKeys.telegramPurchase,
    requestKeys.vkWelcome,
    vkUserId,
    requestKeys.vkAchievement,
    `achievement:e2e-cross-platform:${identity.suffix}`
  ]);

  return { telegramUserId, vkUserId, requestKeys };
}

async function userIdForIdentity(client, provider, providerUserId) {
  const result = await client.query(`
    SELECT user_id
    FROM user_identities
    WHERE provider = $1 AND provider_user_id = $2
  `, [provider, providerUserId]);
  if (result.rowCount !== 1) {
    throw new Error(`${provider} identity did not resolve to exactly one user.`);
  }
  return String(result.rows[0].user_id);
}

async function walletBalanceForIdentity(client, provider, providerUserId) {
  const result = await client.query(`
    SELECT w.balance
    FROM user_identities i
    JOIN wallets w ON w.user_id = i.user_id
    WHERE i.provider = $1 AND i.provider_user_id = $2
  `, [provider, providerUserId]);
  if (result.rowCount !== 1) {
    throw new Error(`${provider} identity did not resolve to exactly one wallet.`);
  }
  return Number(result.rows[0].balance);
}

async function runRollbackOnlyE2E(databaseUrl, mergeUsers) {
  const client = databaseClient(databaseUrl);
  const identity = syntheticIdentity();
  let began = false;
  let result;

  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    began = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pivnik:cross-platform-production-e2e'))");

    const { telegramUserId, vkUserId, requestKeys } = await insertSyntheticUsers(client, identity);
    const merge = await mergeUsers(client, telegramUserId, vkUserId);

    if (String(merge.canonicalUserId) !== String(telegramUserId)) {
      throw new Error('Telegram user was not retained as the canonical profile.');
    }
    if (String(merge.mergedUserId) !== String(vkUserId)) {
      throw new Error('VK user was not archived as the merged profile.');
    }
    if (Number(merge.duplicateBonusRemoved) !== 100 || Number(merge.finalBalance) !== 180) {
      throw new Error('Account merge did not remove the duplicate welcome reward correctly.');
    }

    const telegramResolved = await userIdForIdentity(
      client,
      'telegram',
      identity.telegramProviderId
    );
    const vkResolved = await userIdForIdentity(client, 'vk', identity.vkProviderId);
    if (telegramResolved !== vkResolved || telegramResolved !== String(telegramUserId)) {
      throw new Error('Telegram and VK identities do not resolve to the same canonical profile.');
    }

    const mergedWallet = await walletBalanceForIdentity(
      client,
      'vk',
      identity.vkProviderId
    );
    if (mergedWallet !== 180) throw new Error(`Merged wallet is ${mergedWallet}, expected 180.`);

    const achievement = await client.query(`
      SELECT user_id, achievement_code, reward_beer_ml
      FROM reward_grants
      WHERE code = $1
    `, [`achievement:e2e-cross-platform:${identity.suffix}`]);
    if (
      achievement.rowCount !== 1
      || String(achievement.rows[0].user_id) !== String(telegramUserId)
      || achievement.rows[0].achievement_code !== 'e2e-cross-platform'
      || Number(achievement.rows[0].reward_beer_ml) !== 500
    ) {
      throw new Error('VK achievement was not preserved on the canonical profile.');
    }

    await client.query(`
      INSERT INTO transactions (
        request_key, client_id, mode, status,
        check_amount_cents, cash_paid_cents, bonus_earned,
        balance_after, reason, completed_at
      ) VALUES ($1, $2, 'accrue', 'completed', 5000, 5000, 25, 205, 'E2E VK accrue', NOW())
    `, [requestKeys.vkAccrue, telegramUserId]);
    await client.query(
      'UPDATE wallets SET balance = balance + 25, updated_at = NOW() WHERE user_id = $1',
      [telegramUserId]
    );

    const telegramAfterVk = await walletBalanceForIdentity(
      client,
      'telegram',
      identity.telegramProviderId
    );
    if (telegramAfterVk !== 205) {
      throw new Error('VK-side accrual was not visible through the Telegram identity.');
    }

    await client.query(`
      INSERT INTO transactions (
        request_key, client_id, mode, status,
        check_amount_cents, bonus_spent, cash_paid_cents,
        balance_after, reason, completed_at
      ) VALUES ($1, $2, 'redeem', 'completed', 5000, 15, 3500, 190, 'E2E Telegram redeem', NOW())
    `, [requestKeys.telegramRedeem, telegramUserId]);
    await client.query(
      'UPDATE wallets SET balance = balance - 15, updated_at = NOW() WHERE user_id = $1',
      [telegramUserId]
    );

    const vkAfterTelegram = await walletBalanceForIdentity(client, 'vk', identity.vkProviderId);
    if (vkAfterTelegram !== 190) {
      throw new Error('Telegram-side redemption was not visible through the VK identity.');
    }

    await client.query('SAVEPOINT duplicate_request');
    let duplicateBlocked = false;
    try {
      await client.query(`
        INSERT INTO transactions (
          request_key, client_id, mode, status,
          check_amount_cents, bonus_spent, balance_after, reason, completed_at
        ) VALUES ($1, $2, 'redeem', 'completed', 5000, 15, 175, 'E2E duplicate tap', NOW())
      `, [requestKeys.telegramRedeem, telegramUserId]);
    } catch (error) {
      duplicateBlocked = error?.code === '23505';
      await client.query('ROLLBACK TO SAVEPOINT duplicate_request');
    }
    if (!duplicateBlocked) throw new Error('Duplicate transaction request key was not blocked.');

    const ledger = await client.query(`
      SELECT
        COALESCE(SUM(bonus_earned - bonus_spent), 0)::bigint AS balance,
        COUNT(*) FILTER (WHERE request_key = ANY($2::text[]))::int AS directional_operation_count
      FROM transactions
      WHERE client_id = $1 AND status = 'completed'
    `, [telegramUserId, [requestKeys.vkAccrue, requestKeys.telegramRedeem]]);
    if (Number(ledger.rows[0].balance) !== 190) {
      throw new Error('Final wallet and completed ledger balance differ.');
    }
    if (Number(ledger.rows[0].directional_operation_count) !== 2) {
      throw new Error('Bidirectional Telegram/VK operations are missing from history.');
    }

    const wallet = await client.query('SELECT balance FROM wallets WHERE user_id = $1', [telegramUserId]);
    if (wallet.rowCount !== 1 || Number(wallet.rows[0].balance) !== 190) {
      throw new Error('Final canonical wallet balance is incorrect.');
    }

    const archived = await client.query(`
      SELECT merged_into_user_id
      FROM users
      WHERE id = $1
    `, [vkUserId]);
    if (
      archived.rowCount !== 1
      || String(archived.rows[0].merged_into_user_id) !== String(telegramUserId)
    ) {
      throw new Error('Merged VK profile was not archived correctly.');
    }

    result = {
      ok: true,
      sameCanonicalProfile: true,
      mergedBalance: 180,
      balanceAfterVkAccrualSeenInTelegram: telegramAfterVk,
      balanceAfterTelegramRedemptionSeenInVk: vkAfterTelegram,
      finalLedgerBalance: 190,
      duplicateRequestBlocked: true,
      achievementPreserved: true
    };
  } finally {
    if (began) await client.query('ROLLBACK').catch(() => {});

    const cleanup = await client.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE provider = 'telegram' AND provider_user_id = $1
        )::int AS telegram_identities,
        COUNT(*) FILTER (
          WHERE provider = 'vk' AND provider_user_id = $2
        )::int AS vk_identities
      FROM user_identities
    `, [identity.telegramProviderId, identity.vkProviderId]).catch(() => ({ rows: [{}] }));

    await client.end();
    if (
      Number(cleanup.rows[0]?.telegram_identities || 0) !== 0
      || Number(cleanup.rows[0]?.vk_identities || 0) !== 0
    ) {
      throw new Error('Rollback verification failed: synthetic identities remained in production.');
    }
  }

  return { ...result, rollbackClean: true };
}

const telegramRendered = await serviceVariables(SERVICES.telegramApp, false);
const vkRendered = await serviceVariables(SERVICES.vkApp, false);
const canonicalRendered = await serviceVariables(SERVICES.canonicalDatabase, false);

const canonicalPublicUrl = String(canonicalRendered.DATABASE_PUBLIC_URL || '').trim();
const canonicalInternalUrl = String(canonicalRendered.DATABASE_URL || '').trim();
const telegramDatabaseUrl = String(telegramRendered.DATABASE_URL || '').trim();
const vkDatabaseUrl = String(vkRendered.DATABASE_URL || '').trim();
if (!canonicalPublicUrl || !canonicalInternalUrl || !telegramDatabaseUrl || !vkDatabaseUrl) {
  throw new Error('One or more Railway database URLs are missing.');
}
if (sha256(telegramDatabaseUrl) !== sha256(canonicalInternalUrl)) {
  throw new Error('Telegram is not connected to the canonical production database.');
}
if (sha256(vkDatabaseUrl) !== sha256(canonicalInternalUrl)) {
  throw new Error('VK is not connected to the canonical production database.');
}

for (const [key, value] of Object.entries(telegramRendered)) {
  if (typeof value === 'string' && value) process.env[key] = value;
}
process.env.DATABASE_URL = canonicalPublicUrl;
process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.ALLOW_DEMO = 'false';

const { mergeUsers } = await import(
  new URL(`../universal-server.js?cross-platform-e2e=${Date.now()}`, import.meta.url).href
);
if (typeof mergeUsers !== 'function') throw new Error('mergeUsers export is unavailable.');

const databaseIdentity = databaseClient(canonicalPublicUrl);
await databaseIdentity.connect();
const identityResult = await databaseIdentity.query(
  'SELECT database_instance_id FROM runtime_identity WHERE singleton = TRUE LIMIT 1'
);
await databaseIdentity.end();
const databaseInstanceId = String(identityResult.rows[0]?.database_instance_id || '');
if (!databaseInstanceId) throw new Error('runtime_identity is missing.');

const e2e = await runRollbackOnlyE2E(canonicalPublicUrl, mergeUsers);
console.log(JSON.stringify({
  ...e2e,
  databaseFingerprint: sha256(databaseInstanceId).slice(0, 20),
  productionDataPersisted: false
}, null, 2));
