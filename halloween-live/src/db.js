import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export const EVENT_ID = 'pivnik-halloween-2026';
export const initialState = () => ({
  mode: 'demo', guests: [], draws: [], main: null, excludeWinners: true,
  registrationOpen: true, stage: { id: 'waiting', status: 'waiting' },
  prizes: [
    { id: 'beer1', title: '1 литр пива', kind: 'beer', amount: 1000 },
    { id: 'beer05', title: '0,5 литра пива', kind: 'beer', amount: 500 },
    { id: 'bonus100', title: '100 бонусов', kind: 'bonus', amount: 100 },
    { id: 'bonus250', title: '250 бонусов', kind: 'bonus', amount: 250 }
  ]
});

export async function connectDatabase({ mode, url, dataDir }) {
  if (mode === 'demo') {
    await mkdir(dataDir, { recursive: true });
    const db = new PGlite(dataDir);
    // PGlite serializes statements, not whole transactions. Serialize ALL callers.
    let tail = Promise.resolve();
    const exclusive = (fn) => {
      const next = tail.then(() => fn(db));
      tail = next.catch(() => {});
      return next;
    };
    await db.exec(await readFile(new URL('../migrations/001_live.sql', import.meta.url), 'utf8'));
    await db.exec(`CREATE TABLE IF NOT EXISTS users (
      id bigint PRIMARY KEY, first_name text, last_name text, photo_url text,
      qr_token text, qr_short_code text, merged_into_user_id bigint);
      CREATE TABLE IF NOT EXISTS qr_aliases (user_id bigint, source_user_id bigint, qr_token text, qr_short_code text);`);
    // Real migration and real algorithm, confined to a clearly separate embedded DEMO database.
    await db.exec(await readFile(new URL('../../migrations/011_halloween_raffle.sql', import.meta.url), 'utf8'));
    for (let i = 1; i <= 16; i++) {
      const names = ['Александр', 'Мария', 'Дмитрий', 'Анна', 'Артём', 'Екатерина', 'Иван', 'Дарья', 'Максим', 'София', 'Михаил', 'Алиса', 'Кирилл', 'Полина', 'Владислав', 'Виктория'];
      await db.query('INSERT INTO users VALUES ($1,$2,$3,NULL,$4,$5,NULL) ON CONFLICT DO NOTHING',
        [i, names[i - 1], 'Демо', `DEMO_token_${String(i).padStart(8, '0')}`, `PVK-DEMO-${String(i).padStart(4, '0')}`]);
      await db.query("INSERT INTO halloween_ticket_ledger (user_id,delta,reason,source_key) VALUES ($1,$2,'admin',$3) ON CONFLICT DO NOTHING", [i, i % 4 + 1, `demo:${i}`]);
      const found = await db.query('SELECT 1 FROM halloween_ticket WHERE user_id=$1 LIMIT 1', [i]);
      if (!found.rows.length) await db.query('INSERT INTO halloween_ticket(user_id,source_key) SELECT $1,$2 FROM generate_series(1,$3::int)', [i, `demo:${i}`, i % 4 + 1]);
    }
    const state = initialState();
    await db.query('INSERT INTO halloween_live.events(id,state) VALUES($1,$2) ON CONFLICT DO NOTHING', [EVENT_ID, JSON.stringify(state)]);
    return { exclusive, close: () => db.close(), demo: true };
  }
  if (mode !== 'live' || !url) throw new Error('Set LIVE_MODE=demo or configure LIVE_DATABASE_URL explicitly.');
  const pool = new pg.Pool({ connectionString: url, max: 8, application_name: 'pivnik-halloween-live', statement_timeout: 15000 });
  // Fail closed: no migrations, no fixture creation and no fallback in LIVE mode.
  try {
    const r = await pool.query('SELECT id,state FROM halloween_live.events WHERE id=$1', [EVENT_ID]);
    if (r.rows.length !== 1 || r.rows[0].state.mode !== 'live') throw new Error('Manual live migration/event initialization required.');
  } catch (error) { await pool.end(); throw error; }
  return {
    demo: false,
    exclusive: async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } },
    close: () => pool.end()
  };
}

export const makeId = () => randomBytes(16).toString('hex');
