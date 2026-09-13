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
 * Thin HTTP adapter for the owner Dashboard period comparison endpoint.
 * Authorization is owned by the scoped middleware; formulas and data access
 * remain in the Dashboard runtime/service/repository layers.
 */
export function createDashboardPeriodSummaryRouteHandler({ getPeriodSummary } = {}) {
  requireFunction(getPeriodSummary, 'getPeriodSummary');

  return async function dashboardPeriodSummaryRouteHandler(req, res, next) {
    try {
      const authorization = authorizationFromRequest(req);
      const tenantId = authorization.requestedScope?.tenantId ?? req.params?.tenantId;
      const locationId = req.query?.locationId ?? authorization.requestedScope?.locationId ?? null;

      const summary = await getPeriodSummary({
        tenantId,
        locationId,
        start: req.query?.start,
        end: req.query?.end
      });

      return res.json({ ok: true, summary });
    } catch (error) {
      const code = String(error?.code || '');
      const statusByCode = {
        authorization_context_required: 403,
        scoped_reads_disabled: 503
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

export const dashboardPeriodSummaryRouteHandlerContract = Object.freeze({
  route: '/api/spaceverse/tenants/:tenantId/dashboard/period-summary',
  requiresScopedAuthorizationMiddleware: true,
  requiresAuthorizationContext: true,
  tenantWideManagerRead: true,
  optionalLocationFilter: true,
  readOnly: true,
  ownsQueries: false,
  ownsFormulas: false,
  productionRouteWired: false
});
