import { posError } from './scope.js';

const RECEIPT = /^[A-Za-z0-9-]{1,200}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const unavailable = () => posError(503, 'pos_redemption_unavailable', 'Списание баллов временно недоступно. Можно оплатить чек без списания.');
const conflict = (message) => posError(409, 'pos_redemption_conflict', message);
const safe = (value) => Number.isSafeInteger(value) && value >= 0;

export async function redemptionSchemaReady(db) {
  return Boolean((await db.query(`SELECT to_regclass('public.pos_redemptions') IS NOT NULL
    AND to_regclass('public.pos_redemption_refunds') IS NOT NULL
    AND to_regclass('public.pos_redemption_cancellations') IS NOT NULL AS ready`)).rows[0]?.ready);
}

function input(body) {
  if (!body || !RECEIPT.test(body.receiptUuid || '') || typeof body.receiptUuid !== 'string'
      || !['quote','reserve','status','cancel'].includes(body.action)) throw posError(400, 'invalid_redemption', 'Проверьте параметры списания.');
  if (['quote','reserve'].includes(body.action) && (!safe(body.totalCents) || body.totalCents < 1
      || !/^[a-f0-9]{64}$/.test(body.basketHash || '') || typeof body.clientId !== 'string')) {
    throw posError(400, 'invalid_redemption', 'Нужны клиент и актуальная сумма чека.');
  }
  if (['reserve','cancel'].includes(body.action) && !UUID.test(body.operationId || '')) {
    throw posError(400, 'invalid_redemption', 'Нужен постоянный идентификатор операции.');
  }
  if (body.action === 'reserve' && (!safe(body.points) || body.points < 1)) {
    throw posError(400, 'invalid_redemption', 'Введите целое число баллов.');
  }
}

async function lockReceipt(db, storeId, receiptUuid) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-bonus:${storeId}:${receiptUuid}`]);
}

async function wallet(db, clientId, policy, activeOnly = true) {
  if (!policy || typeof policy.isUnlimited !== 'function') throw unavailable();
  const user = (await db.query(activeOnly ? `SELECT id,telegram_id,role,unlimited_bonus FROM users WHERE id=$1
    AND deleted_at IS NULL AND merged_into_user_id IS NULL FOR UPDATE` : `WITH RECURSIVE identity_path AS (
      SELECT id,merged_into_user_id,ARRAY[id] AS visited FROM users WHERE id=$1
      UNION ALL SELECT u.id,u.merged_into_user_id,p.visited||u.id FROM users u
        JOIN identity_path p ON u.id=p.merged_into_user_id
        WHERE cardinality(p.visited)<32 AND NOT u.id=ANY(p.visited)
    ) SELECT u.id,u.telegram_id,u.role,u.unlimited_bonus FROM users u
      WHERE u.id=(SELECT id FROM identity_path WHERE merged_into_user_id IS NULL LIMIT 1)
        AND u.merged_into_user_id IS NULL FOR UPDATE OF u`, [clientId])).rows[0];
  const row = user && (await db.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [user.id])).rows[0];
  if (!row || !safe(Number(row.balance))) throw unavailable();
  return { userId:user.id, balance: Number(row.balance), unlimited: Boolean(policy.isUnlimited(user)) };
}

function view(row) {
  return row ? { operationId: row.id, receiptUuid: row.receipt_uuid, clientId: String(row.client_id),
    points: Number(row.points), totalCents: Number(row.total_cents), basketHash: row.basket_hash, state: row.state } : null;
}

// The reservation immediately reduces AVAILABLE balance under the same wallet
// lock used by staff/wheel. A separate invisible hold would permit double spend.
// Adjustment entries have no purchase amount and cannot be cancelled by the
// generic purchase-cancel endpoint. The reservation owns their lifecycle.
async function adjustment(db, row, balanceAfter, credit, suffix, reason) {
  return (await db.query(`INSERT INTO transactions(request_key,client_id,staff_id,mode,status,
      bonus_spent,bonus_earned,balance_after,reason,completed_at)
    VALUES($1,$2,NULL,'adjustment','completed',$3,$4,$5,$6,NOW()) RETURNING id`,
  [`evotor-redemption:${row.id}:${suffix}`, row.client_id, credit ? 0 : row.points,
    credit ? row.points : 0, balanceAfter, reason])).rows[0].id;
}

async function release(db, row, policy, reason) {
  const funds = await wallet(db, row.client_id, policy, false);
  const credited = row.wallet_debited ? Number(row.points) : 0;
  const after = funds.balance + credited;
  if (!safe(after)) throw unavailable();
  await adjustment(db, { ...row, client_id:funds.userId }, funds.unlimited ? policy.unlimitedBalance : after, true, 'release', reason);
  if (credited) await db.query('UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2', [after, funds.userId]);
  await db.query("UPDATE pos_redemptions SET state='released',review_reason=NULL,updated_at=NOW() WHERE id=$1", [row.id]);
  return { ...row, state: 'released' };
}

/** Authenticated device only; never accepts a QR-derived/supplied wallet balance. */
export async function deviceRedemption(pool, device, body, policy, enabled) {
  input(body);
  if (!await redemptionSchemaReady(pool)) throw unavailable();
  // Recovery remains available after switching new reservations off.
  if (['quote','reserve'].includes(body.action) && !enabled) throw unavailable();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockReceipt(db, device.store_id, body.receiptUuid);
    const rows = (await db.query(`SELECT * FROM pos_redemptions WHERE source='evotor' AND store_id=$1
      AND receipt_uuid=$2 AND (state<>'released' OR id::text=$3) ORDER BY created_at DESC FOR UPDATE`,
    [device.store_id, body.receiptUuid, body.operationId || ''])).rows;
    const existing = (body.action === 'cancel' ? rows.find(row => row.id === body.operationId) : rows.find(row => row.state !== 'released')) || rows[0];
    if (existing && String(existing.device_id) !== String(device.id)) throw conflict('Списание принадлежит другой кассе.');
    const closed = (await db.query(`SELECT document_id FROM pos_documents
      WHERE source='evotor' AND store_id=$1 AND document_id=$2`, [device.store_id, body.receiptUuid])).rows.length > 0;
    let answer;
    if (body.action === 'status') answer = { redemption: view(existing) };
    else if (body.action === 'cancel') {
      if (closed) throw conflict('Закрытый чек сверяется с Облаком Эвотора.');
      if (!existing) {
        if (body.effectRemoved !== true) throw conflict('Сначала удалите списание из открытого чека.');
        if ((await db.query('SELECT id FROM pos_redemptions WHERE id=$1', [body.operationId])).rows.length) throw conflict('Операция принадлежит другому чеку.');
        await db.query(`INSERT INTO pos_redemption_cancellations(id,store_id,receipt_uuid,device_id)
          VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [body.operationId, device.store_id, body.receiptUuid, device.id]);
        const tombstone = (await db.query('SELECT * FROM pos_redemption_cancellations WHERE id=$1', [body.operationId])).rows[0];
        if (tombstone.store_id !== device.store_id || tombstone.receipt_uuid !== body.receiptUuid || String(tombstone.device_id) !== String(device.id)) throw conflict('Операция принадлежит другому чеку.');
        answer = { redemption: null, cancelledOperationId: body.operationId };
      }
      else if (existing.id !== body.operationId) throw conflict('Операция не найдена.');
      else if (existing.state === 'released') answer = { redemption: view(existing) };
      else {
        if (existing.state !== 'reserved' || body.effectRemoved !== true) throw conflict('Сначала удалите списание из открытого чека.');
        answer = { redemption: view(await release(db, existing, policy, 'Возврат резерва: списание удалено из чека Эвотора')) };
      }
    } else {
      const claim = (await db.query(`SELECT client_id,device_id,updated_at FROM pos_receipt_claims
        WHERE source='evotor' AND store_id=$1 AND receipt_uuid=$2`, [device.store_id, body.receiptUuid])).rows[0];
      if (!claim || String(claim.device_id) !== String(device.id) || String(claim.client_id) !== body.clientId) {
        throw conflict('Сначала отсканируйте QR клиента в этом чеке.');
      }
      if (body.action === 'reserve' && existing?.id === body.operationId) {
        if (existing.state !== 'reserved' && existing.state !== 'committed') throw conflict('Эта операция уже завершена.');
        if (String(existing.client_id) !== body.clientId || Number(existing.points) !== body.points
          || Number(existing.total_cents) !== body.totalCents || existing.basket_hash !== body.basketHash) throw conflict('Повторный запрос изменил параметры списания.');
        answer = { redemption: view(existing) };
      } else {
        if (closed) throw conflict('Этот чек уже закрыт.');
        // Re-scanning refreshes the verified identity without rewriting the
        // original claimed_at used to reject claims made after cloud close.
        if (Date.now() - new Date(claim.updated_at).getTime() > 3 * 3600_000) throw conflict('Отсканируйте QR клиента ещё раз.');
        const funds = await wallet(db, claim.client_id, policy);
        const balance = funds.unlimited ? Number(policy.unlimitedBalance) : funds.balance;
        if (!safe(balance)) throw unavailable();
        const maximum = Math.min(balance, Number(BigInt(body.totalCents) * 30n / 10000n));
        if (body.action === 'quote') answer = { clientId: body.clientId, balance, unlimited: funds.unlimited,
          maxPoints: maximum, totalCents: body.totalCents, redemption: view(existing) };
        else {
          if ((await db.query('SELECT id FROM pos_redemption_cancellations WHERE id=$1', [body.operationId])).rows.length) throw conflict('Эта операция уже отменена.');
          if (existing && existing.state !== 'released') throw conflict('В этом чеке уже есть списание.');
          if (body.points > maximum) throw posError(409, 'pos_insufficient_points', 'Недостаточно баллов или превышен лимит 30% чека.');
          // Operation ids are globally unique: a lost response cannot create a second debit.
          if ((await db.query('SELECT id FROM pos_redemptions WHERE id=$1', [body.operationId])).rows.length) throw conflict('Идентификатор уже использован.');
          const row = { id: body.operationId, client_id: claim.client_id, points: body.points };
          const after = funds.unlimited ? balance : balance - body.points;
          const txId = await adjustment(db, row, after, false, 'reserve', 'Резерв баллов к чеку Эвотора');
          if (!funds.unlimited) await db.query('UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2', [after, claim.client_id]);
          const saved = (await db.query(`INSERT INTO pos_redemptions(id,store_id,receipt_uuid,device_id,client_id,
            points,total_cents,basket_hash,wallet_debited,transaction_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [row.id, device.store_id, body.receiptUuid, device.id, row.client_id, body.points, body.totalCents,
            body.basketHash, !funds.unlimited, txId])).rows[0];
          answer = { redemption: view(saved) };
        }
      }
    }
    await db.query('COMMIT');
    return answer;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    if (error.code === '23505') throw conflict('Операция уже существует. Повторите проверку.');
    throw error;
  } finally { db.release(); }
}

/** Called under the shared receipt advisory lock, before changing a claim. */
export async function guardRedemptionClaim(db, device, receiptUuid, clientId) {
  if (!await redemptionSchemaReady(db)) return;
  const row = (await db.query(`SELECT client_id,device_id FROM pos_redemptions WHERE source='evotor'
    AND store_id=$1 AND receipt_uuid=$2 AND state<>'released'`, [device.store_id, receiptUuid])).rows[0];
  if (row && (String(row.client_id) !== String(clientId) || String(row.device_id) !== String(device.id))) {
    throw conflict('Сначала отмените списание баллов предыдущего клиента.');
  }
}

async function settleSale(db, row, doc, policy) {
  const evidence = doc.snapshot?.pivnikRedemption;
  if (evidence?.operationId === row.id && evidence.points === Number(row.points) && evidence.documentDiscountCents === 0) {
    await release(db, row, policy, 'Возврат резерва: закрытый чек без скидки');
    return 'released';
  }
  const net = Number(doc.amount_cents), points = Number(row.points);
  if (!evidence || evidence.operationId !== row.id || evidence.points !== points
      || !safe(net) || net + points * 100 !== Number(row.total_cents)
      || !safe(evidence.documentDiscountCents) || evidence.documentDiscountCents < points * 100
      || BigInt(points) * 10000n > BigInt(net + points * 100) * 30n) {
    await db.query("UPDATE pos_redemptions SET state='review',review_reason='closed_effect_mismatch',updated_at=NOW() WHERE id=$1", [row.id]);
    return 'review';
  }
  await db.query("UPDATE pos_redemptions SET state='committed',review_reason=NULL,updated_at=NOW() WHERE id=$1", [row.id]);
  await db.query("UPDATE transactions SET reason='Списание баллов: закрытый чек Эвотора' WHERE id=$1", [row.transaction_id]);
  return 'committed';
}

async function refund(db, row, doc, policy) {
  const totals = (await db.query(`SELECT COALESCE(SUM(returned_cents),0)::bigint AS returned,
    COALESCE(SUM(points),0)::bigint AS points FROM pos_redemption_refunds WHERE redemption_id=$1`, [row.id])).rows[0];
  const paid = BigInt(row.total_cents) - BigInt(row.points) * 100n;
  const returned = BigInt(totals.returned) + BigInt(doc.amount_cents);
  // Cumulative floor, not per-return rounding: splitting a refund never creates points.
  const target = returned >= paid ? BigInt(row.points) : BigInt(row.points) * returned / paid;
  const due = Number(target - BigInt(totals.points));
  let txId = null;
  if (due > 0) {
    const funds = await wallet(db, row.client_id, policy, false);
    const after = funds.balance + (row.wallet_debited ? due : 0);
    if (!safe(after)) throw unavailable();
    txId = await adjustment(db, { ...row, client_id:funds.userId, points: due }, funds.unlimited ? policy.unlimitedBalance : after,
      true, `refund:${doc.document_id}`, 'Возврат списанных баллов по чеку Эвотора');
    if (row.wallet_debited) await db.query('UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2', [after, funds.userId]);
  }
  await db.query(`INSERT INTO pos_redemption_refunds(store_id,document_id,redemption_id,returned_cents,points,transaction_id)
    VALUES($1,$2,$3,$4,$5,$6)`, [doc.store_id, doc.document_id, row.id, doc.amount_cents, due, txId]);
  return 'refunded';
}

/** Cloud documents alone settle reservations. No expiry: an offline sale may arrive later. */
export async function processPosRedemptions(pool, { storeId, policy, limit = 50 }) {
  if (!await redemptionSchemaReady(pool)) return [];
  const candidates = (await pool.query(`SELECT r.id,d.document_id,d.type,r.receipt_uuid FROM pos_redemptions r
    JOIN pos_documents d ON d.source=r.source AND d.store_id=r.store_id
      AND ((d.type='SELL' AND d.document_id=r.receipt_uuid AND r.state='reserved')
        OR (d.type='PAYBACK' AND d.snapshot->>'baseDocumentId'=r.receipt_uuid AND r.state='committed'))
    WHERE r.store_id=$1 AND NOT EXISTS (SELECT 1 FROM pos_redemption_refunds f
      WHERE f.source=d.source AND f.store_id=d.store_id AND f.document_id=d.document_id)
    ORDER BY d.closed_at,d.document_id LIMIT $2`, [storeId, limit])).rows;
  const results = [];
  for (const candidate of candidates) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await lockReceipt(db, storeId, candidate.receipt_uuid);
      const row = (await db.query('SELECT * FROM pos_redemptions WHERE id=$1 FOR UPDATE', [candidate.id])).rows[0];
      const doc = (await db.query(`SELECT * FROM pos_documents WHERE source='evotor' AND store_id=$1 AND document_id=$2`, [storeId, candidate.document_id])).rows[0];
      let state;
      if (doc.type === 'SELL' && row.state === 'reserved') state = await settleSale(db, row, doc, policy);
      else if (doc.type === 'PAYBACK' && row.state === 'committed' && !(await db.query(`SELECT 1 FROM pos_redemption_refunds
        WHERE source='evotor' AND store_id=$1 AND document_id=$2`, [storeId, doc.document_id])).rows.length) state = await refund(db, row, doc, policy);
      await db.query('COMMIT');
      if (state) results.push({ documentId: doc.document_id, state });
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch {}
      results.push({ documentId: candidate.document_id, state: 'error', code: error.code || 'reconcile_failed' });
    } finally { db.release(); }
  }
  return results;
}
