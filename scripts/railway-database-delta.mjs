import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client, types } = pg;
const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const RAILWAY_TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const DATABASES = {
  telegramCanonical: 'beb858e1-c412-42b8-b570-bda36ca82b59',
  vkLegacy: 'de5da1be-76c1-4976-a88c-efcce93600e6'
};
const TABLES = ['users', 'bonus_ledger', 'terms_acceptances'];

if (!RAILWAY_TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');
types.setTypeParser(20, (value) => value);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function canonicalize(value) {
  if (value === null) return null;
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { $bytes: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function valueHash(value) {
  return sha256(stableJson(value));
}

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RAILWAY_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-db-delta/1.0'
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
  const data = await railwayGraphql(`
    query ServiceVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
        unrendered: false
      )
    }
  `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId });
  if (!data?.variables || typeof data.variables !== 'object' || Array.isArray(data.variables)) {
    throw new Error(`Railway returned invalid variables for ${serviceId}.`);
  }
  return data.variables;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function exactSafeColumn(columnName) {
  return new Set([
    'role', 'status', 'mode', 'source', 'reason', 'kind', 'type', 'provider',
    'terms_version', 'version', 'wallet_balance', 'total_spent_cents',
    'beer_paid_ml', 'beer_gift_available_ml', 'cash_paid_cents',
    'bonus_earned', 'bonus_spent', 'beer_ml', 'amount', 'amount_cents',
    'bonus_amount', 'delta', 'active', 'is_active', 'is_deleted', 'revoked'
  ]).has(columnName);
}

function summarizeValue(columnName, value, peerValue) {
  const summary = {
    equal: valueHash(value) === valueHash(peerValue),
    type: value === null ? 'null' : value instanceof Date ? 'timestamp' : Buffer.isBuffer(value) ? 'bytes' : Array.isArray(value) ? 'array' : typeof value,
    null: value === null,
    sha256: valueHash(value)
  };

  if (typeof value === 'string') summary.length = value.length;
  if (Buffer.isBuffer(value)) summary.length = value.length;
  if (Array.isArray(value)) summary.length = value.length;

  if (exactSafeColumn(columnName) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
    summary.value = value;
  }

  if (value instanceof Date && peerValue instanceof Date) {
    summary.deltaMillisecondsToPeer = value.getTime() - peerValue.getTime();
  }

  return summary;
}

async function readDatabase(label, connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
    query_timeout: 60_000
  });
  await client.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = {};

    for (const tableName of TABLES) {
      const keyResult = await client.query(`
        SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_schema = tc.constraint_schema
           AND kcu.constraint_name = tc.constraint_name
           AND kcu.table_name = tc.table_name
         WHERE tc.table_schema = 'public'
           AND tc.table_name = $1
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position
      `, [tableName]);
      const primaryKey = keyResult.rows.map((row) => row.column_name);

      const rowsResult = await client.query(`SELECT * FROM public.${quoteIdent(tableName)}`);
      const rows = rowsResult.rows.map((row) => {
        const keyPayload = primaryKey.length
          ? Object.fromEntries(primaryKey.map((column) => [column, row[column]]))
          : row;
        return {
          keyHash: valueHash(keyPayload),
          rowHash: valueHash(row),
          row
        };
      }).sort((a, b) => a.keyHash.localeCompare(b.keyHash));

      result[tableName] = { primaryKey, rows };
    }

    await client.query('COMMIT');
    return { label, tables: result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const databases = {};
for (const [label, serviceId] of Object.entries(DATABASES)) {
  const variables = await serviceVariables(serviceId);
  const publicUrl = String(variables.DATABASE_PUBLIC_URL || '').trim();
  if (!publicUrl) throw new Error(`${label}: DATABASE_PUBLIC_URL is missing.`);
  databases[label] = await readDatabase(label, publicUrl);
}

const report = {};
for (const tableName of TABLES) {
  const left = databases.telegramCanonical.tables[tableName];
  const right = databases.vkLegacy.tables[tableName];
  const leftByKey = new Map(left.rows.map((item) => [item.keyHash, item]));
  const rightByKey = new Map(right.rows.map((item) => [item.keyHash, item]));
  const keyHashes = [...new Set([...leftByKey.keys(), ...rightByKey.keys()])].sort();
  const rows = [];

  for (const keyHash of keyHashes) {
    const leftItem = leftByKey.get(keyHash) || null;
    const rightItem = rightByKey.get(keyHash) || null;
    if (!leftItem || !rightItem) {
      rows.push({
        keyHash,
        presentInTelegramCanonical: Boolean(leftItem),
        presentInVkLegacy: Boolean(rightItem),
        equal: false,
        differingColumns: ['<row-presence>']
      });
      continue;
    }

    const columns = [...new Set([...Object.keys(leftItem.row), ...Object.keys(rightItem.row)])].sort();
    const differingColumns = columns.filter((column) => valueHash(leftItem.row[column]) !== valueHash(rightItem.row[column]));
    const columnDiffs = {};
    for (const column of differingColumns) {
      columnDiffs[column] = {
        telegramCanonical: summarizeValue(column, leftItem.row[column], rightItem.row[column]),
        vkLegacy: summarizeValue(column, rightItem.row[column], leftItem.row[column])
      };
    }

    rows.push({
      keyHash,
      presentInTelegramCanonical: true,
      presentInVkLegacy: true,
      equal: differingColumns.length === 0,
      differingColumns,
      columnDiffs
    });
  }

  report[tableName] = {
    primaryKeyColumns: left.primaryKey,
    telegramCanonicalRows: left.rows.length,
    vkLegacyRows: right.rows.length,
    rows
  };
}

console.log(JSON.stringify({ ok: true, report }, null, 2));
