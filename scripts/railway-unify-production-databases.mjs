import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client, types } = pg;
types.setTypeParser(20, (value) => value);

const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const RAILWAY_TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const CONFIRMATION = String(process.env.PIVNIK_UNIFY_CONFIRM || '').trim();
const REQUIRED_CONFIRMATION = 'UNIFY_PIVNIK_20260804';
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const SERVICES = Object.freeze({
  telegramApp: '4c4d5f11-e3af-4ffb-8ae9-21a8854b6c90',
  vkApp: '61352beb-78fe-4293-939c-c1f93294b204',
  canonicalDatabase: 'beb858e1-c412-42b8-b570-bda36ca82b59',
  legacyVkDatabase: 'de5da1be-76c1-4976-a88c-efcce93600e6'
});
const BACKUP_DATABASE_NAME = 'pivnik_backup_20260804_pre_unification';
const MIGRATION_CODE = '2026-08-04-vk-legacy-to-canonical-v1';
const COMMON_VARIABLES = Object.freeze([
  'DATABASE_URL',
  'SESSION_SECRET',
  'IDENTITY_TOMBSTONE_SECRET'
]);
const SOURCE_TABLES = Object.freeze([
  'users',
  'user_identities',
  'wallets',
  'beer_loyalty',
  'bars',
  'bar_customers',
  'beta_grants',
  'reward_grants',
  'shifts',
  'shift_members',
  'transactions',
  'account_link_attempts',
  'account_link_codes',
  'qr_aliases',
  'qr_sessions',
  'shop_items',
  'shop_inquiries',
  'promotions',
  'account_merge_audit',
  'cancel_quota_resets',
  'account_deletion_audit'
]);

if (!RAILWAY_TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');
if (CONFIRMATION !== REQUIRED_CONFIRMATION) {
  throw new Error(`PIVNIK_UNIFY_CONFIRM must equal ${REQUIRED_CONFIRMATION}.`);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function databaseUrlFor(sourceUrl, databaseName) {
  const url = new URL(sourceUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function safeDatabaseFingerprint(connectionString) {
  const url = new URL(connectionString);
  return sha256(`${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`).slice(0, 16);
}

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RAILWAY_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-unifier/1.0'
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

async function upsertServiceVariables(serviceId, variables) {
  const data = await railwayGraphql(`
    mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `, {
    input: {
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      serviceId,
      variables,
      skipDeploys: true
    }
  });
  if (data?.variableCollectionUpsert !== true) {
    throw new Error('Railway did not confirm variableCollectionUpsert.');
  }
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

async function withClient(connectionString, callback) {
  const client = databaseClient(connectionString);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function verifyBackup(sourceConnectionString, expectedSourceDatabase) {
  const backupConnectionString = databaseUrlFor(sourceConnectionString, BACKUP_DATABASE_NAME);
  return withClient(backupConnectionString, async (client) => {
    const result = await client.query(`
      SELECT source_database, release_commit, created_at,
             pg_database_size(current_database())::text AS size_bytes,
             (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'public') AS table_count
        FROM public.pivnik_backup_metadata
       WHERE singleton = true
    `);
    if (result.rowCount !== 1) throw new Error('Backup metadata is missing.');
    const row = result.rows[0];
    if (row.source_database !== expectedSourceDatabase) {
      throw new Error('Backup source database does not match the live database.');
    }
    if (Number(row.size_bytes) <= 0 || Number(row.table_count) < 1) {
      throw new Error('Backup verification returned invalid size or table count.');
    }
    return {
      database: BACKUP_DATABASE_NAME,
      sizeBytes: Number(row.size_bytes),
      tableCount: Number(row.table_count),
      releaseCommit: String(row.release_commit || 'unknown'),
      createdAt: new Date(row.created_at).toISOString()
    };
  });
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.exists);
}

async function readTable(client, tableName) {
  if (!await tableExists(client, tableName)) return [];
  const result = await client.query(`SELECT * FROM public.${quoteIdent(tableName)}`);
  return result.rows;
}

async function targetColumns(client, tableName) {
  const result = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position
  `, [tableName]);
  return new Set(result.rows.map((row) => row.column_name));
}

async function insertRow(client, tableName, row, {
  exclude = [],
  transform = {},
  returning = null,
  onConflict = ''
} = {}) {
  const columns = await targetColumns(client, tableName);
  const excluded = new Set(exclude);
  const names = Object.keys(row)
    .filter((name) => columns.has(name) && !excluded.has(name) && row[name] !== undefined);
  if (!names.length) throw new Error(`${tableName}: no compatible columns to insert.`);
  const values = names.map((name) => Object.hasOwn(transform, name) ? transform[name] : row[name]);
  const placeholders = names.map((_, index) => `$${index + 1}`);
  const returningClause = returning ? ` RETURNING ${quoteIdent(returning)}` : '';
  const conflictClause = onConflict ? ` ${onConflict}` : '';
  const result = await client.query(
    `INSERT INTO public.${quoteIdent(tableName)} (${names.map(quoteIdent).join(', ')}) VALUES (${placeholders.join(', ')})${conflictClause}${returningClause}`,
    values
  );
  return returning ? result.rows[0]?.[returning] : null;
}

function mappedId(map, value, fieldName) {
  if (value === null || value === undefined) return null;
  const result = map.get(String(value));
  if (result === undefined) throw new Error(`Missing mapped ID for ${fieldName}.`);
  return result;
}

async function ensureCanonicalSchema(client) {
  await client.query(`
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS adult_confirmed_at timestamptz,
      ADD COLUMN IF NOT EXISTS is_creator boolean NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS public.account_deletion_audit (
      deletion_id uuid PRIMARY KEY,
      requested_from text NOT NULL,
      linked_identity_count smallint NOT NULL DEFAULT 0,
      deleted_user_rows integer NOT NULL DEFAULT 0,
      deleted_transaction_rows integer NOT NULL DEFAULT 0,
      deleted_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.api_rate_limits (
      subject_hash text NOT NULL,
      route_group text NOT NULL,
      window_started_at timestamptz NOT NULL DEFAULT now(),
      request_count integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (subject_hash, route_group)
    );

    CREATE TABLE IF NOT EXISTS public.ops_data_migrations (
      code text PRIMARY KEY,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function freezeLegacyDatabase(connectionString) {
  return withClient(connectionString, async (client) => {
    const databaseResult = await client.query('SELECT current_database() AS name');
    const databaseName = databaseResult.rows[0].name;
    await client.query(`ALTER DATABASE ${quoteIdent(databaseName)} SET default_transaction_read_only TO on`);
    await client.query(`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
    `);
    return databaseName;
  });
}

async function unfreezeLegacyDatabase(connectionString) {
  return withClient(connectionString, async (client) => {
    const databaseResult = await client.query('SELECT current_database() AS name');
    const databaseName = databaseResult.rows[0].name;
    await client.query(`ALTER DATABASE ${quoteIdent(databaseName)} RESET default_transaction_read_only`);
    await client.query(`
      SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
    `);
  });
}

async function verifyLegacyReadOnly(connectionString) {
  return withClient(connectionString, async (client) => {
    const result = await client.query('SHOW default_transaction_read_only');
    return result.rows[0]?.default_transaction_read_only === 'on';
  });
}

async function snapshotLegacy(connectionString) {
  return withClient(connectionString, async (client) => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const tables = {};
      for (const tableName of SOURCE_TABLES) tables[tableName] = await readTable(client, tableName);
      await client.query('COMMIT');
      return tables;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

async function mapReferenceByCode(client, tableName, sourceRows, userMap) {
  const map = new Map();
  let inserted = 0;
  let reused = 0;
  for (const row of sourceRows) {
    if (!row.code) throw new Error(`${tableName}: source row has no code.`);
    const existing = await client.query(
      `SELECT id FROM public.${quoteIdent(tableName)} WHERE code = $1`,
      [row.code]
    );
    if (existing.rowCount) {
      map.set(String(row.id), existing.rows[0].id);
      reused += 1;
      continue;
    }
    const transform = {};
    if (Object.hasOwn(row, 'updated_by')) transform.updated_by = mappedId(userMap, row.updated_by, `${tableName}.updated_by`);
    const id = await insertRow(client, tableName, row, { exclude: ['id'], transform, returning: 'id' });
    map.set(String(row.id), id);
    inserted += 1;
  }
  return { map, inserted, reused };
}

async function migrateSnapshot(targetConnectionString, snapshot) {
  return withClient(targetConnectionString, async (client) => {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await ensureCanonicalSchema(client);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_CODE]);
      const prior = await client.query('SELECT details, applied_at FROM public.ops_data_migrations WHERE code = $1', [MIGRATION_CODE]);
      if (prior.rowCount) {
        await client.query('COMMIT');
        return {
          applied: false,
          alreadyApplied: true,
          details: prior.rows[0].details,
          appliedAt: new Date(prior.rows[0].applied_at).toISOString()
        };
      }

      const identities = snapshot.user_identities || [];
      if (!snapshot.users?.length) throw new Error('Legacy VK database contains no users.');
      if (snapshot.users.length > 100 || identities.length > 200 || (snapshot.transactions || []).length > 10_000) {
        throw new Error('Legacy VK database exceeds guarded migration limits.');
      }
      for (const identity of identities) {
        if (identity.provider !== 'vk') {
          throw new Error('Legacy database contains a non-VK identity; automatic migration is blocked.');
        }
        const overlap = await client.query(
          'SELECT user_id FROM public.user_identities WHERE provider = $1 AND provider_user_id = $2',
          [identity.provider, identity.provider_user_id]
        );
        if (overlap.rowCount) {
          throw new Error('A VK identity already exists in the canonical database; automatic duplicate handling is blocked.');
        }
      }

      const userMap = new Map();
      for (const row of snapshot.users) {
        const newId = await insertRow(client, 'users', row, {
          exclude: ['id', 'merged_into_user_id'],
          returning: 'id'
        });
        userMap.set(String(row.id), newId);
      }
      for (const row of snapshot.users) {
        if (row.merged_into_user_id !== null && row.merged_into_user_id !== undefined) {
          await client.query(
            'UPDATE public.users SET merged_into_user_id = $1, merged_at = $2 WHERE id = $3',
            [mappedId(userMap, row.merged_into_user_id, 'users.merged_into_user_id'), row.merged_at, mappedId(userMap, row.id, 'users.id')]
          );
        }
      }

      const bars = await mapReferenceByCode(client, 'bars', snapshot.bars || [], userMap);
      const shopItems = await mapReferenceByCode(client, 'shop_items', snapshot.shop_items || [], userMap);
      const promotions = await mapReferenceByCode(client, 'promotions', snapshot.promotions || [], userMap);
      const shiftMap = new Map();

      for (const row of identities) {
        await insertRow(client, 'user_identities', row, {
          exclude: ['id'],
          transform: { user_id: mappedId(userMap, row.user_id, 'user_identities.user_id') }
        });
      }
      for (const row of snapshot.wallets || []) {
        await insertRow(client, 'wallets', row, {
          transform: { user_id: mappedId(userMap, row.user_id, 'wallets.user_id') }
        });
      }
      for (const row of snapshot.beer_loyalty || []) {
        await insertRow(client, 'beer_loyalty', row, {
          transform: { user_id: mappedId(userMap, row.user_id, 'beer_loyalty.user_id') }
        });
      }
      for (const row of snapshot.bar_customers || []) {
        await insertRow(client, 'bar_customers', row, {
          transform: {
            bar_id: mappedId(bars.map, row.bar_id, 'bar_customers.bar_id'),
            user_id: mappedId(userMap, row.user_id, 'bar_customers.user_id')
          }
        });
      }
      for (const row of snapshot.beta_grants || []) {
        await insertRow(client, 'beta_grants', row, {
          transform: { user_id: mappedId(userMap, row.user_id, 'beta_grants.user_id') }
        });
      }
      for (const row of snapshot.reward_grants || []) {
        await insertRow(client, 'reward_grants', row, {
          transform: { user_id: mappedId(userMap, row.user_id, 'reward_grants.user_id') }
        });
      }
      for (const row of snapshot.shifts || []) {
        const id = await insertRow(client, 'shifts', row, {
          exclude: ['id'],
          transform: { created_by: mappedId(userMap, row.created_by, 'shifts.created_by') },
          returning: 'id'
        });
        shiftMap.set(String(row.id), id);
      }
      for (const row of snapshot.shift_members || []) {
        await insertRow(client, 'shift_members', row, {
          transform: {
            shift_id: mappedId(shiftMap, row.shift_id, 'shift_members.shift_id'),
            user_id: mappedId(userMap, row.user_id, 'shift_members.user_id')
          }
        });
      }
      for (const row of snapshot.transactions || []) {
        await insertRow(client, 'transactions', row, {
          exclude: ['id'],
          transform: {
            client_id: mappedId(userMap, row.client_id, 'transactions.client_id'),
            staff_id: mappedId(userMap, row.staff_id, 'transactions.staff_id'),
            cancelled_by: mappedId(userMap, row.cancelled_by, 'transactions.cancelled_by')
          }
        });
      }
      for (const row of snapshot.account_link_attempts || []) {
        await insertRow(client, 'account_link_attempts', row, {
          exclude: ['id'],
          transform: { user_id: mappedId(userMap, row.user_id, 'account_link_attempts.user_id') }
        });
      }
      for (const row of snapshot.account_link_codes || []) {
        await insertRow(client, 'account_link_codes', row, {
          exclude: ['id'],
          transform: {
            user_id: mappedId(userMap, row.user_id, 'account_link_codes.user_id'),
            used_by_user_id: mappedId(userMap, row.used_by_user_id, 'account_link_codes.used_by_user_id')
          }
        });
      }
      for (const row of snapshot.qr_aliases || []) {
        await insertRow(client, 'qr_aliases', row, {
          exclude: ['id'],
          transform: {
            user_id: mappedId(userMap, row.user_id, 'qr_aliases.user_id'),
            source_user_id: mappedId(userMap, row.source_user_id, 'qr_aliases.source_user_id')
          }
        });
      }
      for (const row of snapshot.qr_sessions || []) {
        await insertRow(client, 'qr_sessions', row, {
          transform: { user_id: mappedId(userMap, row.user_id, 'qr_sessions.user_id') }
        });
      }
      for (const row of snapshot.shop_inquiries || []) {
        await insertRow(client, 'shop_inquiries', row, {
          exclude: ['id'],
          transform: {
            user_id: mappedId(userMap, row.user_id, 'shop_inquiries.user_id'),
            shop_item_id: mappedId(shopItems.map, row.shop_item_id, 'shop_inquiries.shop_item_id')
          }
        });
      }
      for (const row of snapshot.account_merge_audit || []) {
        await insertRow(client, 'account_merge_audit', row, {
          exclude: ['id'],
          transform: {
            canonical_user_id: mappedId(userMap, row.canonical_user_id, 'account_merge_audit.canonical_user_id'),
            merged_user_id: mappedId(userMap, row.merged_user_id, 'account_merge_audit.merged_user_id')
          }
        });
      }
      for (const row of snapshot.cancel_quota_resets || []) {
        await insertRow(client, 'cancel_quota_resets', row, {
          exclude: ['id'],
          transform: {
            shift_id: mappedId(shiftMap, row.shift_id, 'cancel_quota_resets.shift_id'),
            user_id: mappedId(userMap, row.user_id, 'cancel_quota_resets.user_id'),
            reset_by: mappedId(userMap, row.reset_by, 'cancel_quota_resets.reset_by')
          }
        });
      }
      for (const row of snapshot.account_deletion_audit || []) {
        await insertRow(client, 'account_deletion_audit', row, {
          onConflict: 'ON CONFLICT (deletion_id) DO NOTHING'
        });
      }

      const details = {
        source: 'vk-legacy',
        users: snapshot.users.length,
        identities: identities.length,
        wallets: (snapshot.wallets || []).length,
        transactions: (snapshot.transactions || []).length,
        rewards: (snapshot.reward_grants || []).length,
        betaGrants: (snapshot.beta_grants || []).length,
        shifts: (snapshot.shifts || []).length,
        barCustomers: (snapshot.bar_customers || []).length,
        barsInserted: bars.inserted,
        barsReused: bars.reused,
        shopItemsInserted: shopItems.inserted,
        shopItemsReused: shopItems.reused,
        promotionsInserted: promotions.inserted,
        promotionsReused: promotions.reused,
        excludedEphemeralTables: ['api_rate_limits'],
        canonicalGlobalSettingsPreserved: true
      };
      await client.query(
        'INSERT INTO public.ops_data_migrations(code, details) VALUES ($1, $2::jsonb)',
        [MIGRATION_CODE, JSON.stringify(details)]
      );
      await client.query('COMMIT');
      return { applied: true, alreadyApplied: false, details };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

async function verifyCanonicalMigration(connectionString) {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      `SELECT details, applied_at FROM public.ops_data_migrations WHERE code = $1`,
      [MIGRATION_CODE]
    );
    if (result.rowCount !== 1) throw new Error('Canonical migration marker is missing.');
    const identityResult = await client.query(`
      SELECT count(*)::int AS count
        FROM public.user_identities
       WHERE provider = 'vk'
    `);
    const details = result.rows[0].details;
    if (Number(identityResult.rows[0].count) < Number(details.identities || 0)) {
      throw new Error('Canonical VK identity count is lower than the migration marker.');
    }
    return {
      appliedAt: new Date(result.rows[0].applied_at).toISOString(),
      details,
      canonicalVkIdentityCount: Number(identityResult.rows[0].count)
    };
  });
}

const telegramUnrendered = await serviceVariables(SERVICES.telegramApp, true);
const vkOriginalUnrendered = await serviceVariables(SERVICES.vkApp, true);
const telegramRendered = await serviceVariables(SERVICES.telegramApp, false);
const canonicalDbRendered = await serviceVariables(SERVICES.canonicalDatabase, false);
const legacyDbRendered = await serviceVariables(SERVICES.legacyVkDatabase, false);

for (const key of COMMON_VARIABLES) {
  if (!String(telegramUnrendered[key] || '').trim()) throw new Error(`Telegram ${key} is missing.`);
}
const canonicalPublicUrl = String(canonicalDbRendered.DATABASE_PUBLIC_URL || '').trim();
const canonicalInternalUrl = String(canonicalDbRendered.DATABASE_URL || '').trim();
const legacyPublicUrl = String(legacyDbRendered.DATABASE_PUBLIC_URL || '').trim();
if (!canonicalPublicUrl || !canonicalInternalUrl || !legacyPublicUrl) {
  throw new Error('One or more required database URLs are missing.');
}
if (sha256(String(telegramRendered.DATABASE_URL || '')) !== sha256(canonicalInternalUrl)) {
  throw new Error('Telegram is not connected to the selected canonical database.');
}
if (safeDatabaseFingerprint(canonicalPublicUrl) === safeDatabaseFingerprint(legacyPublicUrl)) {
  throw new Error('Canonical and legacy database endpoints unexpectedly match.');
}

const canonicalDatabaseName = new URL(canonicalPublicUrl).pathname.replace(/^\//, '');
const legacyDatabaseName = new URL(legacyPublicUrl).pathname.replace(/^\//, '');
const backups = {
  canonical: await verifyBackup(canonicalPublicUrl, canonicalDatabaseName),
  legacyVk: await verifyBackup(legacyPublicUrl, legacyDatabaseName)
};

const synchronizedVariables = {
  DATABASE_URL: telegramUnrendered.DATABASE_URL,
  SESSION_SECRET: telegramUnrendered.SESSION_SECRET,
  IDENTITY_TOMBSTONE_SECRET: telegramUnrendered.IDENTITY_TOMBSTONE_SECRET,
  NODE_ENV: 'production',
  ALLOW_DEMO: 'false'
};
const originalVkSubset = Object.fromEntries(
  Object.keys(synchronizedVariables)
    .filter((key) => Object.hasOwn(vkOriginalUnrendered, key))
    .map((key) => [key, vkOriginalUnrendered[key]])
);

let variablesStaged = false;
let sourceFrozen = false;
let migrationCommitted = false;
try {
  await upsertServiceVariables(SERVICES.vkApp, synchronizedVariables);
  variablesStaged = true;
  const vkAfterStage = await serviceVariables(SERVICES.vkApp, true);
  for (const [key, value] of Object.entries(synchronizedVariables)) {
    if (String(vkAfterStage[key] ?? '') !== String(value)) {
      throw new Error(`VK staged variable ${key} does not match the canonical value.`);
    }
  }

  await freezeLegacyDatabase(legacyPublicUrl);
  sourceFrozen = true;
  if (!await verifyLegacyReadOnly(legacyPublicUrl)) {
    throw new Error('Legacy VK database did not enter read-only mode.');
  }

  const snapshot = await snapshotLegacy(legacyPublicUrl);
  const migration = await migrateSnapshot(canonicalPublicUrl, snapshot);
  migrationCommitted = true;
  const verification = await verifyCanonicalMigration(canonicalPublicUrl);

  console.log(JSON.stringify({
    ok: true,
    migrationCode: MIGRATION_CODE,
    migration,
    verification,
    legacyDatabaseReadOnly: true,
    variablesStagedWithoutDeploy: true,
    canonicalDatabaseFingerprint: safeDatabaseFingerprint(canonicalPublicUrl),
    legacyDatabaseFingerprint: safeDatabaseFingerprint(legacyPublicUrl),
    backups
  }, null, 2));
} catch (error) {
  if (!migrationCommitted) {
    if (sourceFrozen) await unfreezeLegacyDatabase(legacyPublicUrl).catch(() => {});
    if (variablesStaged) await upsertServiceVariables(SERVICES.vkApp, originalVkSubset).catch(() => {});
  }
  throw error;
}
