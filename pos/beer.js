import { posError } from './scope.js';

const RECEIPT_UUID = /^[A-Za-z0-9-]{1,200}$/;
// The same policy and canonical table as staff purchases and the customer app.
const PAID_TARGET_ML = 14_000, GIFT_ML = 1_000;

async function ready(db) {
  return Boolean((await db.query(`SELECT to_regclass('public.pos_receipt_beer') IS NOT NULL
    AND to_regclass('public.pos_beer_settlements') IS NOT NULL AS ready`)).rows[0]?.ready);
}

/** No balance changes here. Money and the maximum eligible volume come from Evotor cloud. */
export async function selectReceiptBeer(pool, device, body) {
  if (typeof body?.receiptUuid !== 'string' || !RECEIPT_UUID.test(body.receiptUuid) || !/^[1-9][0-9]{0,17}$/.test(String(body?.clientId || ''))
      || !['save', 'status'].includes(body?.action)) throw posError(400, 'invalid_beer_selection', 'Нужны чек и выбранный клиент.');
  if (body.action === 'save' && (!Number.isSafeInteger(body.beerMl) || body.beerMl < 0 || body.beerMl > 100_000 || body.beerMl % 500)) {
    throw posError(400, 'invalid_beer_volume', 'Выберите объём с шагом 0,5 л, до 100 л.');
  }
  if (!await ready(pool)) throw posError(503, 'beer_schema_required', 'Учёт литров ожидает подготовки базы.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pos-bonus:${device.store_id}:${body.receiptUuid}`]);
    const claim = (await db.query(`SELECT c.*, EXISTS(SELECT 1 FROM pos_bonus_accruals a WHERE a.source=c.source
      AND a.store_id=c.store_id AND a.document_id=c.receipt_uuid) AS settled
      FROM pos_receipt_claims c WHERE c.source='evotor' AND c.store_id=$1 AND c.receipt_uuid=$2 FOR UPDATE`,
    [device.store_id, body.receiptUuid])).rows[0];
    if (!claim || String(claim.client_id) !== String(body.clientId) || claim.device_id !== device.id) {
      throw posError(409, 'beer_claim_changed', 'Клиент или касса изменились. Отсканируйте QR заново.');
    }
    const choice = (await db.query(`SELECT b.beer_ml FROM pos_receipt_beer b JOIN pos_receipt_claims c
      USING(source,store_id,receipt_uuid) WHERE b.source='evotor' AND b.store_id=$1 AND b.receipt_uuid=$2
      AND b.client_id=c.client_id AND b.device_id=c.device_id AND b.claimed_at=c.claimed_at`,
    [device.store_id, body.receiptUuid])).rows[0];
    if (body.action === 'save') {
      if (claim.settled && choice?.beer_ml !== body.beerMl) throw posError(409, 'beer_already_settled', 'Этот чек уже обработан.');
      // Copy timestamp inside PostgreSQL: JS Date would truncate claim microseconds.
      if (!claim.settled) await db.query(`INSERT INTO pos_receipt_beer(store_id,receipt_uuid,client_id,device_id,claimed_at,beer_ml)
        SELECT store_id,receipt_uuid,client_id,device_id,claimed_at,$3 FROM pos_receipt_claims
        WHERE source='evotor' AND store_id=$1 AND receipt_uuid=$2
        ON CONFLICT(source,store_id,receipt_uuid) DO UPDATE SET
        client_id=EXCLUDED.client_id,device_id=EXCLUDED.device_id,claimed_at=EXCLUDED.claimed_at,
        beer_ml=EXCLUDED.beer_ml,selected_at=NOW()`,
      [device.store_id, body.receiptUuid, body.beerMl]);
    }
    await db.query('COMMIT');
    return { receiptUuid: body.receiptUuid, clientId: String(claim.client_id),
      beerMl: body.action === 'save' ? body.beerMl : choice?.beer_ml ?? null, settled: claim.settled };
  } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
  finally { db.release(); }
}

/** Only paid draught positions measured in liters bound the cashier's selection.
 * Bottles (pieces), snacks (kg), zero-price gifts and unrecognized units don't count.
 * Never change the immutable normalized document shape for historical imports.
 */
export function paidLiquidMl(snapshot) {
  let total = 0;
  for (const p of snapshot?.positions || []) {
    const unit = String(p.measure || '').trim().toLowerCase().replace(/\.$/, '');
    if (!['л', 'l', 'литр', 'литра', 'литров'].includes(unit) || !(p.amountCents > 0)) continue;
    if (Number.isSafeInteger(p.quantityMillis) && p.quantityMillis > 0) total += p.quantityMillis;
  }
  return Math.min(100_000, total);
}

async function lockedBeer(db, clientId) {
  await db.query('INSERT INTO beer_loyalty(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [clientId]);
  return (await db.query('SELECT paid_ml_total,gift_ml_balance FROM beer_loyalty WHERE user_id=$1 FOR UPDATE', [clientId])).rows[0];
}

export async function accrueReceiptBeer(db, doc, transaction) {
  if (!await ready(db)) return 0; // Old APKs/cashback continue before manual migration.
  const selected = (await db.query(`SELECT b.beer_ml FROM pos_receipt_beer b JOIN pos_receipt_claims c
    USING(source,store_id,receipt_uuid) JOIN pos_documents d ON d.source=b.source AND d.store_id=b.store_id AND d.document_id=b.receipt_uuid
    WHERE b.source='evotor' AND b.store_id=$1 AND b.receipt_uuid=$2 AND b.client_id=c.client_id
    AND b.device_id=c.device_id AND b.claimed_at=c.claimed_at AND b.selected_at<=d.closed_at + INTERVAL '15 minutes'`,
  [doc.store_id, doc.document_id])).rows[0];
  const ml = Math.min(selected?.beer_ml || 0, paidLiquidMl(doc.snapshot));
  if (!ml) return 0;
  const beer = await lockedBeer(db, transaction.client_id);
  const before = Number(beer.paid_ml_total), after = before + ml;
  const gift = (Math.floor(after / PAID_TARGET_ML) - Math.floor(before / PAID_TARGET_ML)) * GIFT_ML;
  await db.query('UPDATE beer_loyalty SET paid_ml_total=$1,gift_ml_balance=gift_ml_balance+$2,updated_at=NOW() WHERE user_id=$3',
    [after, gift, transaction.client_id]);
  await db.query('UPDATE transactions SET beer_ml=$1,beer_gift_earned_ml=$2 WHERE id=$3', [ml, gift, transaction.id]);
  transaction.beer_ml=ml; transaction.beer_gift_earned_ml=gift;
  await db.query(`INSERT INTO pos_beer_settlements(store_id,document_id,paid_ml_before,paid_ml_delta,gift_ml_delta) VALUES($1,$2,$3,$4,$5)`,
    [doc.store_id, doc.document_id, before, ml, gift]);
  return ml;
}

/** Undo only this purchase's remaining volume/reward, never a later purchase's gift.
 * Partial returns use actual cloud liter quantities; cumulative volume is capped
 * by the original purchase. A spent gift is recorded for owner review.
 * cancelled=true means the canonical full-cancel already changed beer_loyalty.
 */
export async function reverseReceiptBeer(db, doc, base, cancelled = false) {
  if (!await ready(db)) return null;
  const initial = (await db.query(`SELECT b.*,d.snapshot FROM pos_beer_settlements b JOIN pos_documents d
    USING(source,store_id,document_id) WHERE b.source='evotor' AND b.store_id=$1 AND b.document_id=$2`,
  [doc.store_id, doc.snapshot.baseDocumentId])).rows[0];
  if (!initial || initial.paid_ml_delta <= 0) return null;
  const previous = (await db.query(`SELECT COALESCE(SUM(-paid_ml_delta),0)::int AS paid,
    COALESCE(SUM(-gift_ml_delta+gift_shortfall_ml),0)::int AS gift FROM pos_beer_settlements
    WHERE source='evotor' AND store_id=$1 AND base_document_id=$2`, [doc.store_id, doc.snapshot.baseDocumentId])).rows[0];
  const pastDocs = (await db.query(`SELECT d.snapshot,d.amount_cents FROM pos_bonus_accruals a JOIN pos_documents d
    USING(source,store_id,document_id) WHERE a.source='evotor' AND a.store_id=$1 AND a.base_document_id=$2 AND a.kind='reverse'`,
  [doc.store_id, doc.snapshot.baseDocumentId])).rows;
  const returnedAmount = pastDocs.reduce((s,d) => s+Number(d.amount_cents), Number(doc.amount_cents));
  const returnedMl = pastDocs.reduce((s,d) => s+paidLiquidMl(d.snapshot), paidLiquidMl(doc.snapshot));
  const totalMl = Number(initial.paid_ml_delta), totalGift = Number(initial.gift_ml_delta);
  const ratio = returnedAmount >= Number(base.amount_cents) ? 1 : Math.min(1, returnedMl / Math.max(1, paidLiquidMl(initial.snapshot)));
  const target = Math.min(totalMl, Math.ceil(totalMl * ratio));
  const ml = Math.max(0, target - previous.paid);
  // Re-evaluate THIS purchase's original threshold crossings with its remaining
  // paid volume. Gifts remain whole liters; a partial refund never invents half a gift.
  const paidBefore = Number(initial.paid_ml_before);
  const remainingGift = (Math.floor((paidBefore + totalMl - target) / PAID_TARGET_ML) - Math.floor(paidBefore / PAID_TARGET_ML)) * GIFT_ML;
  const giftDue = Math.max(0, totalGift - remainingGift - previous.gift);
  let removedGift = giftDue;
  if (!cancelled) {
    const beer = await lockedBeer(db, base.client_id);
    if (Number(beer.paid_ml_total) < ml) throw posError(409, 'beer_reconciliation_required', 'Нужна сверка оплаченного объёма.');
    removedGift = Math.min(giftDue, Number(beer.gift_ml_balance));
    await db.query(`UPDATE beer_loyalty SET paid_ml_total=paid_ml_total-$1,gift_ml_balance=gift_ml_balance-$2,updated_at=NOW() WHERE user_id=$3`,
      [ml, removedGift, base.client_id]);
    // Leave only the outstanding purchase on the original transaction, just as
    // partial refunds reduce its cash_paid_cents. A later admin cancel cannot double-reverse.
    await db.query(`UPDATE transactions SET beer_ml=GREATEST(0,beer_ml-$1),beer_gift_earned_ml=GREATEST(0,beer_gift_earned_ml-$2) WHERE id=$3`,
      [ml, giftDue, base.transaction_id]);
  }
  await db.query(`INSERT INTO pos_beer_settlements(store_id,document_id,base_document_id,paid_ml_delta,gift_ml_delta,gift_shortfall_ml)
    VALUES($1,$2,$3,$4,$5,$6)`, [doc.store_id, doc.document_id, doc.snapshot.baseDocumentId, -ml, -removedGift, giftDue-removedGift]);
  return { beerRemovedMl: ml, beerGiftShortfallMl: giftDue-removedGift };
}
