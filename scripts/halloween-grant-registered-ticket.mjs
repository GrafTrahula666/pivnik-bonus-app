// Owner's one-off Halloween gift: 1 ticket to every account with at least one completed purchase that does not have it yet.
// Accounts that only registered get nothing.
// Run in the Railway console of the Telegram service, like the backfill script. Never runs on startup.
//   node scripts/halloween-grant-registered-ticket.mjs            (check only: how many accounts would get it)
//   node scripts/halloween-grant-registered-ticket.mjs --apply    (grants the tickets)
// Each grant has its own source key, so running again skips accounts that already got it.
import { parseArgs } from 'node:util';
import pg from 'pg';
import { grantTickets } from '../halloween-raffle.js';

const SOURCE_PREFIX = 'admin:registered-ticket-2026-10-16:';
const { values } = parseArgs({ options: { apply: { type: 'boolean' } } });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  max: 1
});

try {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
     WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM transactions t WHERE t.client_id = u.id AND t.status = 'completed'
                   AND t.mode = 'accrue' AND t.check_amount_cents > 0)
       AND NOT EXISTS (SELECT 1 FROM halloween_ticket_ledger l WHERE l.source_key = $1 || u.id::text)
     ORDER BY u.id`,
    [SOURCE_PREFIX]
  );
  console.log(JSON.stringify({ accountsWithoutGift: rows.length, ticketsToGrant: rows.length }));
  if (!values.apply) {
    console.log('Проверка пройдена. Чтобы выдать билеты, запустите ту же команду с --apply.');
  } else {
    let granted = 0;
    for (const { id } of rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await grantTickets(client, { userId: Number(id), delta: 1, reason: 'admin', sourceKey: `${SOURCE_PREFIX}${id}`, note: 'Подарок: 1 билет тем, кто купил' });
        await client.query('COMMIT');
        if (result.applied) granted += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`user ${id}: ${error.code ? `${error.code}: ` : ''}${error.message}`);
      } finally {
        client.release();
      }
    }
    console.log(JSON.stringify({ granted, total: rows.length }));
    console.log('Готово: билеты выданы.');
  }
} catch (error) {
  console.error(error.code ? `${error.code}: ${error.message}` : error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
