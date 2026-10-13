// Owner's one-off Halloween setup against the target DB (Railway console of the Telegram service). Never runs on startup.
//   node scripts/halloween-backfill-purchases.mjs                     (check only: what is missing)
//   node scripts/halloween-backfill-purchases.mjs --migrate --apply   (applies migration 011, grants missed tickets)
// --since (default 2026-10-06T00:00:00+03:00) limits which purchases get missed tickets. Granting runs the normal
// purchase hook, which is idempotent: a purchase that already has its tickets is skipped, so running twice is safe.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { recordPurchase } from '../halloween-invite.js';
import { ticketsForPurchase } from '../halloween-raffle.js';

const { values } = parseArgs({ options: {
  since: { type: 'string', default: '2026-10-06T00:00:00+03:00' }, migrate: { type: 'boolean' }, apply: { type: 'boolean' }
} });
const since = new Date(values.since);
if (Number.isNaN(since.getTime())) throw new Error('--since must be a date');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  max: 1
});
const hasTables = async () => Boolean((await pool.query("SELECT to_regclass('halloween_ticket_ledger') AS t")).rows[0].t);

try {
  if (values.migrate && values.apply) {
    await pool.query(await readFile(new URL('../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
    console.log('Миграция 011 применена.');
  }
  if (!(await hasTables())) {
    console.log('Таблиц билетов нет: запустите ту же команду с --migrate --apply.');
  } else {
    const { rows } = await pool.query(
      `SELECT t.id, t.client_id, t.check_amount_cents, t.created_at,
              EXISTS (SELECT 1 FROM halloween_ticket_ledger l WHERE l.source_key = 'purchase:' || t.id) AS granted
       FROM transactions t
       WHERE t.status = 'completed' AND t.mode IN ('accrue', 'redeem') AND t.check_amount_cents >= 100000
         AND t.created_at >= $1::timestamptz
       ORDER BY t.id`,
      [since.toISOString()]
    );
    const missing = rows.filter((r) => !r.granted);
    console.log(JSON.stringify({ since: since.toISOString(), purchases: rows.length, missing: missing.length,
      ticketsMissing: missing.reduce((n, r) => n + ticketsForPurchase(Number(r.check_amount_cents) / 100), 0) }));
    for (const r of missing) {
      const line = { transactionId: Number(r.id), userId: Number(r.client_id), rub: Number(r.check_amount_cents) / 100,
        at: new Date(r.created_at).toISOString(), tickets: ticketsForPurchase(Number(r.check_amount_cents) / 100) };
      if (values.apply) {
        const client = await pool.connect();
        try { line.result = await recordPurchase(client, { transactionId: r.id }); } finally { client.release(); }
      }
      console.log(JSON.stringify(line));
    }
    if (!missing.length) console.log('Пропущенных билетов нет.');
    else if (values.apply) console.log('Готово: пропущенные билеты начислены.');
    else console.log('Проверка пройдена. Чтобы начислить эти билеты, запустите ту же команду с --apply.');
  }
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
