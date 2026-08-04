import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const WORKSPACE_ID = 'fbffb30c-9091-432f-9e09-9c59e1440304';
const DATABASES = {
  telegramCanonical: 'beb858e1-c412-42b8-b570-bda36ca82b59',
  vkLegacy: 'de5da1be-76c1-4976-a88c-efcce93600e6'
};

function railway(args) {
  return execFileSync('railway', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024
  });
}

function parseVariables(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return Object.fromEntries(parsed.map((item) => [item.name ?? item.key, item.value ?? '']));
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.variables && typeof parsed.variables === 'object') return parsed.variables;
    return parsed;
  }
  return {};
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function toSafeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

async function columnSet(client, tableName) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function safeGroupedSummary(client, tableName, groupColumn, sumColumns = []) {
  const columns = await columnSet(client, tableName);
  if (!columns.has(groupColumn)) return [];
  const sums = sumColumns
    .filter((column) => columns.has(column))
    .map((column) => `COALESCE(SUM(${quoteIdent(column)}), 0)::text AS ${quoteIdent(`${column}_sum`)}`);
  const result = await client.query(`
    SELECT ${quoteIdent(groupColumn)}::text AS group_value,
           COUNT(*)::text AS row_count
           ${sums.length ? `, ${sums.join(', ')}` : ''}
      FROM public.${quoteIdent(tableName)}
     GROUP BY ${quoteIdent(groupColumn)}
     ORDER BY ${quoteIdent(groupColumn)}::text
  `);
  return result.rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, key === 'group_value' ? value : toSafeNumber(value)])
  ));
}

async function inspectDatabase(label, connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
    query_timeout: 60_000
  });
  await client.connect();

  try {
    const versionResult = await client.query(`SELECT current_setting('server_version') AS version`);
    const databaseSize = await client.query(`SELECT pg_database_size(current_database())::text AS bytes`);
    const tableResult = await client.query(`
      SELECT c.relname AS table_name,
             pg_total_relation_size(c.oid)::text AS total_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY c.relname
    `);

    const columnsResult = await client.query(`
      SELECT table_name,
             column_name,
             data_type,
             udt_name,
             is_nullable,
             column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position
    `);

    const keyResult = await client.query(`
      SELECT tc.table_name,
             tc.constraint_name,
             tc.constraint_type,
             array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
         AND kcu.table_name = tc.table_name
       WHERE tc.table_schema = 'public'
         AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
       GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
       ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
    `);

    const foreignKeyResult = await client.query(`
      SELECT tc.table_name,
             tc.constraint_name,
             kcu.column_name,
             ccu.table_name AS referenced_table,
             ccu.column_name AS referenced_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema = 'public'
         AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    `);

    const columnsByTable = new Map();
    for (const row of columnsResult.rows) {
      if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, []);
      columnsByTable.get(row.table_name).push({
        name: row.column_name,
        type: row.data_type,
        udt: row.udt_name,
        nullable: row.is_nullable === 'YES',
        hasDefault: row.column_default !== null
      });
    }

    const keysByTable = new Map();
    for (const row of keyResult.rows) {
      if (!keysByTable.has(row.table_name)) keysByTable.set(row.table_name, []);
      keysByTable.get(row.table_name).push({
        name: row.constraint_name,
        type: row.constraint_type,
        columns: row.columns || []
      });
    }

    const foreignKeysByTable = new Map();
    for (const row of foreignKeyResult.rows) {
      if (!foreignKeysByTable.has(row.table_name)) foreignKeysByTable.set(row.table_name, []);
      foreignKeysByTable.get(row.table_name).push({
        name: row.constraint_name,
        column: row.column_name,
        referencedTable: row.referenced_table,
        referencedColumn: row.referenced_column
      });
    }

    const tables = [];
    for (const row of tableResult.rows) {
      const countResult = await client.query(`SELECT COUNT(*)::text AS row_count FROM public.${quoteIdent(row.table_name)}`);
      tables.push({
        name: row.table_name,
        rows: toSafeNumber(countResult.rows[0]?.row_count),
        totalBytes: toSafeNumber(row.total_bytes),
        columns: columnsByTable.get(row.table_name) || [],
        keys: keysByTable.get(row.table_name) || [],
        foreignKeys: foreignKeysByTable.get(row.table_name) || []
      });
    }

    const tableNames = new Set(tables.map((table) => table.name));
    const summaries = {};
    if (tableNames.has('users')) {
      summaries.usersByRole = await safeGroupedSummary(client, 'users', 'role', [
        'wallet_balance', 'total_spent_cents', 'beer_paid_ml', 'beer_gift_available_ml'
      ]);
    }
    if (tableNames.has('transactions')) {
      summaries.transactionsByStatus = await safeGroupedSummary(client, 'transactions', 'status', [
        'cash_paid_cents', 'bonus_earned', 'bonus_spent', 'beer_ml'
      ]);
      summaries.transactionsByMode = await safeGroupedSummary(client, 'transactions', 'mode', [
        'cash_paid_cents', 'bonus_earned', 'bonus_spent', 'beer_ml'
      ]);
    }
    if (tableNames.has('user_identities')) {
      summaries.identitiesByProvider = await safeGroupedSummary(client, 'user_identities', 'provider');
    }

    const identityKeys = new Map();
    if (tableNames.has('user_identities')) {
      const identityRows = await client.query(`
        SELECT provider, provider_user_id
          FROM public.user_identities
         WHERE provider IS NOT NULL
           AND provider_user_id IS NOT NULL
      `);
      for (const row of identityRows.rows) {
        const provider = String(row.provider);
        if (!identityKeys.has(provider)) identityKeys.set(provider, new Set());
        identityKeys.get(provider).add(fingerprint(`${provider}:${row.provider_user_id}`));
      }
    }

    const userColumns = tableNames.has('users') ? await columnSet(client, 'users') : new Set();
    if (userColumns.has('telegram_id')) {
      const telegramRows = await client.query(`SELECT telegram_id FROM public.users WHERE telegram_id IS NOT NULL`);
      if (!identityKeys.has('telegram')) identityKeys.set('telegram', new Set());
      for (const row of telegramRows.rows) {
        identityKeys.get('telegram').add(fingerprint(`telegram:${row.telegram_id}`));
      }
    }

    return {
      label,
      postgresVersion: versionResult.rows[0]?.version || null,
      databaseSizeBytes: toSafeNumber(databaseSize.rows[0]?.bytes),
      tables,
      summaries,
      identityKeys
    };
  } finally {
    await client.end();
  }
}

railway([
  'link',
  '--project', PROJECT_ID,
  '--environment', ENVIRONMENT_ID,
  '--workspace', WORKSPACE_ID,
  '--json'
]);

const inspected = {};
for (const [label, serviceId] of Object.entries(DATABASES)) {
  const vars = parseVariables(railway([
    'variable', 'list',
    '--service', serviceId,
    '--environment', ENVIRONMENT_ID,
    '--json'
  ]));
  const publicUrl = String(vars.DATABASE_PUBLIC_URL || '').trim();
  if (!publicUrl) throw new Error(`${label}: DATABASE_PUBLIC_URL is not configured.`);
  inspected[label] = await inspectDatabase(label, publicUrl);
}

const providers = new Set([
  ...inspected.telegramCanonical.identityKeys.keys(),
  ...inspected.vkLegacy.identityKeys.keys()
]);
const identityOverlap = {};
for (const provider of providers) {
  const first = inspected.telegramCanonical.identityKeys.get(provider) || new Set();
  const second = inspected.vkLegacy.identityKeys.get(provider) || new Set();
  let overlap = 0;
  for (const key of first) if (second.has(key)) overlap += 1;
  identityOverlap[provider] = {
    telegramCanonical: first.size,
    vkLegacy: second.size,
    overlap
  };
}

function serializable(database) {
  const { identityKeys, ...safe } = database;
  return safe;
}

console.log(JSON.stringify({
  ok: true,
  databases: {
    telegramCanonical: serializable(inspected.telegramCanonical),
    vkLegacy: serializable(inspected.vkLegacy)
  },
  identityOverlap
}, null, 2));
