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
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $number: 'NaN' };
    if (value === Infinity) return { $number: 'Infinity' };
    if (value === -Infinity) return { $number: '-Infinity' };
    if (Object.is(value, -0)) return { $number: '-0' };
  }
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
      'user-agent': 'pivnik-db-semantic-delta/1.0'
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

function isTimestampColumn(column, left, right) {
  return column.endsWith('_at') || left instanceof Date || right instanceof Date;
}

function isInternalKeyColumn(table, column) {
  if (column === 'id') return true;
  if ((table === 'bonus_ledger' || table === 'terms_acceptances') && column === 'user_id') return true;
  return false;
}

function pairingIgnored(table, column, left, right) {
  return isInternalKeyColumn(table, column) || isTimestampColumn(column, left, right);
}

function exactSafeColumn(column) {
  return new Set([
    'role', 'status', 'mode', 'source', 'reason', 'kind', 'type', 'provider',
    'terms_version', 'version', 'wallet_balance', 'total_spent_cents',
    'beer_paid_ml', 'beer_gift_available_ml', 'cash_paid_cents',
    'bonus_earned', 'bonus_spent', 'beer_ml', 'amount', 'amount_cents',
    'bonus_amount', 'delta', 'active', 'is_active', 'is_deleted', 'revoked',
    'session_version', 'terms_accepted'
  ]).has(column);
}

function describeValue(column, value, peerValue) {
  const result = {
    type: value === null
      ? 'null'
      : value instanceof Date
        ? 'timestamp'
        : Buffer.isBuffer(value)
          ? 'bytes'
          : Array.isArray(value)
            ? 'array'
            : typeof value,
    null: value === null,
    sha256: valueHash(value)
  };

  if (typeof value === 'string' || Buffer.isBuffer(value) || Array.isArray(value)) {
    result.length = value.length;
  }
  if (exactSafeColumn(column) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
    result.value = value;
  }
  if (value instanceof Date && peerValue instanceof Date) {
    result.deltaMillisecondsToPeer = value.getTime() - peerValue.getTime();
  }
  return result;
}

function differingColumns(left, right) {
  return [...new Set([...Object.keys(left || {}), ...Object.keys(right || {})])]
    .sort()
    .filter((column) => valueHash(left?.[column]) !== valueHash(right?.[column]));
}

function pairingCost(table, left, right) {
  let cost = 0;
  for (const column of differingColumns(left, right)) {
    if (pairingIgnored(table, column, left?.[column], right?.[column])) continue;
    cost += exactSafeColumn(column) ? 100 : 10;
  }
  return cost;
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const tail = values.slice(0, index).concat(values.slice(index + 1));
    for (const permutation of permutations(tail)) result.push([head, ...permutation]);
  }
  return result;
}

function bestPairing(table, leftRows, rightRows) {
  if (leftRows.length !== rightRows.length) {
    return {
      equalCardinality: false,
      pairs: [],
      unmatchedTelegramCanonical: leftRows.length,
      unmatchedVkLegacy: rightRows.length
    };
  }
  if (leftRows.length > 8) {
    throw new Error(`${table}: refusing factorial pairing for ${leftRows.length} rows.`);
  }

  let best = null;
  for (const permutation of permutations(rightRows)) {
    const pairs = leftRows.map((left, index) => ({ left, right: permutation[index] }));
    const cost = pairs.reduce((sum, pair) => sum + pairingCost(table, pair.left, pair.right), 0);
    if (!best || cost < best.cost) best = { cost, pairs };
  }
  return {
    equalCardinality: true,
    unmatchedTelegramCanonical: 0,
    unmatchedVkLegacy: 0,
    ...best
  };
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
    const tables = {};
    for (const table of TABLES) {
      const result = await client.query(`SELECT * FROM public.${quoteIdent(table)}`);
      tables[table] = result.rows;
    }
    await client.query('COMMIT');
    return { label, tables };
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
let allBusinessFieldsEqual = true;

for (const table of TABLES) {
  const leftRows = databases.telegramCanonical.tables[table];
  const rightRows = databases.vkLegacy.tables[table];
  const pairing = bestPairing(table, leftRows, rightRows);
  const pairReports = [];

  if (!pairing.equalCardinality) allBusinessFieldsEqual = false;

  for (let index = 0; index < pairing.pairs.length; index += 1) {
    const { left, right } = pairing.pairs[index];
    const columns = differingColumns(left, right);
    const businessColumns = columns.filter((column) => !pairingIgnored(table, column, left[column], right[column]));
    if (businessColumns.length > 0) allBusinessFieldsEqual = false;

    const columnDiffs = {};
    for (const column of columns) {
      const category = isInternalKeyColumn(table, column)
        ? 'internal_key'
        : isTimestampColumn(column, left[column], right[column])
          ? 'timestamp'
          : exactSafeColumn(column)
            ? 'business_safe'
            : 'opaque_business_or_profile';

      columnDiffs[column] = {
        category,
        telegramCanonical: describeValue(column, left[column], right[column]),
        vkLegacy: describeValue(column, right[column], left[column])
      };
    }

    pairReports.push({
      pair: index + 1,
      allColumnsEqual: columns.length === 0,
      businessFieldsEqualIgnoringInternalKeysAndTimestamps: businessColumns.length === 0,
      differingColumns: columns,
      businessDifferingColumns: businessColumns,
      columnDiffs
    });
  }

  report[table] = {
    telegramCanonicalRows: leftRows.length,
    vkLegacyRows: rightRows.length,
    equalCardinality: pairing.equalCardinality,
    pairingCost: pairing.cost ?? null,
    pairs: pairReports
  };
}

console.log(JSON.stringify({
  ok: true,
  allBusinessFieldsEqualIgnoringInternalKeysAndTimestamps: allBusinessFieldsEqual,
  report
}, null, 2));
