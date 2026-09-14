import { DashboardSessionScopeError } from './dashboard-session-scope-resolver.js';

export const DASHBOARD_SCOPE_DIRECTORY_ROUTE = '/api/spaceverse/session/dashboard-scopes';

export function mountDashboardScopeDirectoryEndpoint({
  app,
  scopedModeEnabled = false,
  resolveDashboardScopeDirectory
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') throw new TypeError('scopedModeEnabled must be boolean');
  if (!scopedModeEnabled) return Object.freeze({ mounted: false, route: DASHBOARD_SCOPE_DIRECTORY_ROUTE });
  if (!app || typeof app.get !== 'function') throw new TypeError('app.get is required');
  if (typeof resolveDashboardScopeDirectory !== 'function') {
    throw new TypeError('resolveDashboardScopeDirectory must be a function');
  }

  async function handler(req, res, next) {
    try {
      if (!req?.user?.id) return res.status(401).json({ ok: false, error: 'authentication_required' });

      const result = await resolveDashboardScopeDirectory({
        userId: req.user.id,
        platformRole: req.user.platformRole ?? null,
        legacyRole: req.user.role ?? null,
        tenantId: req.query?.tenantId ?? null
      });

      if (typeof res.set === 'function') res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof DashboardSessionScopeError) {
        if (typeof res.set === 'function') res.set('Cache-Control', 'no-store');
        return res.status(error.statusCode).json({ ok: false, error: error.code });
      }
      return next(error);
    }
  }

  app.get(DASHBOARD_SCOPE_DIRECTORY_ROUTE, handler);
  return Object.freeze({ mounted: true, route: DASHBOARD_SCOPE_DIRECTORY_ROUTE });
}

export const dashboardScopeDirectoryEndpointContract = Object.freeze({
  readOnly: true,
  requiresAuthenticatedUser: true,
  tenantQueryOnlyNarrowsDirectory: true,
  bodyCannotGrantScope: true,
  cacheControl: 'no-store',
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
