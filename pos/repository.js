import { normalizeEvotorDocument } from './evotor-document.js';
import { resolvePersonalQrRecord } from '../qr-resolver.js';

export async function importEvotorPage(db, storeId, page, { until, cursor }) {
  // Caller owns a transaction: documents and cursor must commit together.
  let imported = 0;
  for (const raw of page.items) {
    const doc = normalizeEvotorDocument(raw, storeId);
    if (!doc) continue;
    const saved = await db.query(`INSERT INTO pos_documents(source,store_id,document_id,type,closed_at,amount_cents,snapshot)
      VALUES ('evotor',$1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT(source,store_id,document_id) DO UPDATE SET
      type=EXCLUDED.type,closed_at=EXCLUDED.closed_at,amount_cents=EXCLUDED.amount_cents,
      snapshot=EXCLUDED.snapshot,imported_at=NOW()
      WHERE pos_documents.type=EXCLUDED.type AND pos_documents.closed_at=EXCLUDED.closed_at
        AND pos_documents.amount_cents=EXCLUDED.amount_cents
        AND pos_documents.snapshot=EXCLUDED.snapshot RETURNING document_id`,
    [storeId, doc.documentId, doc.type, doc.closedAt, doc.amountCents, JSON.stringify(doc)]);
    // A closed document cannot silently change fiscal count, return ancestry,
    // client eligibility or payment/product projections on a repeated delivery.
    if (!saved.rows.length) throw Object.assign(new Error('Конфликт финансовых данных закрытого документа.'), { code: 'document_conflict', statusCode: 409 });
    imported++;
  }
  const next = page.paging?.next_cursor || null;
  if (next && next === cursor) throw Object.assign(new Error('Курсор Эвотора не продвинулся.'), { code: 'invalid_cursor' });
  await db.query(`INSERT INTO pos_sync_state(store_id,cursor,scan_until,last_success_at,last_error_code)
    VALUES($1,$2,$3,CASE WHEN $2::text IS NULL THEN NOW() ELSE NULL END,NULL)
    ON CONFLICT(store_id) DO UPDATE SET cursor=EXCLUDED.cursor,scan_until=EXCLUDED.scan_until,
    last_success_at=COALESCE(EXCLUDED.last_success_at,pos_sync_state.last_success_at),last_error_code=NULL,updated_at=NOW()`,
  [storeId, next, until]);
  return { imported, cursor: next };
}

export async function linkEvotorCustomer(db, { storeId, documentId, qr, actorId }) {
  const result = await db.query(`SELECT type,snapshot FROM pos_documents
    WHERE source='evotor' AND store_id=$1 AND document_id=$2 FOR UPDATE`, [storeId, documentId]);
  if (!result.rows[0]) throw Object.assign(new Error('Документ не найден.'), { statusCode: 404 });
  if (result.rows[0].type !== 'SELL' || !result.rows[0].snapshot.linkable) {
    throw Object.assign(new Error('Связать можно только продажу с одним подтверждённым чеком.'), { statusCode: 409 });
  }
  const client = await resolvePersonalQrRecord(db, qr);
  if (!client) throw Object.assign(new Error('QR клиента не найден или отозван.'), { statusCode: 404 });
  const active = await db.query('SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL AND merged_into_user_id IS NULL', [client.id]);
  if (!active.rows.length) throw Object.assign(new Error('Профиль недоступен.'), { statusCode: 404 });
  await db.query(`INSERT INTO pos_customer_links(source,store_id,document_id,client_id,confirmed_by)
    VALUES('evotor',$1,$2,$3,$4) ON CONFLICT DO NOTHING`, [storeId, documentId, client.id, actorId]);
  const link = (await db.query(`SELECT client_id,confirmed_by,confirmed_at FROM pos_customer_links
    WHERE source='evotor' AND store_id=$1 AND document_id=$2`, [storeId, documentId])).rows[0];
  if (String(link.client_id) !== String(client.id)) throw Object.assign(new Error('Документ уже связан с другим клиентом.'), { statusCode: 409 });
  return { ok: true, clientId: String(client.id), confirmedBy: String(link.confirmed_by), confirmedAt: link.confirmed_at };
}

export async function posConnectionStatus(db, config) {
  if (!config.enabled || (!config.readOnly && !config.token) || !config.storeId) return { state: 'not_connected', lastSuccessAt: null };
  const schema = await db.query("SELECT to_regclass('public.pos_documents') AS ready");
  if (!schema.rows[0]?.ready) return { state: 'schema_required', lastSuccessAt: null };
  const state = (await db.query('SELECT * FROM pos_sync_state WHERE store_id=$1', [config.storeId])).rows[0];
  return { state: state?.last_error_code ? 'error' : state?.cursor ? 'syncing' : state?.last_success_at ? 'connected' : 'awaiting_sync',
    lastSuccessAt: state?.last_success_at || null, errorCode: state?.last_error_code || null,
    scanUntil: state?.scan_until || null, historyComplete: Boolean(state?.last_success_at) && !state?.cursor };
}

export async function loadPosDocuments(db, storeId, period) {
  // A return inherits identity only through Evotor's explicit base_document_id.
  // Deleted/merged profiles and split sales remain outside the linked cohort.
  const result = await db.query(`SELECT d.snapshot,
      CASE WHEN d.type='SELL' AND (d.snapshot->>'linkable')::boolean THEN u.id
        WHEN d.type='PAYBACK' THEN bu.id END AS client_id
    FROM pos_documents d
    LEFT JOIN pos_customer_links l ON l.source=d.source AND l.store_id=d.store_id AND l.document_id=d.document_id
    LEFT JOIN users u ON u.id=l.client_id AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL
    LEFT JOIN pos_documents base ON d.type='PAYBACK' AND base.type='SELL'
      AND base.source=d.source AND base.store_id=d.store_id AND base.document_id=d.snapshot->>'baseDocumentId'
      AND (base.snapshot->>'linkable')::boolean
    LEFT JOIN pos_customer_links base_link ON base_link.source=base.source AND base_link.store_id=base.store_id AND base_link.document_id=base.document_id
    LEFT JOIN users bu ON bu.id=base_link.client_id AND bu.deleted_at IS NULL AND bu.merged_into_user_id IS NULL
    WHERE d.store_id=$1 AND d.source='evotor' AND d.closed_at >= $2 AND d.closed_at < $3
    ORDER BY d.closed_at DESC,d.document_id`, [storeId, period.from, period.until]);
  return result.rows.map((row) => ({ ...row.snapshot, clientId: row.client_id == null ? null : String(row.client_id) }));
}
