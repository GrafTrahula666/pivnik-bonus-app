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

if (!RAILWAY_TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');

// Preserve exact 64-bit integer text so hashing is lossless.
types.setTypeParser(20, (value) => value);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RAILWAY_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-db-equivalence/1.0'
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

async function inspectDatabase(label, connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60_000,
    query_timeout: 60_000
  });
  await client.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const schemaRows = await client.query(`
      SELECT c.table_name,
             c.ordinal_position,
             c.column_name,
             c.data_type,
             c.udt_name,
             c.is_nullable,
             c.column_default,
             c.is_identity,
             c.identity_generation,
             c.is_generated,
             c.generation_expression
        FROM information_schema.columns c
       WHERE c.table_schema = 'public'
       ORDER BY c.table_name, c.ordinal_position
    `);

    const constraintRows = await client.query(`
      SELECT tc.table_name,
             tc.constraint_name,
             tc.constraint_type,
             kcu.ordinal_position,
             kcu.column_name,
             ccu.table_name AS referenced_table,
             ccu.column_name AS referenced_column
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_schema = tc.constraint_schema
         AND kcu.constraint_name = tc.constraint_name
         AND kcu.table_name = tc.table_name
        LEFT JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema = 'public'
       ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position NULLS FIRST
    `);

    const indexRows = await client.query(`
      SELECT schemaname, tablename, indexname, indexdef
        FROM pg_indexes
       WHERE schemaname = 'public'
       ORDER BY tablename, indexname
    `);

    const triggerRows = await client.query(`
      SELECT event_object_table,
             trigger_name,
             event_manipulation,
             action_timing,
             action_orientation,
             action_statement
        FROM information_schema.triggers
       WHERE trigger_schema = 'public'
       ORDER BY event_object_table, trigger_name, event_manipulation
    `);

    const schemaFingerprint = sha256(stableJson({
      columns: schemaRows.rows,
      constraints: constraintRows.rows,
      indexes: indexRows.rows,
      triggers: triggerRows.rows
    }));

    const tableNames = [...new Set(schemaRows.rows.map((row) => row.table_name))].sort();
    const tables = {};
    for (const tableName of tableNames) {
      const result = await client.query(`SELECT * FROM public.${quoteIdent(tableName)}`);
      const rowHashes = result.rows.map((row) => sha256(stableJson(row))).sort();
      tables[tableName] = {
        rows: rowHashes.length,
        sha256: sha256(rowHashes.join('\n'))
      };
    }

    const sequencesResult = await client.query(`
      SELECT sequence_schema, sequence_name, data_type, start_value, minimum_value,
             maximum_value, increment, cycle_option
        FROM information_schema.sequences
       WHERE sequence_schema = 'public'
       ORDER BY sequence_name
    `);
    const sequences = {};
    for (const sequence of sequencesResult.rows) {
      const state = await client.query(
        `SELECT last_value::text AS last_value, is_called FROM public.${quoteIdent(sequence.sequence_name)}`
      );
      sequences[sequence.sequence_name] = {
        sha256: sha256(stableJson({ definition: sequence, state: state.rows[0] || null }))
      };
    }

    const databaseFingerprint = sha256(stableJson({
      schemaFingerprint,
      tables,
      sequences
    }));

    await client.query('COMMIT');
    return { label, schemaFingerprint, tables, sequences, databaseFingerprint };
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
  databases[label] = await inspectDatabase(label, publicUrl);
}

const first = databases.telegramCanonical;
const second = databases.vkLegacy;
const tableNames = [...new Set([...Object.keys(first.tables), ...Object.keys(second.tables)])].sort();
const tableComparison = Object.fromEntries(tableNames.map((tableName) => {
  const left = first.tables[tableName] || null;
  const right = second.tables[tableName] || null;
  return [tableName, {
    telegramCanonicalRows: left?.rows ?? null,
    vkLegacyRows: right?.rows ?? null,
    equal: Boolean(left && right && left.rows === right.rows && left.sha256 === right.sha256),
    telegramCanonicalSha256: left?.sha256 ?? null,
    vkLegacySha256: right?.sha256 ?? null
  }];
}));

const sequenceNames = [...new Set([...Object.keys(first.sequences), ...Object.keys(second.sequences)])].sort();
const sequenceComparison = Object.fromEntries(sequenceNames.map((sequenceName) => {
  const left = first.sequences[sequenceName] || null;
  const right = second.sequences[sequenceName] || null;
  return [sequenceName, {
    equal: Boolean(left && right && left.sha256 === right.sha256),
    telegramCanonicalSha256: left?.sha256 ?? null,
    vkLegacySha256: right?.sha256 ?? null
  }];
}));

const tablesEqual = Object.values(tableComparison).every((item) => item.equal);
const sequencesEqual = Object.values(sequenceComparison).every((item) => item.equal);
const schemaEqual = first.schemaFingerprint === second.schemaFingerprint;
const fullyEqual = schemaEqual && tablesEqual && sequencesEqual
  && first.databaseFingerprint === second.databaseFingerprint;

console.log(JSON.stringify({
  ok: fullyEqual,
  fullyEqual,
  schemaEqual,
  tablesEqual,
  sequencesEqual,
  telegramCanonicalFingerprint: first.databaseFingerprint,
  vkLegacyFingerprint: second.databaseFingerprint,
  tableComparison,
  sequenceComparison
}, null, 2));

if (!fullyEqual) process.exitCode = 2;
