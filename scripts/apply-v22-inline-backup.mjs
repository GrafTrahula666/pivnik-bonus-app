import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const MARKER = 'PIVNIK_V22_INLINE_BACKUP_20260827';
let source = await fs.readFile(gatewayPath, 'utf8');

if (source.includes(`// ${MARKER}`)) {
  console.log('Pivnik v22 inline backup guard already materialized; restart-safe skip.');
  process.exit(0);
}

const anchor = `const child = isTestImport ? null : spawn(process.execPath, [path.join(__dirname, 'server.js')], {`;
if (!source.includes(anchor)) throw new Error('v22 inline backup: child-server anchor not found');

const backupCode = `const V22_BACKUP_SCHEMA = 'pivnik_v22_preupgrade_20260827';

function quotePgIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

async function ensureV22InlineBackup() {
  if (process.env.NODE_ENV !== 'production') return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pivnik-v22-inline-backup-20260827'))");

    const existing = await client.query(
      'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
      [V22_BACKUP_SCHEMA]
    );
    if (existing.rowCount) {
      const verification = await client.query(
        \`SELECT
           to_regclass($1) IS NOT NULL AS users_ok,
           to_regclass($2) IS NOT NULL AS wallets_ok,
           to_regclass($3) IS NOT NULL AS transactions_ok,
           to_regclass($4) IS NOT NULL AS metadata_ok\`,
        [
          V22_BACKUP_SCHEMA + '.users',
          V22_BACKUP_SCHEMA + '.wallets',
          V22_BACKUP_SCHEMA + '.transactions',
          V22_BACKUP_SCHEMA + '._metadata'
        ]
      );
      const row = verification.rows[0] || {};
      if (!row.users_ok || !row.wallets_ok || !row.transactions_ok || !row.metadata_ok) {
        throw new Error('Existing v22 backup schema is incomplete; refusing to start.');
      }
      await client.query('COMMIT');
      console.log('V22 pre-upgrade database snapshot already exists and is verified.');
      return;
    }

    const schemaIdent = quotePgIdentifier(V22_BACKUP_SCHEMA);
    await client.query(\`CREATE SCHEMA \${schemaIdent}\`);
    const tables = await client.query(
      \`SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename\`
    );
    if (!tables.rowCount) throw new Error('No public tables found for v22 backup.');

    for (const { tablename } of tables.rows) {
      const tableIdent = quotePgIdentifier(tablename);
      await client.query(
        \`CREATE TABLE \${schemaIdent}.\${tableIdent} AS TABLE public.\${tableIdent} WITH DATA\`
      );
    }

    await client.query(\`
      CREATE TABLE \${schemaIdent}._metadata AS
      SELECT
        NOW() AS backed_up_at,
        $1::text AS source_release,
        current_database()::text AS source_database,
        $2::integer AS copied_table_count
    \`, [releaseCommit, tables.rowCount]);

    const verification = await client.query(
      \`SELECT
         (SELECT copied_table_count FROM \${schemaIdent}._metadata LIMIT 1)::integer AS copied_table_count,
         (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1)::integer AS backup_table_count,
         (SELECT COUNT(*) FROM \${schemaIdent}.users)::integer AS users_count,
         (SELECT COUNT(*) FROM \${schemaIdent}.transactions)::integer AS transactions_count\`,
      [V22_BACKUP_SCHEMA]
    );
    const row = verification.rows[0] || {};
    if (Number(row.copied_table_count || 0) !== tables.rowCount
      || Number(row.backup_table_count || 0) < tables.rowCount + 1) {
      throw new Error('V22 database snapshot verification failed.');
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      v22PreUpgradeSnapshot: 'created',
      schema: V22_BACKUP_SCHEMA,
      copiedTables: Number(row.copied_table_count || 0),
      users: Number(row.users_count || 0),
      transactions: Number(row.transactions_count || 0),
      sourceRelease: releaseCommit
    }));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

if (!isTestImport) await ensureV22InlineBackup();

`;

source = source.replace(anchor, `${backupCode}${anchor}`);
source += `\n// ${MARKER}\n`;
await fs.writeFile(gatewayPath, source, 'utf8');
console.log('Pivnik v22 fail-closed inline database snapshot guard is materialized.');
