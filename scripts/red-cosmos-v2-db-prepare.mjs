import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
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
  connectionTimeoutMillis: 10_000
});

function qi(value) { return '"' + String(value).replaceAll('"', '""') + '"'; }

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

const client = await pool.connect();
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

  await client.query('COMMIT');
  const audit = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM users WHERE merged_into_user_id IS NULL AND deleted_at IS NULL) AS users,
    (SELECT COUNT(*)::int FROM user_frames) AS frames,
    (SELECT COUNT(*)::int FROM user_achievements_v2 WHERE is_granted) AS achievements,
    (SELECT COUNT(*)::int FROM transactions WHERE status='completed') AS transactions`);
  console.log(JSON.stringify({ redCosmosDbPrepared: true, backupSchema: isProduction ? BACKUP_SCHEMA : null, ...audit.rows[0] }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
