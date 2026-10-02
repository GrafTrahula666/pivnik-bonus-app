import { evotorConfig, fetchEvotorPage } from './evotor-client.js';
import { importEvotorPage, posConnectionStatus } from './repository.js';

export async function syncEvotor({ pool, config = evotorConfig(), fetchPage = fetchEvotorPage, maxPages = 20, now = () => new Date() }) {
  const status = await posConnectionStatus(pool, config);
  if (['not_connected', 'schema_required'].includes(status.state)) throw Object.assign(new Error('Подключение Эвотора не подготовлено.'), { statusCode: 503, code: status.state });
  const db = await pool.connect();
  let locked = false, inTransaction = false;
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock(hashtext('pivnik-evotor'),hashtext($1)) AS locked", [config.storeId])).rows[0].locked;
    if (!locked) return { busy: true };
    const saved = (await db.query('SELECT cursor,scan_until FROM pos_sync_state WHERE store_id=$1', [config.storeId])).rows[0];
    let cursor = saved?.cursor || null;
    const until = cursor ? saved.scan_until : now().toISOString();
    let imported = 0;
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
      const page = await fetchPage({ token: config.token, storeId: config.storeId, cursor, until });
      await db.query('BEGIN'); inTransaction = true;
      const result = await importEvotorPage(db, config.storeId, page, { until, cursor });
      await db.query('COMMIT'); inTransaction = false;
      imported += result.imported; cursor = result.cursor;
      if (!cursor) return { imported, complete: true };
    }
    return { imported, complete: false };
  } catch (error) {
    if (inTransaction) await db.query('ROLLBACK');
    const safeCodes = new Set(['network','token_expired','not_installed','forbidden','rate_limit','invalid_cursor','invalid_response','api_error']);
    const code = safeCodes.has(error.code) ? error.code : 'invalid_document';
    if (locked) await db.query(`INSERT INTO pos_sync_state(store_id,last_error_code) VALUES($1,$2)
      ON CONFLICT(store_id) DO UPDATE SET last_error_code=$2,updated_at=NOW(),
      cursor=CASE WHEN $2='invalid_cursor' THEN NULL ELSE pos_sync_state.cursor END`, [config.storeId, code]);
    throw Object.assign(new Error('Синхронизация Эвотора остановлена: ' + code), { statusCode: 502, code });
  } finally {
    try {
      if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('pivnik-evotor'),hashtext($1))", [config.storeId]);
    } finally { db.release(); }
  }
}
