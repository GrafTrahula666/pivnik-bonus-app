import { evotorConfig } from './evotor-client.js';
import { moscowPeriod } from './evotor-document.js';
import { loadPosDocuments, linkEvotorCustomer, posConnectionStatus } from './repository.js';
import { posDashboards } from './analytics.js';
import { syncEvotor } from './sync.js';

export function assertPosRole(user, write = false) {
  if (!user?.id) throw Object.assign(new Error('Требуется авторизация.'), { statusCode: 401 });
  if (!(write ? ['admin'] : ['admin', 'viewer']).includes(user.role)) throw Object.assign(new Error('Недостаточно прав.'), { statusCode: 403 });
}

export function createPosService(pool, config = evotorConfig()) {
  return {
    async dashboard(user, params) {
      assertPosRole(user);
      const period = moscowPeriod(params);
      const manual = (await pool.query(`SELECT
        (SELECT COUNT(*) FROM users WHERE merged_into_user_id IS NULL AND deleted_at IS NULL)::int AS clients,
        COUNT(*)::int AS operations, COALESCE(SUM(check_amount_cents),0)::text AS check_cents
        FROM transactions WHERE status='completed' AND created_at >= $1 AND created_at < $2`, [period.from, period.until])).rows[0];
      const connection = await posConnectionStatus(pool, config);
      const readable = Boolean(connection.lastSuccessAt) && !['not_connected','schema_required'].includes(connection.state);
      const documents = readable ? await loadPosDocuments(pool, config.storeId, period) : [];
      const metrics = readable ? posDashboards(documents) : { all: null, app: null, linkedRevenueSharePercent: null };
      return { period, connection, ...metrics,
        manual: { clients: manual.clients, operations: manual.operations, checkCents: manual.check_cents, source: 'Журнал приложения — записи сотрудников, без подтверждения кассой' },
        documents: documents.slice(0, 100).map((d) => ({ documentId: d.documentId, number: d.number,
          closedAt: d.closedAt, amountCents: String(d.amountCents), type: d.type, clientId: d.clientId,
          linkable: d.linkable, receiptCount: d.receiptCount, fiscal: d.fiscal })), documentsTruncated: documents.length > 100 };
    },
    async sync(user) { assertPosRole(user, true); return syncEvotor({ pool, config }); },
    async link(user, body) {
      assertPosRole(user, true);
      if (!config.enabled || !config.storeId || !config.token) throw Object.assign(new Error('Касса не подключена.'), { statusCode: 503 });
      if (typeof body.documentId !== 'string' || body.documentId.length > 200 || typeof body.qr !== 'string' || body.qr.length > 2048) throw Object.assign(new Error('Нужны ID документа и QR.'), { statusCode: 400 });
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const result = await linkEvotorCustomer(db, { storeId: config.storeId, documentId: body.documentId, qr: body.qr, actorId: user.id });
        await db.query('COMMIT'); return result;
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      finally { db.release(); }
    }
  };
}
