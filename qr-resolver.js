import { normalizePersonalQr } from './platform-core.js';

export async function resolvePersonalQrRecord(db, payload) {
  const normalized = normalizePersonalQr(payload);
  if (!normalized) return null;
  const token = normalized.type === 'token';
  const direct = await db.query(
    `SELECT id, qr_token, qr_short_code
     FROM users
     WHERE merged_into_user_id IS NULL
       AND ${token ? 'qr_token = $1' : 'UPPER(qr_short_code) = $1'}
     LIMIT 1`,
    [normalized.value]
  );
  if (direct.rows.length) return direct.rows[0];

  const alias = await db.query(
    `SELECT u.id, u.qr_token, u.qr_short_code
     FROM qr_aliases qa
     JOIN users u ON u.id = qa.user_id
     WHERE u.merged_into_user_id IS NULL
       AND ${token ? 'qa.qr_token = $1' : 'UPPER(qa.qr_short_code) = $1'}
     LIMIT 1`,
    [normalized.value]
  );
  return alias.rows[0] || null;
}
