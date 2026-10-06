import { readFile } from 'node:fs/promises';
import { posError, posIdentifier } from './scope.js';
import { createPosDeviceService } from './devices.js';

export const EVOTOR_MIGRATIONS = ['012_evotor_sales.sql', '013_evotor_pos_scope_devices.sql', '014_evotor_bonus_accrual.sql'];
const TABLES = ['pos_documents', 'pos_customer_links', 'pos_sync_state', 'pos_store_bindings', 'pos_operator_access',
  'pos_devices', 'pos_device_audit', 'pos_receipt_claims', 'pos_bonus_accruals'];

/** Runs the reviewed additive migrations in order; each file is its own transaction and is re-runnable. */
export async function applyEvotorMigrations(exec, dir = new URL('../migrations/', import.meta.url)) {
  for (const name of EVOTOR_MIGRATIONS) await exec(await readFile(new URL(name, dir), 'utf8'));
  return EVOTOR_MIGRATIONS;
}

async function missingTables(db) {
  const result = await db.query('SELECT name FROM unnest($1::text[]) AS name WHERE to_regclass($2 || name) IS NULL',
    [TABLES, 'public.']);
  return result.rows.map((row) => row.name);
}

async function findAdmin(db, { adminUserId, adminTelegramId }) {
  const byId = adminUserId !== undefined && adminUserId !== '';
  if (!byId && !adminTelegramId) throw posError(400, 'admin_required', 'Укажите --admin <ID пользователя> или OWNER_TELEGRAM_ID.');
  const rows = (await db.query(`SELECT id,role FROM users WHERE ${byId ? 'id' : 'telegram_id'}=$1
    AND deleted_at IS NULL AND merged_into_user_id IS NULL`, [String(byId ? adminUserId : adminTelegramId)])).rows;
  if (rows.length !== 1 || rows[0].role !== 'admin') {
    throw posError(400, 'admin_required', 'Нужен ровно один активный пользователь с ролью admin.');
  }
  return { id: String(rows[0].id), role: rows[0].role };
}

/**
 * Connects one Evotor store and issues the till key, as the owner's own one-off step.
 * Without apply it only checks and reports; with apply it enables the binding, grants
 * the admin management access and issues a key through the audited device service.
 */
export async function setupEvotorStore(pool, options) {
  const storeId = posIdentifier(options.storeId, 'storeId');
  const externalDeviceId = posIdentifier(options.externalDeviceId || 'kassa-1', 'externalDeviceId');
  const label = posIdentifier(options.label || 'Касса Пивник', 'label');
  const missing = await missingTables(pool);
  if (missing.length) throw posError(503, 'schema_required', `Не применены миграции 012–014 (нет таблиц: ${missing.join(', ')}).`);
  const admin = await findAdmin(pool, options);
  const existing = (await pool.query('SELECT tenant_id,location_id,enabled FROM pos_store_bindings WHERE store_id=$1', [storeId])).rows[0];
  const tenantId = posIdentifier(existing?.tenant_id || options.tenantId || 'pivnik', 'tenantId');
  const locationId = posIdentifier(existing?.location_id || options.locationId || storeId, 'locationId');
  const activeKeys = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM pos_devices
    WHERE store_id=$1 AND external_device_id=$2 AND revoked_at IS NULL`, [storeId, externalDeviceId])).rows[0].n);
  const plan = { storeId, tenantId, locationId, externalDeviceId, adminUserId: admin.id,
    bindingExists: Boolean(existing), activeKeys, apply: Boolean(options.apply) };
  if (!options.apply) return plan;
  if (activeKeys && !options.reissue) {
    throw posError(409, 'pos_already_issued', 'Для этой кассы уже выдан ключ. Запустите с --reissue, чтобы отозвать старый и выдать новый.');
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO pos_store_bindings(store_id,tenant_id,location_id,enabled) VALUES($1,$2,$3,TRUE)
      ON CONFLICT(store_id) DO UPDATE SET enabled=TRUE`, [storeId, tenantId, locationId]);
    await db.query(`INSERT INTO pos_operator_access(user_id,store_id,can_manage) VALUES($1,$2,TRUE)
      ON CONFLICT(user_id,store_id) DO UPDATE SET can_manage=TRUE,revoked_at=NULL`, [admin.id, storeId]);
    const revoked = await db.query(`UPDATE pos_devices SET revoked_at=NOW(),revoked_by=$3
      WHERE store_id=$1 AND external_device_id=$2 AND revoked_at IS NULL RETURNING id`, [storeId, externalDeviceId, admin.id]);
    for (const row of revoked.rows) {
      await db.query("INSERT INTO pos_device_audit(device_id,action,actor_id) VALUES($1,'revoked',$2)", [row.id, admin.id]);
    }
    await db.query('COMMIT');
    plan.revokedKeys = revoked.rows.length;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch {}
    throw error;
  } finally { db.release(); }

  const issued = await createPosDeviceService(pool, { enabled: true, storeId })
    .issue(admin, { storeId, externalDeviceId, label });
  return { ...plan, deviceId: issued.id, deviceToken: issued.deviceToken };
}
