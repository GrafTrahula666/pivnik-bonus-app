/**
 * Unmounted, default-disabled identity boundary for read-only status checks.
 * Deliberately avoids getProfile/reward helpers and legacy/platform role grants.
 * Tenant authorization remains the membership resolver's responsibility.
 */
export function createAdminAdjustmentStatusAuth({
  query, verifySession, readOnlyIdentityEnabled = false
} = {}) {
  if (typeof query !== 'function' || typeof verifySession !== 'function') {
    throw new TypeError('query and verifySession must be functions');
  }
  if (typeof readOnlyIdentityEnabled !== 'boolean') throw new TypeError('readOnlyIdentityEnabled must be boolean');
  return async function adjustmentStatusAuth(req, res, next) {
    delete req.user;
    delete req.session;
    res.set('Cache-Control', 'private, no-store');
    if (!readOnlyIdentityEnabled) return res.status(503).json({ error: 'Проверка статуса пока недоступна.' });
    const deny = () => res.status(401).json({ error: 'Требуется повторный вход в приложение.' });
    const raw = req.headers?.authorization;
    if (typeof raw !== 'string' || !raw.startsWith('Bearer ') || raw.length > 8192 || req.headers?.['x-staff-session']) return deny();
    try {
      const payload = verifySession(raw.slice(7));
      const uid = String(payload?.uid ?? '');
      if (!payload || typeof payload.uid !== 'string' || payload.kind !== undefined || !['telegram', 'vk'].includes(payload.platform)
        || !/^[1-9][0-9]{0,18}$/.test(uid) || BigInt(uid) > 9223372036854775807n
        || !Number.isSafeInteger(payload.sv) || payload.sv < 1) return deny();
      const result = await query(
        `SELECT id, session_version FROM users
         WHERE id = $1::bigint AND merged_into_user_id IS NULL AND deleted_at IS NULL`,
        [uid]
      );
      if (!Array.isArray(result?.rows) || result.rows.length > 1) throw new Error('Invalid status identity result');
      const row = result.rows[0];
      if (!row) return deny();
      if (String(row.id) !== uid || !Number.isSafeInteger(Number(row.session_version))) throw new Error('Invalid status identity row');
      if (Number(row.session_version) !== payload.sv) return deny();
      req.user = Object.freeze({ id: uid });
      req.session = Object.freeze({ uid, sv: payload.sv, platform: payload.platform });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
