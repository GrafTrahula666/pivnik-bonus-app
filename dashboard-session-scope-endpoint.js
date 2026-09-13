import { DashboardSessionScopeError } from './dashboard-session-scope-resolver.js';

export const DASHBOARD_SESSION_SCOPE_ROUTE = '/api/spaceverse/session/dashboard-scope';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Browser-facing, read-only source of the current Dashboard scope.
 *
 * No tenant/location value is accepted from params, query or body. Scope comes
 * exclusively from the authenticated server-side user and the injected
 * fail-closed resolver.
 */
export function mountDashboardSessionScopeEndpoint({
  app,
  scopedModeEnabled = false,
  resolveSessionScope
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }

  if (!scopedModeEnabled) {
    return Object.freeze({ mounted: false, route: DASHBOARD_SESSION_SCOPE_ROUTE });
  }

  if (!app || typeof app.get !== 'function') throw new TypeError('app.get is required');
  const resolve = requireFunction(resolveSessionScope, 'resolveSessionScope');

  async function dashboardSessionScopeHandler(req, res, next) {
    try {
      if (!req?.user?.id) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const scope = await resolve({
        userId: req.user.id,
        platformRole: req.user.platformRole ?? null,
        legacyRole: req.user.role ?? null
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

  app.get(DASHBOARD_SESSION_SCOPE_ROUTE, dashboardSessionScopeHandler);

  return Object.freeze({
    mounted: true,
    route: DASHBOARD_SESSION_SCOPE_ROUTE
  });
}

export const dashboardSessionScopeEndpointContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  requiresAuthenticatedUser: true,
  acceptsTenantFromParams: false,
  acceptsTenantFromQuery: false,
  acceptsTenantFromBody: false,
  acceptsLocationFromParams: false,
  acceptsLocationFromQuery: false,
  acceptsLocationFromBody: false,
  cacheControl: 'no-store',
  readOnly: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
