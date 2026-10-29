import { evotorConfig, fetchEvotorPage } from './evotor-client.js';
import { importEvotorDocuments, posConnectionStatus } from './repository.js';
import { requireConfiguredStore } from './scope.js';

// Fresh receipts must not wait behind a failed/interrupted historical cursor.
// This overlapping, bounded window uses the SAME document projection and never
// changes the historical cursor or claims a completed historical scan.
export async function syncEvotorRecent({ pool, config = evotorConfig(), fetchPage = fetchEvotorPage,
  maxPages = 5, now = () => new Date() }) {
  const status = await posConnectionStatus(pool, config);
  if (['not_connected', 'schema_required'].includes(status.state)) {
    throw Object.assign(new Error('Evotor connection is not ready.'), { code: status.state });
  }
  await requireConfiguredStore(pool, config.storeId);
  const until = now().toISOString();
  const since = new Date(Date.parse(until) - 2 * 86400_000).toISOString();
  const db = await pool.connect();
  let locked = false, inTransaction = false, imported = 0, cursor = null, pages = 0, observationReady = false;
  // Optional, non-fiscal telemetry. Its absence/failure must NEVER change receipt
  // ingestion, historical cursor, wallets or bonus processing. Caller retains the
  // existing store lock; observations are made only after each page has committed.
  const observe = async state => {
    if (!observationReady) return;
    try {
      await db.query(`INSERT INTO pos_recent_sync_status(store_id,state,since_at,until_at,pages,cursor_pending,last_error_code,last_success_at,success_since,success_until)
        VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $2='complete' THEN NOW() END,CASE WHEN $2='complete' THEN $3::timestamptz END,CASE WHEN $2='complete' THEN $4::timestamptz END)
        ON CONFLICT(store_id) DO UPDATE SET state=EXCLUDED.state,since_at=EXCLUDED.since_at,until_at=EXCLUDED.until_at,
        pages=EXCLUDED.pages,cursor_pending=EXCLUDED.cursor_pending,last_error_code=EXCLUDED.last_error_code,updated_at=NOW(),
        last_success_at=COALESCE(EXCLUDED.last_success_at,pos_recent_sync_status.last_success_at),
        success_since=COALESCE(EXCLUDED.success_since,pos_recent_sync_status.success_since),
        success_until=COALESCE(EXCLUDED.success_until,pos_recent_sync_status.success_until)`,
      [config.storeId,state,since,until,pages,Boolean(cursor),state==='error'?'scan_failed':null]);
    } catch { observationReady = false; console.warn('Evotor recent sync observation unavailable'); }
  };
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(hashtext('pivnik-evotor-recent'),hashtext($1)) AS locked", [config.storeId])).rows[0].locked;
    if (!locked) return { busy: true };
    try { observationReady = Boolean((await db.query("SELECT to_regclass('public.pos_recent_sync_status') IS NOT NULL AS ready")).rows[0]?.ready); } catch { observationReady = false; }
    await observe('running');
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await fetchPage({ token: config.token, storeId: config.storeId, cursor, until, since });
      const next = page.paging?.next_cursor || null;
      if (next && next === cursor) throw Object.assign(new Error('Evotor cursor did not advance.'), { code: 'invalid_cursor' });
      await db.query('BEGIN'); inTransaction = true;
      const result = await importEvotorDocuments(db, config.storeId, page.items);
      await db.query('COMMIT'); inTransaction = false;
      imported += result.imported; cursor = next; pages++;
      if (!cursor) { await observe('complete'); return { imported, complete: true }; }
    }
    await observe('incomplete');
    return { imported, complete: false };
  } catch (error) {
    if (inTransaction) await db.query('ROLLBACK');
    await observe('error');
    throw error;
  } finally {
    try {
      if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('pivnik-evotor-recent'),hashtext($1))", [config.storeId]);
    } finally { db.release(); }
  }
}
