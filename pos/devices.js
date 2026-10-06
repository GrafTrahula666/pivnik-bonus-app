import crypto from 'node:crypto';
import { resolvePersonalQrRecord } from '../qr-resolver.js';
import { posError, posIdentifier, requirePosSchema, resolveOperatorStore } from './scope.js';
import { claimReceipt, posBonusConfig } from './bonus.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createPosDeviceService(pool, config) {
  const bonusEnabled = () => config.bonusEnabled ?? posBonusConfig().enabled;
  const ready = async () => {
    if (!config.enabled) throw posError(503, 'pos_disabled', 'POS-подключение выключено.');
    await requirePosSchema(pool);
  };
  const authorize = async (db, header) => {
    const match = /^Device (pvpos_[A-Za-z0-9_-]{43})$/.exec(String(header || ''));
    if (!match) throw posError(401, 'unauthorized_pos', 'Требуется ключ кассы.');
    const result = await db.query(`SELECT d.id,d.store_id,b.tenant_id,b.location_id
      FROM pos_devices d JOIN pos_store_bindings b ON b.store_id=d.store_id
      WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND b.enabled=TRUE`, [hash(match[1])]);
    if (!result.rows[0]) throw posError(401, 'unauthorized_pos', 'Ключ кассы недействителен.');
    return result.rows[0];
  };
  return {
    /** Checks the device key once; the HTTP layer rate-limits by the returned device id. */
    async authenticate(header) {
      await ready();
      return authorize(pool, header);
    },
    async resolveFor(device, body) {
      if (!body || typeof body.payload !== 'string' || !body.payload || body.payload.length > 2048) {
        throw posError(400, 'invalid_qr', 'Нужен QR клиента.');
      }
      const record = await resolvePersonalQrRecord(pool, body.payload);
      if (!record) throw posError(404, 'qr_not_found', 'QR не найден или отозван.');
      const result = await pool.query(`SELECT id,first_name FROM users
        WHERE id=$1 AND deleted_at IS NULL AND merged_into_user_id IS NULL`, [record.id]);
      if (!result.rows[0]) throw posError(404, 'qr_not_found', 'QR не найден или отозван.');
      // Same small client envelope the existing bridge parser expects; no wallet,
      // QR tokens, contact details, social identity or staff/admin session returned.
      return { client: { id: String(result.rows[0].id), firstName: result.rows[0].first_name || '' } };
    },
    async bindFor(device, body) {
      // A claim is a promise to accrue: refuse it while accrual is off, so the till never
      // shows a bonus that will not come and re-enabling cannot pay out a backlog.
      if (!bonusEnabled()) throw posError(503, 'pos_bonus_disabled', 'Начисление бонусов по кассе выключено.');
      return claimReceipt(pool, device, body);
    },
    async resolve(header, body) {
      return this.resolveFor(await this.authenticate(header), body);
    },
    async bind(header, body) {
      return this.bindFor(await this.authenticate(header), body);
    },
    async list(user, params = {}) {
      await ready();
      const scope = await resolveOperatorStore(pool, user, params.storeId || config.storeId, true, params);
      const result = await pool.query(`SELECT id,external_device_id AS "externalDeviceId",label,
        created_at AS "createdAt",revoked_at AS "revokedAt" FROM pos_devices WHERE store_id=$1 ORDER BY created_at DESC`, [scope.storeId]);
      return { scope, devices: result.rows };
    },
    async issue(user, body) {
      await ready();
      if (!body) throw posError(400, 'invalid_input', 'Нужны параметры кассы.');
      const storeId = posIdentifier(body.storeId, 'storeId');
      const externalId = posIdentifier(body.externalDeviceId, 'externalDeviceId');
      const label = posIdentifier(body.label, 'label');
      if (label.length > 100) throw posError(400, 'invalid_input', 'Название кассы слишком длинное.');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await resolveOperatorStore(db, user, storeId, true, body);
        const id = crypto.randomUUID(), token = 'pvpos_' + crypto.randomBytes(32).toString('base64url');
        await db.query(`INSERT INTO pos_devices(id,store_id,external_device_id,label,token_hash,created_by)
          VALUES($1,$2,$3,$4,$5,$6)`, [id,storeId,externalId,label,hash(token),user.id]);
        await db.query("INSERT INTO pos_device_audit(device_id,action,actor_id) VALUES($1,'issued',$2)", [id,user.id]);
        await db.query('COMMIT');
        return { id, deviceToken: token }; // Reveal exactly once, never stored in plaintext.
      } catch (error) {
        try { await db.query('ROLLBACK'); } catch {}
        if (error.code === '23505' && error.constraint === 'pos_devices_active_external_id') {
          throw posError(409, 'pos_already_issued', 'Для этой кассы уже выдан ключ. Отзовите его перед повторной выдачей.');
        }
        throw error;
      }
      finally { db.release(); }
    },
    async revoke(user, body) {
      await ready();
      if (!body || !/^[a-f0-9-]{36}$/i.test(body.id || '')) throw posError(400, 'invalid_input', 'Нужен ID кассы.');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const scope = await resolveOperatorStore(db, user, body.storeId || config.storeId, true, body);
        const result = await db.query(`UPDATE pos_devices SET revoked_at=NOW(),revoked_by=$3
          WHERE id=$1 AND store_id=$2 AND revoked_at IS NULL RETURNING id`, [body.id,scope.storeId,user.id]);
        if (result.rows.length) await db.query("INSERT INTO pos_device_audit(device_id,action,actor_id) VALUES($1,'revoked',$2)", [body.id,user.id]);
        else {
          const existing = await db.query('SELECT id FROM pos_devices WHERE id=$1 AND store_id=$2', [body.id,scope.storeId]);
          if (!existing.rows.length) throw posError(404, 'pos_not_found', 'Касса не найдена.');
        }
        await db.query('COMMIT'); return { ok: true };
      } catch (error) { try { await db.query('ROLLBACK'); } catch {} throw error; }
      finally { db.release(); }
    }
  };
}
