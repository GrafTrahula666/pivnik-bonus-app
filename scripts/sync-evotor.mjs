// Read-only Evotor API; writes only reviewed POS tables in the configured DB.
// Run in a scheduled worker after separately approved migration/activation.
import pg from 'pg';
import { syncEvotor } from '../pos/sync.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true }, max: 1 });
try { console.log(JSON.stringify(await syncEvotor({ pool }))); }
catch (error) { console.error(error.code || 'sync_failed'); process.exitCode = 1; }
finally { await pool.end(); }
