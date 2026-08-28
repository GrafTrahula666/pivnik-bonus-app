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
const TESTER_HANDLES = Object.freeze(['drolted', 'distraktor', 'ksemar']);
const FRAME_GRANTS = Object.freeze({
  'beer-mugs': 'profile-frame-beer-mugs',
  'beer-bottles': 'profile-frame-beer-bottles',
  lights: 'profile-frame-lights',
  'middle-finger': 'profile-frame-middle-finger',
  'premium-smiling-fuck': 'profile-frame-premium-smiling-fuck',
  diamond: 'profile-frame-diamond'
});
const SHOP_FRAME_IMAGES = Object.freeze({
  'frame-beer-mugs': '/assets/shop/frame-beer-mugs.svg',
  'frame-beer-bottles': '/assets/shop/frame-beer-bottles.svg',
  'frame-lights': '/assets/shop/frame-lights.svg',
  'frame-premium-smiling-fuck': '/assets/shop/frame-premium-smiling-fuck.svg'
});

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

async function tableExists(client, schema, table) {
  const result = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema=$1 AND table_name=$2
     ) AS ok`,
    [schema, table]
  );
  return Boolean(result.rows[0]?.ok);
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

async function syncPermanentFrameOwnership(client) {
  let restored = 0;
  for (const [frameId, grantCode] of Object.entries(FRAME_GRANTS)) {
    const result = await client.query(
      `INSERT INTO beta_grants(code,user_id,amount)
       SELECT $1,uf.user_id,0
       FROM user_frames uf
       JOIN users u ON u.id=uf.user_id
       WHERE uf.frame_id=$2
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
       ON CONFLICT(code,user_id) DO NOTHING`,
      [grantCode, frameId]
    );
    restored += result.rowCount;
  }
  return restored;
}

async function restoreOwnerMoneyFrames(client) {
  if (!ownerTelegramId && !ownerVkId) return [];
  const ownerRows = await client.query(
    `SELECT DISTINCT u.id
     FROM users u
     LEFT JOIN user_identities ui ON ui.user_id=u.id
     WHERE u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
       AND (
         ($1::text<>'' AND (CAST(COALESCE(u.telegram_id,0) AS text)=$1 OR (ui.provider='telegram' AND ui.provider_user_id=$1)))
         OR
         ($2::text<>'' AND ui.provider='vk' AND ui.provider_user_id=$2)
       )
     ORDER BY u.id`,
    [ownerTelegramId, ownerVkId]
  );
  const restored = [];
  for (const row of ownerRows.rows) {
    await client.query(
      `INSERT INTO user_frames(user_id,frame_id,acquired_source,restored_from_legacy)
       VALUES($1::bigint,'money','owner-identity-restore',TRUE)
       ON CONFLICT(user_id,frame_id) DO NOTHING`,
      [row.id]
    );
    const selected = await client.query(
      `UPDATE users
       SET profile_frame='money',updated_at=NOW()
       WHERE id=$1::bigint
         AND COALESCE(NULLIF(profile_frame,''),'none')='none'
       RETURNING id`,
      [row.id]
    );
    restored.push({ userId: String(row.id), selected: Boolean(selected.rowCount) });
  }
  return restored;
}

async function repairShopFrameImages(client) {
  const results = [];
  for (const [code, imageSrc] of Object.entries(SHOP_FRAME_IMAGES)) {
    const result = await client.query(
      `UPDATE shop_items
       SET image_src=$2,active=TRUE,is_hidden=FALSE,is_purchasable=TRUE,updated_at=NOW()
       WHERE code=$1
       RETURNING code`,
      [code, imageSrc]
    );
    if (result.rowCount) results.push(code);
  }
  return results;
}

async function reconcileExistingTesterRecipients(client) {
  const identities = await client.query(`
    SELECT DISTINCT ui.user_id,ui.provider,ui.provider_user_id,
           COALESCE(NULLIF(ui.provider_username,''),NULLIF(u.username,'')) AS provider_username
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
    if (claim?.claimed) {
      claims.push({
        handle: claim.recipient_handle,
        userId: String(identity.user_id),
        awardedBonus: Number(claim.awarded_bonus || 0)
      });
    }
  }
  return claims;
}

async function safeCount(client, schema, table, where = '') {
  if (!(await tableExists(client, schema, table))) return null;
  const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${qi(schema)}.${qi(table)} ${where}`);
  return Number(result.rows[0]?.count || 0);
}

async function safeNumber(client, schema, table, expression) {
  if (!(await tableExists(client, schema, table))) return null;
  const result = await client.query(`SELECT COALESCE(${expression},0)::text AS value FROM ${qi(schema)}.${qi(table)}`);
  const number = Number(result.rows[0]?.value || 0);
  return Number.isFinite(number) ? number : null;
}

async function schemaTesterMatches(client, schema) {
  const matches = new Set();
  if (await tableExists(client, schema, 'users')) {
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='users'`,
      [schema]
    );
    if (columns.rows.some((row) => row.column_name === 'username')) {
      const result = await client.query(
        `SELECT LOWER(REGEXP_REPLACE(COALESCE(username,''),'^@+','')) AS handle
         FROM ${qi(schema)}.users
         WHERE LOWER(REGEXP_REPLACE(COALESCE(username,''),'^@+','')) = ANY($1::text[])`,
        [TESTER_HANDLES]
      );
      result.rows.forEach((row) => matches.add(row.handle));
    }
  }
  if (await tableExists(client, schema, 'user_identities')) {
    const result = await client.query(
      `SELECT LOWER(REGEXP_REPLACE(COALESCE(provider_username,''),'^@+','')) AS handle
       FROM ${qi(schema)}.user_identities
       WHERE LOWER(REGEXP_REPLACE(COALESCE(provider_username,''),'^@+','')) = ANY($1::text[])`,
      [TESTER_HANDLES]
    );
    result.rows.forEach((row) => matches.add(row.handle));
  }
  return [...matches].sort();
}

async function inspectHistoricalSchemas(client) {
  const schemaRows = await client.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
      AND schema_name NOT LIKE 'pg_temp_%'
      AND schema_name NOT LIKE 'pg_toast_temp_%'
    ORDER BY schema_name
  `);
  const summaries = [];
  for (const { schema_name: schema } of schemaRows.rows) {
    const users = await safeCount(client, schema, 'users');
    const transactions = await safeCount(client, schema, 'transactions');
    const completedTransactions = await safeCount(client, schema, 'transactions', "WHERE status='completed'");
    const wallets = await safeCount(client, schema, 'wallets');
    const walletBalance = await safeNumber(client, schema, 'wallets', 'SUM(balance)');
    const beerRows = await safeCount(client, schema, 'beer_loyalty');
    const paidBeerMl = await safeNumber(client, schema, 'beer_loyalty', 'SUM(paid_ml_total)');
    const rewardGrants = await safeCount(client, schema, 'reward_grants');
    const betaGrants = await safeCount(client, schema, 'beta_grants');
    const identities = await safeCount(client, schema, 'user_identities');
    const testerHandles = await schemaTesterMatches(client, schema);
    if ([users, transactions, wallets, beerRows, rewardGrants, betaGrants, identities].some((value) => value !== null)) {
      summaries.push({
        schema,
        users,
        wallets,
        walletBalance,
        transactions,
        completedTransactions,
        beerRows,
        paidBeerMl,
        rewardGrants,
        betaGrants,
        identities,
        testerHandles
      });
    }
  }
  const publicSummary = summaries.find((item) => item.schema === 'public') || null;
  const richerSchemas = publicSummary
    ? summaries.filter((item) => item.schema !== 'public' && (
      Number(item.users || 0) > Number(publicSummary.users || 0)
      || Number(item.transactions || 0) > Number(publicSummary.transactions || 0)
      || Number(item.paidBeerMl || 0) > Number(publicSummary.paidBeerMl || 0)
    )).map((item) => item.schema)
    : [];
  return { summaries, richerSchemas };
}

const client = await connectWithRetry();
try {
  await client.query('BEGIN');
  await createBackup(client);
  const migration = await fs.readFile(path.join(root, 'migrations', '007_red_cosmos_v2.sql'), 'utf8');
  await client.query(migration);

  // Preserve all v22 frame entitlements in the permanent v2 ownership table.
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

  // The permanent collection is the durable source of truth. Re-create legacy
  // entitlement markers if an older runtime lost them, without charging again.
  const frameEntitlementsRestored = await syncPermanentFrameOwnership(client);
  const ownerFramesRestored = await restoreOwnerMoneyFrames(client);
  const shopFrameImagesRepaired = await repairShopFrameImages(client);

  // Existing immutable achievement grants seed the v2 state without changing rewards.
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

  const testerClaims = await reconcileExistingTesterRecipients(client);

  await client.query('COMMIT');
  const audit = await client.query(`SELECT
    (SELECT COUNT(*)::int FROM users WHERE merged_into_user_id IS NULL AND deleted_at IS NULL) AS users,
    (SELECT COUNT(*)::int FROM user_frames) AS frames,
    (SELECT COUNT(*)::int FROM user_achievements_v2 WHERE is_granted) AS achievements,
    (SELECT COUNT(*)::int FROM transactions WHERE status='completed') AS transactions,
    (SELECT COUNT(*)::int FROM pending_special_achievement_recipients WHERE granted_user_id IS NOT NULL) AS tester_recipients_granted,
    (SELECT COUNT(*)::int FROM pending_special_achievement_recipients WHERE granted_user_id IS NULL) AS tester_recipients_pending`);
  const historicalAudit = await inspectHistoricalSchemas(client);
  console.log(JSON.stringify({
    redCosmosDbPrepared: true,
    backupSchema: isProduction ? BACKUP_SCHEMA : null,
    frameEntitlementsRestored,
    ownerFramesRestored,
    shopFrameImagesRepaired,
    testerClaims,
    historicalAudit,
    ...audit.rows[0]
  }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
