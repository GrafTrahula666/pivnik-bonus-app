// Settings PIVNIK Business changes in the running app (achievements now). Each key is applied by
// the module that owns it; with no saved row the built-in defaults stay in force.

export const BUSINESS_RUNTIME_CONFIG_SQL = `
  CREATE TABLE IF NOT EXISTS business_runtime_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

const appliers = new Map();

export function onRuntimeConfig(key, apply) {
  appliers.set(key, apply);
}

export async function refreshRuntimeConfig(db) {
  let rows;
  try {
    rows = (await db.query('SELECT key, value FROM business_runtime_config')).rows;
  } catch (error) {
    // The table appears with the first start of server.js; until then defaults apply.
    if (error?.code !== '42P01') console.warn('Business settings were not refreshed:', error.message);
    return false;
  }
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  for (const [key, apply] of appliers) apply(byKey.get(key) ?? null);
  return true;
}

export async function saveRuntimeConfig(db, key, value, updatedBy) {
  const result = await db.query(
    `INSERT INTO business_runtime_config (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING updated_at`,
    [key, JSON.stringify(value), updatedBy || null]
  );
  appliers.get(key)?.(value);
  return result.rows[0]?.updated_at || null;
}

export async function readRuntimeConfigMeta(db, key) {
  try {
    const result = await db.query('SELECT updated_by, updated_at FROM business_runtime_config WHERE key = $1', [key]);
    return result.rows[0] ? { updatedBy: result.rows[0].updated_by, updatedAt: result.rows[0].updated_at } : null;
  } catch (error) {
    if (error?.code === '42P01') return null;
    throw error;
  }
}

// Both app processes keep their copy fresh; a change saved in one reaches the other within the interval.
export function startRuntimeConfigRefresh(db, intervalMs = 30_000) {
  void refreshRuntimeConfig(db);
  const timer = setInterval(() => { void refreshRuntimeConfig(db); }, intervalMs);
  timer.unref?.();
  return timer;
}
