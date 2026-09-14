function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function authorizationFromRequest(req) {
  const authorization = req?.spaceverseAuthorization;
  if (!authorization?.context) {
    throw Object.assign(new Error('SPACEVERSE authorization context is required'), {
      statusCode: 403,
      code: 'authorization_context_required'
    });
  }
  return authorization;
}

/**
 * HTTP adapter for a future Customer 360 manual achievement grant endpoint.
 *
 * Authorization and customer ownership are deliberately not reimplemented here.
 * Scoped middleware must run first; the achievement runtime then proves canonical
 * Customer 360 visibility before delegating to the existing reward executor.
 */
export function createCustomerAchievementGrantRouteHandler({ grant } = {}) {
  requireFunction(grant, 'grant');

  return async function customerAchievementGrantRouteHandler(req, res, next) {
    try {
      const authorization = authorizationFromRequest(req);
      const tenantId = authorization.requestedScope?.tenantId ?? req.params?.tenantId;
      const locationId = authorization.requestedScope?.locationId ?? req.params?.locationId;

      const result = await grant({
        context: authorization.context,
        tenantId,
        locationId,
        actorId: req.user?.id,
        customerId: req.params?.id,
        achievementCode: req.params?.achievementCode,
        reason: req.body?.reason,
        requestKey: req.body?.requestKey,
        confirmed: req.body?.confirmed === true
      });

      return res.json({
        ok: true,
        ...(result?.replayed ? { replayed: true } : {})
      });
    } catch (error) {
      const code = String(error?.code || '');
      const statusByCode = {
        authorization_context_required: 403,
        confirmation_required: 400,
        invalid_scope: 403,
        insufficient_role: 403,
        manager_required: 403,
        scope_denied: 403,
        actor_required: 400,
        reason_required: 400,
        customer_scope_denied: 404,
        idempotency_conflict: 409
      };

      if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
      }
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        return res.status(error.statusCode).json({ error: error.message, code: code || undefined });
      }
      if (statusByCode[code]) {
        return res.status(statusByCode[code]).json({ error: error.message, code });
      }
      return next(error);
    }
  };
}

export const customerAchievementGrantRouteHandlerContract = Object.freeze({
  route: '/api/spaceverse/tenants/:tenantId/locations/:locationId/customers/:id/achievements/:achievementCode/grants',
  requiresScopedAuthorizationMiddleware: true,
  requiresAuthorizationContext: true,
  delegatesCustomerVisibilityProof: true,
  delegatesRewardMutation: true,
  exposesCrossTenantExistenceOnScopeDenial: false,
  ownsRewardLogic: false,
  productionRouteWired: false
});
