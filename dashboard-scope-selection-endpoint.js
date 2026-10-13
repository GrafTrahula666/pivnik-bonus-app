import { DashboardSessionScopeError } from './dashboard-session-scope-resolver.js';

export const DASHBOARD_SCOPE_SELECTION_ROUTE = '/api/spaceverse/session/dashboard-scope/select';

export function mountDashboardScopeSelectionEndpoint({
  app,
  scopedModeEnabled = false,
  selectDashboardScope
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');
  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: DASHBOARD_SCOPE_SELECTION_ROUTE });
  }
  if (!app || typeof app.post !== 'function') throw new TypeError('app.post is required');
  if (typeof selectDashboardScope !== 'function') throw new TypeError('selectDashboardScope must be a function');

  async function handler(req, res, next) {
    try {
      if (!req?.user?.id) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const scope = await selectDashboardScope({
        userId: req.user.id,
        platformRole: req.user.platformRole ?? null,
        legacyRole: req.user.role ?? null,
        tenantId: req.body?.tenantId ?? null,
        locationId: req.body?.locationId ?? null
      });

      if (typeof res.set === 'function') res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, scope });
    } catch (error) {
      if (error instanceof DashboardSessionScopeError) {
        if (typeof res.set === 'function') res.set('Cache-Control', 'no-store');
        return res.status(error.statusCode).json({ ok: false, error: error.code });
      }
      return next(error);
    }
  }

  app.post(DASHBOARD_SCOPE_SELECTION_ROUTE, handler);
  return Object.freeze({ mounted: true, route: DASHBOARD_SCOPE_SELECTION_ROUTE });
}

export const dashboardScopeSelectionEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  requiresAuthenticatedUser: true,
  acceptsRequestedTenant: true,
  acceptsRequestedLocation: true,
  requestedScopeIsAuthorizationInputOnly: true,
  crossTenantAuthorityFromBrowser: false,
  platformAdminSelectionEnabled: true,
  locationSelectionEnabled: true,
  authoritativeDirectoryRequiredByResolver: true,
  cacheControl: 'no-store',
  persistsSelection: false,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
