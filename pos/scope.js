export function posError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function posIdentifier(value, field) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 200) {
    throw posError(400, 'invalid_input', `Некорректный ${field}.`);
  }
  return value;
}

export async function requirePosSchema(db) {
  const result = await db.query(`SELECT to_regclass('public.pos_documents') IS NOT NULL
    AND to_regclass('public.pos_store_bindings') IS NOT NULL
    AND to_regclass('public.pos_operator_access') IS NOT NULL
    AND to_regclass('public.pos_devices') IS NOT NULL
    AND to_regclass('public.pos_device_audit') IS NOT NULL
    AND to_regclass('public.pos_customer_links') IS NOT NULL
    AND to_regclass('public.pos_sync_state') IS NOT NULL AS ready`);
  if (!result.rows[0]?.ready) throw posError(503, 'schema_required', 'Подключение ожидает подготовки базы.');
}

export async function resolveOperatorStore(db, user, storeId, write = false, requested = {}) {
  if (!user?.id) throw posError(401, 'unauthorized', 'Требуется авторизация.');
  if (!(write ? ['admin'] : ['admin', 'viewer']).includes(user.role)) {
    throw posError(403, 'forbidden', 'Недостаточно прав.');
  }
  posIdentifier(storeId, 'storeId');
  await requirePosSchema(db);
  const result = await db.query(`SELECT b.store_id,b.tenant_id,b.location_id,a.can_manage
    FROM pos_store_bindings b JOIN pos_operator_access a ON a.store_id=b.store_id
    WHERE b.store_id=$1 AND b.enabled=TRUE AND a.user_id=$2 AND a.revoked_at IS NULL`,
  [storeId, user.id]);
  const scope = result.rows[0];
  if (!scope || (write && !scope.can_manage)
    || (requested.tenantId !== undefined && requested.tenantId !== scope.tenant_id)
    || (requested.locationId !== undefined && requested.locationId !== scope.location_id)) {
    throw posError(403, 'scope_denied', 'Касса недоступна в этом заведении.');
  }
  return { storeId: scope.store_id, tenantId: scope.tenant_id, locationId: scope.location_id, canManage: user.role === 'admin' && Boolean(scope.can_manage) };
}

// Used by a provider worker, never a browser-supplied store identifier.
export async function requireConfiguredStore(db, storeId) {
  await requirePosSchema(db);
  const result = await db.query('SELECT store_id FROM pos_store_bindings WHERE store_id=$1 AND enabled=TRUE', [storeId]);
  if (!result.rows.length) throw posError(503, 'store_not_mapped', 'Магазин Эвотора не привязан к заведению.');
}
