import pg from 'pg';

const { Client } = pg;
const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const CONFIRMATION = String(process.env.PIVNIK_ANNA_CONSENT_REPAIR_CONFIRM || '').trim();
const REQUIRED_CONFIRMATION = 'REPAIR_ANNA_FRAME_AND_CONSENT_20260806';
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const TELEGRAM_APP_SERVICE_ID = '4c4d5f11-e3af-4ffb-8ae9-21a8854b6c90';
const CANONICAL_DATABASE_SERVICE_ID = 'beb858e1-c412-42b8-b570-bda36ca82b59';
const TERMS_VERSION = '2026-08-04';
const MIGRATION_CODE = '2026-08-06-anna-frame-consent-persistence-v1';

if (!TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');
if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
  throw new Error(`PIVNIK_ANNA_CONSENT_REPAIR_CONFIRM must equal ${REQUIRED_CONFIRMATION}.`);
}

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-anna-consent-repair/1.0'
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
  const data = await graphql(`
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

function normalizedUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

async function canonicalUserId(client, userId) {
  const result = await client.query(`
    WITH RECURSIVE chain AS (
      SELECT id, merged_into_user_id, 0 AS depth
        FROM users
       WHERE id = $1::bigint
      UNION ALL
      SELECT u.id, u.merged_into_user_id, chain.depth + 1
        FROM users u
        JOIN chain ON u.id = chain.merged_into_user_id
       WHERE chain.depth < 20
    )
    SELECT id
      FROM chain
     ORDER BY depth DESC
     LIMIT 1
  `, [userId]);
  if (!result.rowCount) throw new Error('Anna candidate disappeared during repair.');
  return String(result.rows[0].id);
}

async function findAnnaCandidate(client, { annaTelegramId, annaTelegramUsername }) {
  const result = await client.query(`
    SELECT u.id,
           u.profile_frame,
           u.role,
           u.first_name,
           u.username,
           u.telegram_id,
           EXISTS (
             SELECT 1 FROM beta_grants bg
              WHERE bg.user_id = u.id
                AND bg.code = 'anna-senior-beta-million'
           ) AS has_anna_grant,
           EXISTS (
             SELECT 1 FROM transactions t
              WHERE t.client_id = u.id
                AND t.reward_code = 'anna-senior-beta-million'
           ) AS has_anna_transaction
      FROM users u
     WHERE u.deleted_at IS NULL
       AND (
         u.profile_frame = 'anna'
         OR EXISTS (
           SELECT 1 FROM beta_grants bg
            WHERE bg.user_id = u.id
              AND bg.code = 'anna-senior-beta-million'
         )
         OR EXISTS (
           SELECT 1 FROM transactions t
            WHERE t.client_id = u.id
              AND t.reward_code = 'anna-senior-beta-million'
         )
         OR ($1::text <> '' AND u.telegram_id::text = $1::text)
         OR ($2::text <> '' AND lower(COALESCE(u.username, '')) = $2::text)
         OR (
           u.role IN ('staff', 'admin')
           AND lower(COALESCE(u.first_name, '')) IN ('анна', 'аня', 'anna', 'anya')
         )
       )
  `, [annaTelegramId, annaTelegramUsername]);

  const grouped = new Map();
  for (const row of result.rows) {
    const canonicalId = await canonicalUserId(client, row.id);
    const exactId = Boolean(annaTelegramId && String(row.telegram_id || '') === annaTelegramId);
    const exactUsername = Boolean(
      annaTelegramUsername
      && normalizedUsername(row.username) === annaTelegramUsername
    );
    const score = row.has_anna_grant || row.has_anna_transaction
      ? 100
      : row.profile_frame === 'anna'
        ? 90
        : exactId
          ? 80
          : exactUsername
            ? 70
            : 10;
    const current = grouped.get(canonicalId);
    if (!current || score > current.score) {
      grouped.set(canonicalId, {
        canonicalId,
        score,
        source: score >= 100
          ? 'historical-anna-reward'
          : score === 90
            ? 'stored-anna-frame'
            : score === 80
              ? 'configured-telegram-id'
              : score === 70
                ? 'configured-username'
                : 'unique-staff-name'
      });
    }
  }

  const candidates = [...grouped.values()].sort((a, b) => b.score - a.score);
  if (!candidates.length) throw new Error('Anna profile was not found safely.');
  const best = candidates[0];
  if (candidates[1]?.score === best.score) {
    throw new Error('Anna profile is ambiguous; no production data was changed.');
  }
  if (best.score === 10 && candidates.length !== 1) {
    throw new Error('Name-only Anna lookup is not unique; no production data was changed.');
  }
  return best;
}

const [appVariables, databaseVariables] = await Promise.all([
  serviceVariables(TELEGRAM_APP_SERVICE_ID, false),
  serviceVariables(CANONICAL_DATABASE_SERVICE_ID, false)
]);
const databaseUrl = String(databaseVariables.DATABASE_PUBLIC_URL || '').trim();
if (!databaseUrl) throw new Error('Canonical DATABASE_PUBLIC_URL is missing.');

const annaTelegramId = String(appVariables.ANNA_TELEGRAM_ID || '').trim();
const annaTelegramUsername = normalizedUsername(appVariables.ANNA_TELEGRAM_USERNAME);
const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  statement_timeout: 120_000,
  query_timeout: 120_000
});

await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('pivnik-anna-consent-repair-20260806'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS ops_data_migrations (
      code text PRIMARY KEY,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const previous = await client.query(
    'SELECT details, applied_at FROM ops_data_migrations WHERE code = $1',
    [MIGRATION_CODE]
  );

  const anna = await findAnnaCandidate(client, { annaTelegramId, annaTelegramUsername });
  const frameUpdate = await client.query(`
    UPDATE users
       SET profile_frame = 'anna',
           updated_at = NOW()
     WHERE id = $1::bigint
       AND profile_frame IS DISTINCT FROM 'anna'
    RETURNING id
  `, [anna.canonicalId]);

  // Preserve an explicit acceptance already made on a profile that was later
  // merged into the canonical Telegram/VK account. This never creates consent:
  // it only copies the current accepted version from an archived linked row.
  const consentRepair = await client.query(`
    WITH accepted AS (
      SELECT merged_into_user_id AS canonical_id,
             MAX(terms_accepted_at) AS accepted_at
        FROM users
       WHERE merged_into_user_id IS NOT NULL
         AND terms_accepted_at IS NOT NULL
         AND terms_version = $1
       GROUP BY merged_into_user_id
    )
    UPDATE users canonical
       SET terms_accepted_at = accepted.accepted_at,
           terms_version = $1,
           updated_at = NOW()
      FROM accepted
     WHERE canonical.id = accepted.canonical_id
       AND (
         canonical.terms_accepted_at IS NULL
         OR canonical.terms_version IS DISTINCT FROM $1
       )
    RETURNING canonical.id
  `, [TERMS_VERSION]);

  const verification = await client.query(`
    SELECT profile_frame
      FROM users
     WHERE id = $1::bigint
       AND merged_into_user_id IS NULL
       AND deleted_at IS NULL
  `, [anna.canonicalId]);
  if (verification.rows[0]?.profile_frame !== 'anna') {
    throw new Error('Anna frame verification failed.');
  }

  const details = {
    annaMatchSource: anna.source,
    frameChanged: frameUpdate.rowCount === 1,
    linkedConsentRowsReconciled: consentRepair.rowCount,
    termsVersion: TERMS_VERSION,
    idempotentReplay: previous.rowCount === 1
  };
  await client.query(`
    INSERT INTO ops_data_migrations (code, details, applied_at)
    VALUES ($1, $2::jsonb, NOW())
    ON CONFLICT (code) DO UPDATE
      SET details = EXCLUDED.details,
          applied_at = EXCLUDED.applied_at
  `, [MIGRATION_CODE, JSON.stringify(details)]);
  await client.query('COMMIT');

  console.log(JSON.stringify({ ok: true, ...details }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
