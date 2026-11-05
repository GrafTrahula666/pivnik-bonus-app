/**
 * Unmounted HTTP adapter for the scoped read-only status contract.
 * Mount only behind verified authentication and a trusted membership resolver.
 * Actor/platform rights come from req.user populated by server authentication;
 * body/query/header authorization claims are never forwarded to the resolver.
 * Requires deliberate schema/runtime enablement; no legacy role bypass.
 */
export function createAdminAdjustmentStatusHandler({
  readStatus, resolveAuthorization, scopedStatusEnabled = false
} = {}) {
  if (typeof readStatus !== 'function' || typeof resolveAuthorization !== 'function') {
    throw new TypeError('readStatus and resolveAuthorization must be functions');
  }
  if (typeof scopedStatusEnabled !== 'boolean') throw new TypeError('scopedStatusEnabled must be boolean');
  return async function adjustmentStatus(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    if (!req.user?.id) return res.status(401).json({ error: 'Требуется авторизация.' });
    if (!scopedStatusEnabled) return res.status(503).json({ error: 'Проверка статуса пока недоступна.' });
    try {
      const { tenantId, locationId, clientId } = req.params || {};
      if (![tenantId, locationId, clientId].every(value => typeof value === 'string' && value.trim() && value.length <= 160)) {
        throw new TypeError('Explicit bounded route scope is required');
      }
      const authorization = await resolveAuthorization({
        userId: req.user.id,
        platformRole: req.user.platformRole ?? null,
        legacyRole: req.user.role ?? null,
        tenantId, locationId
      });
      const result = await readStatus({
        authorizationContext: authorization?.context,
        authenticatedActorId: req.user.id,
        tenantId, locationId, clientId,
        command: { amount: req.body?.amount, reason: req.body?.reason, requestKey: req.body?.requestKey }
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error.code === 'ADJUSTMENT_STATUS_FORBIDDEN') return res.status(403).json({ error: 'Нет доступа к этому бизнесу.' });
      if (error.code === 'ADJUSTMENT_STATUS_UNAVAILABLE') return res.status(503).json({ error: 'Проверка статуса пока недоступна.' });
      if (error instanceof TypeError) return res.status(400).json({ error: 'Некорректная команда или область проверки.' });
      return next(error);
    }
  };
}
