import { evotorConfig } from './evotor-client.js';
import { moscowPeriod } from './evotor-document.js';
import { loadPosDocuments, linkEvotorCustomer, posConnectionStatus } from './repository.js';
import { posDashboards } from './analytics.js';
import { syncEvotor } from './sync.js';
import { posError, resolveOperatorStore } from './scope.js';

export function assertPosRole(user, write = false) {
  if (!user?.id) throw Object.assign(new Error('Требуется авторизация.'), { statusCode: 401 });
  if (!(write ? ['admin'] : ['admin', 'viewer']).includes(user.role)) throw Object.assign(new Error('Недостаточно прав.'), { statusCode: 403 });
}

export function createPosService(pool, config = evotorConfig()) {
  return {
    async dashboard(user, params = {}) {
      assertPosRole(user);
      const period = moscowPeriod(params);
      if (!config.enabled) return { period, connection: { state: 'not_connected', lastSuccessAt: null }, all: null, app: null, documents: [], documentsTruncated: false };
      const scope = await resolveOperatorStore(pool, user, params?.storeId || config.storeId, false, params);
      const scopedConfig = { ...config, storeId: scope.storeId };
      const connection = await posConnectionStatus(pool, scopedConfig);
      const readable = Boolean(connection.lastSuccessAt) && !['not_connected','schema_required'].includes(connection.state);
      const documents = readable ? await loadPosDocuments(pool, scope.storeId, period) : [];
      const metrics = readable ? posDashboards(documents) : { all: null, app: null, linkedRevenueSharePercent: null };
      return { period, scope, connection, ...metrics,
        documents: documents.slice(0, 100).map((d) => ({ documentId: d.documentId, number: d.number,
          closedAt: d.closedAt, amountCents: String(d.amountCents), type: d.type, clientId: d.clientId,
          linkable: d.linkable, receiptCount: d.receiptCount, fiscal: d.fiscal })), documentsTruncated: documents.length > 100 };
    },
    async sync(user, body = {}) {
      assertPosRole(user, true);
      if (!config.enabled) throw posError(503, 'pos_disabled', 'POS-подключение выключено.');
      const scope = await resolveOperatorStore(pool, user, body.storeId || config.storeId, true, body);
      if (scope.storeId !== config.storeId) throw posError(503, 'provider_not_configured', 'Для этой кассы не настроен доступ к Эвотору.');
      return syncEvotor({ pool, config, maxPages: 1 });
    },
    async link(user, body) {
      assertPosRole(user, true);
      if (!config.enabled || !config.storeId || !config.token) throw Object.assign(new Error('Касса не подключена.'), { statusCode: 503 });
      if (!body || typeof body.documentId !== 'string' || !body.documentId.trim() || body.documentId.length > 200 || typeof body.qr !== 'string' || !body.qr.trim() || body.qr.length > 2048) throw Object.assign(new Error('Нужны ID документа и QR.'), { statusCode: 400 });
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const scope = await resolveOperatorStore(db, user, body.storeId || config.storeId, true, body);
        const result = await linkEvotorCustomer(db, { storeId: scope.storeId, documentId: body.documentId, qr: body.qr, actorId: user.id });
        await db.query('COMMIT'); return result;
      } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
      finally { db.release(); }
    }
  };
}
