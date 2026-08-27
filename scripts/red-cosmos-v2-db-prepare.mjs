import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const ownerTelegramId = String(process.env.OWNER_TELEGRAM_ID || '').trim();
const ownerVkId = String(process.env.OWNER_VK_ID || '').trim();
const BACKUP_SCHEMA = 'pivnik_red_cosmos_v2_preupgrade_20260827';

if (!databaseUrl) {
  if (isProduction) throw new Error('RED COSMOS DB prepare: DATABASE_URL is required in production');
  console.log('RED COSMOS DB prepare skipped outside production: DATABASE_URL absent.');
  process.exit(0);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 8_000
});

function qi(value) { return '"' + String(value).replaceAll('"', '""') + '"'; }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry() {
  const waits = [0, 1_000, 2_000, 4_000, 6_000, 8_000];
  let lastError;
  for (let attempt = 0; attempt < waits.length; attempt += 1) {
    if (waits[attempt]) await sleep(waits[attempt]);
    try {
      const client = await pool.connect();
      if (attempt > 0) console.log(`RED COSMOS DB connection recovered on attempt ${attempt + 1}.`);
      return client;
    } catch (error) {
      lastError = error;
      console.warn(`RED COSMOS DB connection attempt ${attempt + 1}/${waits.length} failed: ${error?.code || error?.message || 'unknown'}`);
    }
  }
  throw lastError || new Error('RED COSMOS DB connection failed');
}

async function createBackup(client) {
  if (!isProduction) return;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('red-cosmos-v2-preupgrade-20260827'))");
  const exists = await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [BACKUP_SCHEMA]);
  if (!exists.rowCount) {
    const schema = qi(BACKUP_SCHEMA);
    await client.query(`CREATE SCHEMA ${schema}`);
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    if (!tables.rowCount) throw new Error('RED COSMOS DB backup: no public tables');
    for (const { tablename } of tables.rows) {
      await client.query(`CREATE TABLE ${schema}.${qi(tablename)} AS TABLE public.${qi(tablename)} WITH DATA`);
    }
    await client.query(`CREATE TABLE ${schema}._metadata AS SELECT NOW() AS backed_up_at,$1::text AS release,$2::integer AS copied_table_count`, [String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'unknown'), tables.rowCount]);
  }
  const check = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS users_ok,to_regclass($2) IS NOT NULL AS wallets_ok,to_regclass($3) IS NOT NULL AS tx_ok,to_regclass($4) IS NOT NULL AS meta_ok`,
    [`${BACKUP_SCHEMA}.users`, `${BACKUP_SCHEMA}.wallets`, `${BACKUP_SCHEMA}.transactions`, `${BACKUP_SCHEMA}._metadata`]
  );
  const row = check.rows[0] || {};
  if (!row.users_ok || !row.wallets_ok || !row.tx_ok || !row.meta_ok) throw new Error('RED COSMOS DB backup verification failed');
}

async function reconcileExistingTesterRecipients(client) {
  const identities = await client.query(`
    SELECT DISTINCT ui.user_id,ui.provider,ui.provider_user_id,ui.provider_username
    FROM user_identities ui
    JOIN users u ON u.id=ui.user_id
    WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
      AND ui.provider IN ('telegram','vk')
    ORDER BY ui.user_id,ui.provider
  `);
  const claims = [];
  for (const identity of identities.rows) {
    const result = await client.query(
      'SELECT * FROM pivnik_claim_pending_special_achievement($1::bigint,$2::text,$3::text,$4::text)',
      [identity.user_id, identity.provider, identity.provider_user_id, identity.provider_username || null]
    );
    const claim = result.rows[0];
    if (claim?.claimed) claims.push({ handle: claim.recipient_handle, userId: String(identity.user_id), awardedBonus: Number(claim.awarded_bonus || 0) });
  }
  return claims;
}

async function ensureOwnerCreator(client) {
  const result = await client.query(`
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN user_identities ui ON ui.user_id=u.id
    WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
      AND (
        ($1::text <> '' AND u.telegram_id::text=$1::text)
        OR ($2::text <> '' AND ui.provider='vk' AND ui.provider_user_id=$2::text)
      )
    ORDER BY u.id
  `, [ownerTelegramId, ownerVkId]);

  for (const row of result.rows) {
    await client.query(
      `INSERT INTO reward_grants(code,user_id,amount,source,achievement_code,achievement_period)
       VALUES ('achievement:creator',$1::bigint,0,'achievement','creator',NULL)
       ON CONFLICT (code,user_id) DO NOTHING`,
      [row.id]
    );
    await client.query(
      `INSERT INTO user_achievements_v2(
         user_id,achievement_code,is_granted,granted_at,current_progress,required_progress,
         last_progress_check_at,first_unlock_notification_sent_at
       ) VALUES ($1::bigint,'creator',TRUE,NOW(),1,1,NOW(),NOW())
       ON CONFLICT(user_id,achievement_code) DO UPDATE SET
         is_granted=TRUE,
         granted_at=COALESCE(user_achievements_v2.granted_at,EXCLUDED.granted_at),
         current_progress=1,
         required_progress=1,
         last_progress_check_at=NOW()`,
      [row.id]
    );
    await client.query(
      `UPDATE users SET unlimited_bonus=TRUE, profile_frame='money', updated_at=NOW()
       WHERE id=$1::bigint`,
      [row.id]
    );
  }
  return result.rows.map((row) => String(row.id));
}

// Temporary read-only diagnostic: only four current VK identities exist. This is
// logged to determine which exact provider id belongs to the owner, then OWNER_VK_ID
// can be configured without granting privileges to any unrelated account.
async function ownerVkCandidates(client) {
  if (ownerVkId) return [];
  const result = await client.query(`
    SELECT u.id AS user_id,u.first_name,u.last_name,u.role,u.unlimited_bonus,
           ui.provider_user_id,ui.provider_username
    FROM user_identities ui
    JOIN users u ON u.id=ui.user_id
    WHERE ui.provider='vk' AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
    ORDER BY u.updated_at DESC,u.id DESC
    LIMIT 10
  `);
  return result.rows.map((row) => ({
    userId: String(row.user_id),
    providerUserId: String(row.provider_user_id),
    providerUsername: row.provider_username || null,
    name: [row.first_name,row.last_name].filter(Boolean).join(' '),
    role: row.role,
    unlimitedBonus: Boolean(row.unlimited_bonus)
  }));
}

const client = await connectWithRetry();
try {
  await client.query('BEGIN');
  await createBackup(client);
  const migration = await fs.readFile(path.join(root, 'migrations', '007_red_cosmos_v2.sql'), 'utf8');
  await client.query(migration);

  await client.query(`
    INSERT INTO user_frames(user_id,frame_id,acquired_source,acquired_at,restored_from_legacy)
    SELECT bg.user_id,
      CASE bg.code
        WHEN 'profile-frame-beer-mugs' THEN 'beer-mugs'
        WHEN 'profile-frame-beer-bottles' THEN 'beer-bottles'
        WHEN 'profile-frame-lights' THEN 'lights'
        WHEN 'profile-frame-middle-finger' THEN 'middle-finger'
        WHEN 'profile-frame-premium-smiling-fuck' THEN 'premium-smiling-fuck'
        ELSE NULL
      END,
      'legacy-beta-grant',bg.created_at,TRUE
    FROM beta_grants bg
    WHERE bg.code IN ('profile-frame-beer-mugs','profile-frame-beer-bottles','profile-frame-lights','profile-frame-middle-finger','profile-frame-premium-smiling-fuck')
    ON CONFLICT(user_id,frame_id) DO NOTHING
  `);

  await client.query(`
    INSERT INTO user_achievements_v2(user_id,achievement_code,is_granted,granted_at,current_progress,required_progress,last_progress_check_at,first_unlock_notification_sent_at)
    SELECT rg.user_id,rg.achievement_code,TRUE,MIN(rg.created_at),1,1,NOW(),MIN(rg.created_at)
    FROM reward_grants rg
    WHERE rg.source='achievement' AND COALESCE(rg.achievement_code,'')<>''
    GROUP BY rg.user_id,rg.achievement_code
    ON CONFLICT(user_id,achievement_code) DO UPDATE SET
      is_granted=TRUE,
      granted_at=COALESCE(user_achievements_v2.granted_at,EXCLUDED.granted_at),
      current_progress=GREATEST(user_achievements_v2.current_progress,1),
      required_progress=GREATEST(user_achievements_v2.required_progress,1),
      last_progress_check_at=NOW()
  `);

  const ownerCreatorUserIds = await ensureOwnerCreator(client);
  const testerClaims = await reconcileExistingTesterRecipients(client);
  const vkCandidates = await ownerVkCandidates(client);

  await client.query('COMMIT');
  const audit = await client.query(`SELECT
    (SELECT COUNT(*)::int FROM user_frames) AS frames,
    (SELECT COUNT(*)::int FROM user_achievements_v2 WHERE is_granted) AS achievements,
    (SELECT COUNT(*)::int FROM pending_special_achievement_recipients WHERE granted_user_id IS NOT NULL) AS tester_recipients_granted,
    (SELECT COUNT(*)::int FROM pending_special_achievement_recipients WHERE granted_user_id IS NULL) AS tester_recipients_pending`);
  console.log(JSON.stringify({
    redCosmosDbPrepared: true,
    backupSchema: isProduction ? BACKUP_SCHEMA : null,
    ownerCreatorUserIds,
    ownerVkConfigured: Boolean(ownerVkId),
    ownerVkCandidates: vkCandidates,
    testerClaims,
    ...audit.rows[0]
  }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
