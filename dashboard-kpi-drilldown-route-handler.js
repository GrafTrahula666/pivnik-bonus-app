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

export function createDashboardKpiDrilldownRouteHandler({ getKpiDrilldown } = {}) {
  requireFunction(getKpiDrilldown, 'getKpiDrilldown');

  return async function dashboardKpiDrilldownRouteHandler(req, res, next) {
    try {
      const authorization = authorizationFromRequest(req);
      const tenantId = authorization.requestedScope?.tenantId ?? req.params?.tenantId;
      const locationId = req.query?.locationId ?? authorization.requestedScope?.locationId ?? null;

      const drilldown = await getKpiDrilldown({
        tenantId,
        locationId,
        metric: req.params?.metric,
        start: req.query?.start,
        end: req.query?.end,
        limit: req.query?.limit === undefined ? 50 : Number(req.query.limit),
        offset: req.query?.offset === undefined ? 0 : Number(req.query.offset)
      });

      return res.json({ ok: true, drilldown });
    } catch (error) {
      const code = String(error?.code || '');
      if (error instanceof TypeError || error instanceof RangeError) {
        return res.status(400).json({ error: error.message });
      }
      if (code === 'authorization_context_required') {
        return res.status(403).json({ error: error.message, code });
      }
      if (code === 'scoped_reads_disabled') {
        return res.status(503).json({ error: error.message, code });
      }
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600) {
        return res.status(error.statusCode).json({ error: error.message, code: code || undefined });
      }
      return next(error);
    }
  };
}

export const dashboardKpiDrilldownRouteHandlerContract = Object.freeze({
  route: '/api/spaceverse/tenants/:tenantId/dashboard/drilldown/:metric',
  requiresScopedAuthorizationMiddleware: true,
  requiresAuthorizationContext: true,
  tenantWideManagerRead: true,
  optionalLocationFilter: true,
  pagination: true,
  readOnly: true,
  productionRouteWired: false
});
