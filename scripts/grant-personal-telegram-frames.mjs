import pg from 'pg';
import { grantPersonalTelegramFrames } from '../personal-profile-frames.js';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported; default is dry run.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000
});
try {
  await client.connect();
  const result = await grantPersonalTelegramFrames(client, {
    ownerTelegramId: process.env.OWNER_TELEGRAM_ID,
    sevTroutTelegramId: process.env.SEVTROUT_TELEGRAM_ID,
    apply: args.includes('--apply')
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.end();
}
