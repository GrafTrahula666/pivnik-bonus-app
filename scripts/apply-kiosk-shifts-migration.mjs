// Operator procedure for the gated, additive kiosk shifts migration (012).
// It is intentionally NOT an automatic startup migration.
//   DATABASE_URL=... node scripts/apply-kiosk-shifts-migration.mjs --confirm APPLY_KIOSK_SHIFTS_012
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATION_FILE = '012_kiosk_shifts.sql';
export const CONFIRMATION = 'APPLY_KIOSK_SHIFTS_012';

export async function applyKioskShiftsMigration(client, sql) {
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    code TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await client.query("SELECT pg_advisory_lock(hashtext('pivnik-schema-migrations-v1'))");
  try {
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE code = $1', [MIGRATION_FILE]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`${MIGRATION_FILE} was changed after it was applied.`);
      return { applied: false, checksum };
    }
    // The file carries its own BEGIN/COMMIT.
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (code, checksum) VALUES ($1, $2)', [MIGRATION_FILE, checksum]);
    return { applied: true, checksum };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('pivnik-schema-migrations-v1'))").catch(() => {});
  }
}

async function main() {
  const index = process.argv.indexOf('--confirm');
  if (process.argv[index + 1] !== CONFIRMATION) {
    console.error(`Refusing to run without --confirm ${CONFIRMATION}`);
    process.exit(2);
  }
  const databaseUrl = String(process.env.DATABASE_URL || '');
  if (!databaseUrl) {
    console.error('DATABASE_URL is required.');
    process.exit(2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sql = await fs.readFile(path.join(root, 'migrations', MIGRATION_FILE), 'utf8');
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway.internal') ? false : { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const result = await applyKioskShiftsMigration(client, sql);
    console.log(result.applied ? `${MIGRATION_FILE} applied (${result.checksum})` : `${MIGRATION_FILE} already applied`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
