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

/** Thin HTTP adapter for the scoped Customer 360 card. */
export function createCustomer360ReadRouteHandler({ getCustomerCard } = {}) {
  requireFunction(getCustomerCard, 'getCustomerCard');

  return async function customer360ReadRouteHandler(req, res, next) {
    try {
      const authorization = authorizationFromRequest(req);
      const tenantId = authorization.requestedScope?.tenantId ?? req.params?.tenantId;
      const locationId = req.query?.locationId ?? authorization.requestedScope?.locationId ?? null;
      const card = await getCustomerCard({
        customerId: req.params?.customerId,
        authorizationContext: authorization.context,
        tenantId,
        locationId,
        timelineLimit: req.query?.limit,
        timelineOffset: req.query?.offset
      });

      if (!card) {
        return res.status(404).json({ error: 'Клиент не найден в доступном scope.', code: 'customer_not_visible' });
      }
      return res.json({ ok: true, customer: card });
    } catch (error) {
      const code = String(error?.code || '');
      const statusByCode = {
        authorization_context_required: 403,
        TRANSACTION_READ_SCOPE_MIGRATION_GATED: 503,
        TRANSACTION_READ_SCOPE_FORBIDDEN: 403
      };

      if (error instanceof TypeError || error instanceof RangeError) {
        return res.status(400).json({ error: error.message });
      }
      if (statusByCode[code]) {
        return res.status(statusByCode[code]).json({ error: error.message, code });
      }
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600) {
        return res.status(error.statusCode).json({ error: error.message, code: code || undefined });
      }
      return next(error);
    }
  };
}

export const customer360ReadRouteHandlerContract = Object.freeze({
  route: '/api/spaceverse/tenants/:tenantId/customers/:customerId',
  requiresScopedAuthorizationMiddleware: true,
  requiresAuthorizationContext: true,
  tenantWideManagerRead: true,
  optionalLocationFilter: true,
  invisibleCustomerReturns404: true,
  readOnly: true,
  ownsQueries: false,
  productionRouteWired: false
});
