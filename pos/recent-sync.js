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
  let locked = false, inTransaction = false, imported = 0, cursor = null;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(hashtext('pivnik-evotor-recent'),hashtext($1)) AS locked", [config.storeId])).rows[0].locked;
    if (!locked) return { busy: true };
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await fetchPage({ token: config.token, storeId: config.storeId, cursor, until, since });
      const next = page.paging?.next_cursor || null;
      if (next && next === cursor) throw Object.assign(new Error('Evotor cursor did not advance.'), { code: 'invalid_cursor' });
      await db.query('BEGIN'); inTransaction = true;
      const result = await importEvotorDocuments(db, config.storeId, page.items);
      await db.query('COMMIT'); inTransaction = false;
      imported += result.imported; cursor = next;
      if (!cursor) return { imported, complete: true };
    }
    return { imported, complete: false };
  } catch (error) {
    if (inTransaction) await db.query('ROLLBACK');
    throw error;
  } finally {
    try {
      if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('pivnik-evotor-recent'),hashtext($1))", [config.storeId]);
    } finally { db.release(); }
  }
}
