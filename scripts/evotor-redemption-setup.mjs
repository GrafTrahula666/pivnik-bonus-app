// Explicit, additive preparation. Never in prestart/materialize or automatic migrations.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { redemptionSchemaReady } from '../pos/redemption.js';

const apply=process.argv.includes('--apply');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (apply && process.env.PIVNIK_POS_REDEMPTION_ENABLED === 'true') throw new Error('Disable new reservations before preparing their schema.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL.includes('railway.internal') ? false : {rejectUnauthorized:true},
  connectionTimeoutMillis:8000,max:1});
const db=await pool.connect();
try {
  const dependencies=(await db.query(`SELECT to_regclass('public.pos_receipt_claims') IS NOT NULL
    AND to_regclass('public.pos_bonus_accruals') IS NOT NULL AS ready`)).rows[0]?.ready;
  if (!dependencies) throw new Error('Prepare the existing POS connection/accrual schema first.');
  if (apply) {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('pivnik:evotor-redemption-schema:023'))");
    await db.query(await readFile(new URL('../migrations/023_evotor_redemptions.sql',import.meta.url),'utf8'));
    if (!await redemptionSchemaReady(db)) throw new Error('Redemption schema was not prepared.');
    await db.query('COMMIT');
  }
  console.log(JSON.stringify({schemaReady:await redemptionSchemaReady(db),applied:apply,
    newReservationsEnabled:process.env.PIVNIK_POS_REDEMPTION_ENABLED==='true',walletWrites:false}));
} catch (error) {
  try {await db.query('ROLLBACK');} catch {}
  throw error;
} finally {db.release();await pool.end();}
