// Grants the Halloween purchase tickets that were missed while migration 011 was not applied.
// Dry run by default: prints what it would grant. With --apply it runs the normal purchase hook for each
// purchase, which is idempotent (a purchase that already has its tickets is skipped).
//   DATABASE_URL=... node scripts/halloween-backfill-purchases.mjs [--since=2026-10-06T00:00:00+03:00] [--apply]
import pg from 'pg';
import { recordPurchase } from '../halloween-invite.js';
import { ticketsForPurchase } from '../halloween-raffle.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [key, ...rest] = a.replace(/^--/, '').split('=');
  return [key, rest.length ? rest.join('=') : true];
}));
const since = new Date(args.since || '2026-10-06T00:00:00+03:00');
if (Number.isNaN(since.getTime())) throw new Error('--since must be a date');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true }, max: 1 });
try {
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
    if (args.apply) {
      const client = await pool.connect();
      try { line.result = await recordPurchase(client, { transactionId: r.id }); } finally { client.release(); }
    }
    console.log(JSON.stringify(line));
  }
  if (!args.apply && missing.length) console.log('Dry run. Add --apply to grant these tickets.');
} finally {
  await pool.end();
}
