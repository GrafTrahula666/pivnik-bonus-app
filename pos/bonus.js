import { resolvePersonalQrRecord } from '../qr-resolver.js';
import { posError } from './scope.js';

// The till may only say WHO was scanned into WHICH open receipt. How much was paid
// comes exclusively from the closed cloud document, so a leaked device key can at
// worst attribute a real sale to a client whose QR it holds, never mint bonuses.
const CLAIM_AFTER_CLOSE_SLACK = "INTERVAL '15 minutes'";
const RECEIPT_UUID = /^[A-Za-z0-9-]{1,200}$/;

export function posBonusConfig(env = process.env) {
  const seconds = Number(env.PIVNIK_POS_SYNC_SECONDS || 120);
  return {
    enabled: env.PIVNIK_POS_BONUS_ENABLED === 'true',
    syncSeconds: Number.isFinite(seconds) ? Math.max(30, Math.floor(seconds)) : 120
  };
}

export async function requirePosBonusSchema(db) {
  const result = await db.query(`SELECT to_regclass('public.pos_receipt_claims') IS NOT NULL
    AND to_regclass('public.pos_bonus_accruals') IS NOT NULL AS ready`);
  if (!result.rows[0]?.ready) throw posError(503, 'schema_required', 'Начисление по кассе ожидает подготовки базы.');
}

export async function claimReceipt(pool, device, body) {
  if (!body || typeof body.receiptUuid !== 'string' || !RECEIPT_UUID.test(body.receiptUuid)) {
    throw posError(400, 'invalid_receipt', 'Нужен UUID открытого чека.');
  }
  if (typeof body.payload !== 'string' || !body.payload || body.payload.length > 2048) {
    throw posError(400, 'invalid_qr', 'Нужен QR клиента.');
  }
  await requirePosBonusSchema(pool);
  const record = await resolvePersonalQrRecord(pool, body.payload);
  if (!record) throw posError(404, 'qr_not_found', 'QR не найден или отозван.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const user = (await db.query(`SELECT id,first_name FROM users
      WHERE id=$1 AND deleted_at IS NULL AND merged_into_user_id IS NULL`, [record.id])).rows[0];
    if (!user) throw posError(404, 'qr_not_found', 'QR не найден или отозван.');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-bonus:${device.store_id}:${body.receiptUuid}`]);
    const decided = (await db.query(`SELECT client_id FROM pos_bonus_accruals
      WHERE source='evotor' AND store_id=$1 AND document_id=$2`, [device.store_id, body.receiptUuid])).rows[0];
    if (decided && String(decided.client_id) !== String(user.id)) {
      throw posError(409, 'receipt_already_settled', 'Бонусы за этот чек уже начислены другому клиенту.');
    }
    if (!decided) {
      // The bridge only re-binds after its own double-scan confirmation, so the latest bind wins.
      // Moving the receipt to another client counts as a new claim for the after-close check.
      await db.query(`INSERT INTO pos_receipt_claims(store_id,receipt_uuid,client_id,device_id)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(source,store_id,receipt_uuid) DO UPDATE
        SET claimed_at=CASE WHEN pos_receipt_claims.client_id=EXCLUDED.client_id THEN pos_receipt_claims.claimed_at ELSE NOW() END,
          client_id=EXCLUDED.client_id,device_id=EXCLUDED.device_id,updated_at=NOW()`,
      [device.store_id, body.receiptUuid, user.id, device.id]);
    }
    await db.query('COMMIT');
    return { client: { id: String(user.id), firstName: user.first_name || '' } };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    throw error;
  } finally { db.release(); }
}

async function pendingDocuments(db, storeId, limit) {
  return (await db.query(`SELECT d.document_id,d.type FROM pos_documents d
    LEFT JOIN pos_bonus_accruals a ON a.source=d.source AND a.store_id=d.store_id AND a.document_id=d.document_id
    WHERE d.source='evotor' AND d.store_id=$1 AND a.document_id IS NULL AND (
      (d.type='SELL' AND EXISTS (SELECT 1 FROM pos_receipt_claims c
        WHERE c.source=d.source AND c.store_id=d.store_id AND c.receipt_uuid=d.document_id))
      OR (d.type='PAYBACK' AND EXISTS (SELECT 1 FROM pos_bonus_accruals b
        WHERE b.source=d.source AND b.store_id=d.store_id AND b.kind='accrue' AND b.status='applied'
          AND b.document_id=d.snapshot->>'baseDocumentId')))
    ORDER BY d.closed_at,d.document_id LIMIT $2`, [storeId, limit])).rows;
}

async function skip(db, doc, kind, clientId, reason, baseDocumentId = null) {
  await db.query(`INSERT INTO pos_bonus_accruals(source,store_id,document_id,kind,client_id,base_document_id,bonus_delta,status,skip_reason)
    VALUES('evotor',$1,$2,$3,$4,$5,0,'skipped',$6)`, [doc.store_id, doc.document_id, kind, clientId, baseDocumentId, reason]);
  return { documentId: doc.document_id, kind, status: 'skipped', reason };
}

async function lockedClient(db, clientId) {
  const user = (await db.query(`SELECT id,telegram_id,first_name,role,unlimited_bonus,username FROM users
    WHERE id=$1 AND deleted_at IS NULL AND merged_into_user_id IS NULL FOR UPDATE`, [clientId])).rows[0];
  const wallet = user && (await db.query('SELECT balance FROM wallets WHERE user_id=$1 FOR UPDATE', [clientId])).rows[0];
  return { user, wallet };
}

async function accrueSale(db, doc, ledger) {
  const claim = (await db.query(`SELECT c.client_id,(c.claimed_at <= d.closed_at + ${CLAIM_AFTER_CLOSE_SLACK}) AS in_time
    FROM pos_receipt_claims c JOIN pos_documents d ON d.source=c.source AND d.store_id=c.store_id AND d.document_id=c.receipt_uuid
    WHERE c.source='evotor' AND c.store_id=$1 AND c.receipt_uuid=$2`, [doc.store_id, doc.document_id])).rows[0];
  if (!claim.in_time) return skip(db, doc, 'accrue', claim.client_id, 'claim_after_close');
  const { user, wallet } = await lockedClient(db, claim.client_id);
  if (!user) return skip(db, doc, 'accrue', claim.client_id, 'client_unavailable');
  if (!wallet) return skip(db, doc, 'accrue', claim.client_id, 'wallet_missing');
  const amountCents = Number(doc.amount_cents);
  if (!(amountCents > 0)) return skip(db, doc, 'accrue', user.id, 'zero_amount');

  const status = await ledger.status(db, user);
  // Same formula as a manual staff accrual. No status discount is applied: the till
  // charged the full amount, so the bonus base is everything the guest paid.
  const bonus = Math.max(0, Math.floor((amountCents * status.bonusPercent) / 10_000));
  const unlimited = ledger.isUnlimited(user);
  const balanceAfter = unlimited ? ledger.unlimitedBalance : Number(wallet.balance || 0) + bonus;
  const number = doc.snapshot?.number ? ` №${String(doc.snapshot.number).slice(0, 40)}` : '';
  const transaction = (await db.query(`INSERT INTO transactions(
      request_key,client_id,staff_id,mode,status,check_amount_cents,discount_cents,bonus_spent,bonus_earned,
      cash_paid_cents,balance_after,is_suspicious,beer_ml,beer_gift_earned_ml,reason,completed_at)
    VALUES($1,$2,NULL,'accrue','completed',$3,0,0,$4,$3,$5,$6,0,0,$7,NOW()) RETURNING *`,
  [`evotor:${doc.store_id}:${doc.document_id}`, user.id, amountCents, bonus, balanceAfter,
    amountCents > ledger.suspiciousThresholdCents, `Касса Эвотор: чек${number}`])).rows[0];
  if (!unlimited) await db.query('UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2', [balanceAfter, user.id]);
  await db.query(`INSERT INTO pos_bonus_accruals(source,store_id,document_id,kind,client_id,transaction_id,bonus_delta,status)
    VALUES('evotor',$1,$2,'accrue',$3,$4,$5,'applied')`, [doc.store_id, doc.document_id, user.id, transaction.id, bonus]);
  return { documentId: doc.document_id, kind: 'accrue', status: 'applied', bonus, balanceAfter, amountCents, user, transaction };
}

async function reverseReturn(db, doc, ledger) {
  const baseId = doc.snapshot?.baseDocumentId;
  // Locks the sale's transaction so an admin cancel cannot run between this check and the reversal.
  const base = (await db.query(`SELECT a.client_id,a.transaction_id,a.bonus_delta,d.amount_cents,t.status AS sale_status
    FROM pos_bonus_accruals a JOIN pos_documents d ON d.source=a.source AND d.store_id=a.store_id AND d.document_id=a.document_id
    JOIN transactions t ON t.id=a.transaction_id
    WHERE a.source='evotor' AND a.store_id=$1 AND a.document_id=$2 AND a.kind='accrue' AND a.status='applied'
    FOR UPDATE OF t`, [doc.store_id, baseId])).rows[0];
  // An admin already cancelled the sale's bonus: there is nothing left to take back.
  if (base.sale_status !== 'completed') return skip(db, doc, 'reverse', base.client_id, 'base_cancelled', baseId);
  const earned = Number(base.bonus_delta);
  const baseAmount = Number(base.amount_cents);
  const returned = Number(doc.amount_cents);
  const settled = Number((await db.query(`SELECT COALESCE(SUM(shortfall - bonus_delta),0)::bigint AS n FROM pos_bonus_accruals
    WHERE source='evotor' AND store_id=$1 AND base_document_id=$2 AND kind='reverse'`, [doc.store_id, baseId])).rows[0].n);
  const due = Math.min(earned - settled, baseAmount > 0 ? Math.ceil((earned * returned) / baseAmount) : earned);
  // A partial return also leaves the 12-month spend that sets the guest's status.
  const reduceSpend = () => db.query(`UPDATE transactions SET cash_paid_cents=GREATEST(0,cash_paid_cents-$1)
    WHERE id=$2 AND status='completed'`, [returned, base.transaction_id]);
  if (!(due > 0)) {
    await reduceSpend();
    return skip(db, doc, 'reverse', base.client_id, 'nothing_to_reverse', baseId);
  }
  const { user, wallet } = await lockedClient(db, base.client_id);
  if (!user || !wallet) return skip(db, doc, 'reverse', base.client_id, 'client_unavailable', baseId);
  const number = doc.snapshot?.number ? ` №${String(doc.snapshot.number).slice(0, 40)}` : '';
  const reason = `Возврат по кассе Эвотор: чек${number}`;

  if (settled === 0 && returned >= baseAmount) {
    // A full return undoes the purchase itself (bonus, 12-month spend, Halloween tickets)
    // when the bonus is still on the balance; otherwise fall through to a capped adjustment.
    try {
      const cancelled = await ledger.cancel(db, base.transaction_id, reason, `evotor-return:${doc.store_id}:${doc.document_id}`);
      await db.query(`INSERT INTO pos_bonus_accruals(source,store_id,document_id,kind,client_id,transaction_id,base_document_id,bonus_delta,status)
        VALUES('evotor',$1,$2,'reverse',$3,$4,$5,$6,'applied')`, [doc.store_id, doc.document_id, user.id, cancelled.id, baseId, -earned]);
      const balanceAfter = ledger.isUnlimited(user) ? ledger.unlimitedBalance : Number(wallet.balance || 0) - earned;
      return { documentId: doc.document_id, kind: 'reverse', status: 'applied', removed: earned, shortfall: 0, balanceAfter, user, cancelledTransactionId: cancelled.id };
    } catch (error) {
      if (error.statusCode !== 409) throw error;
    }
  }

  await reduceSpend();
  const unlimited = ledger.isUnlimited(user);
  const balance = unlimited ? ledger.unlimitedBalance : Number(wallet.balance || 0);
  const removed = unlimited ? due : Math.min(due, Math.max(0, balance));
  const shortfall = due - removed;
  const balanceAfter = unlimited ? balance : balance - removed;
  let transactionId = null;
  if (removed > 0) {
    transactionId = (await db.query(`INSERT INTO transactions(request_key,client_id,staff_id,mode,status,bonus_spent,bonus_earned,balance_after,reason,completed_at)
      VALUES($1,$2,NULL,'adjustment','completed',$3,0,$4,$5,NOW()) RETURNING id`,
    [`evotor-return:${doc.store_id}:${doc.document_id}`, user.id, removed, balanceAfter, reason])).rows[0].id;
    if (!unlimited) await db.query('UPDATE wallets SET balance=$1,updated_at=NOW() WHERE user_id=$2', [balanceAfter, user.id]);
  }
  await db.query(`INSERT INTO pos_bonus_accruals(source,store_id,document_id,kind,client_id,transaction_id,base_document_id,bonus_delta,shortfall,status)
    VALUES('evotor',$1,$2,'reverse',$3,$4,$5,$6,$7,'applied')`, [doc.store_id, doc.document_id, user.id, transactionId, baseId, -removed, shortfall]);
  return { documentId: doc.document_id, kind: 'reverse', status: 'applied', removed, shortfall, balanceAfter, user };
}

/**
 * Settles every closed document that has a till claim (SELL) or an accrued base sale
 * (PAYBACK). Each document is decided exactly once, in its own transaction; the
 * ledger supplies the bar's existing status/unlimited/cancel rules.
 */
export async function processPosBonuses(pool, { storeId, ledger, limit = 50 }) {
  await requirePosBonusSchema(pool);
  const results = [];
  for (const candidate of await pendingDocuments(pool, storeId, limit)) {
    const db = await pool.connect();
    let result;
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-bonus:${storeId}:${candidate.document_id}`]);
      const doc = (await db.query(`SELECT d.store_id,d.document_id,d.type,d.amount_cents,d.snapshot FROM pos_documents d
        WHERE d.source='evotor' AND d.store_id=$1 AND d.document_id=$2 AND NOT EXISTS (SELECT 1 FROM pos_bonus_accruals a
          WHERE a.source=d.source AND a.store_id=d.store_id AND a.document_id=d.document_id)`,
      [storeId, candidate.document_id])).rows[0];
      if (!doc) { await db.query('ROLLBACK'); continue; }
      result = doc.type === 'SELL' ? await accrueSale(db, doc, ledger) : await reverseReturn(db, doc, ledger);
      await db.query('COMMIT');
    } catch (error) {
      try { await db.query('ROLLBACK'); } catch {}
      results.push({ documentId: candidate.document_id, status: 'error', error: error.message });
      continue;
    } finally { db.release(); }
    results.push(result);
    if (result.status === 'applied') {
      try { await ledger.afterCommit(result); } catch (error) { console.warn('POS bonus notification failed:', error.message); }
    }
  }
  return results;
}
