import { mountCustomer360FullActionEndpoints } from './customer-360-full-action-endpoints.js';
import { mountDashboardReadEndpoints } from './dashboard-read-endpoints.js';
import { mountDashboardSessionScopeEndpoint } from './dashboard-session-scope-endpoint.js';
import { createDashboardSessionScopeResolver } from './dashboard-session-scope-resolver.js';
import { SPACEVERSE_RUNTIME } from './spaceverse-runtime.js';

/**
 * Single server-composition boundary for SPACEVERSE scoped HTTP capabilities.
 *
 * This module intentionally owns no auth, persistence, reward or financial
 * behavior. It only forwards the immutable rollout decision and runtime
 * dependencies to already-tested endpoint composition.
 *
 * Disabled mode must remain dependency-free so importing/wiring this boundary
 * into a server cannot accidentally make production require scoped migrations,
 * tenant attribution or new runtime configuration.
 */
export function mountSpaceverseServerComposition({
  app,
  runtime = SPACEVERSE_RUNTIME,
  resolveAuthorization,
  loadMemberships,
  db,
  executeAdjustment,
  grantAchievement,
  mountActionEndpoints = mountCustomer360FullActionEndpoints,
  mountDashboardEndpoints = mountDashboardReadEndpoints,
  createSessionScopeResolver = createDashboardSessionScopeResolver,
  mountSessionScopeEndpoint = mountDashboardSessionScopeEndpoint
} = {}) {
  if (!runtime || typeof runtime.scopedModeEnabled !== 'boolean') {
    throw new TypeError('runtime.scopedModeEnabled must be boolean');
  }
  if (typeof mountActionEndpoints !== 'function') {
    throw new TypeError('mountActionEndpoints must be a function');
  }
  if (typeof mountDashboardEndpoints !== 'function') {
    throw new TypeError('mountDashboardEndpoints must be a function');
  }
  if (typeof createSessionScopeResolver !== 'function') {
    throw new TypeError('createSessionScopeResolver must be a function');
  }
  if (typeof mountSessionScopeEndpoint !== 'function') {
    throw new TypeError('mountSessionScopeEndpoint must be a function');
  }

  if (!runtime.scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      actions: null,
      dashboard: null,
      dashboardSessionScope: null
    });
  }

  const shared = {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  };

  const actions = mountActionEndpoints({
    ...shared,
    executeAdjustment,
    grantAchievement
  });

  if (!actions?.mounted) {
    throw new Error('SPACEVERSE action endpoints failed to mount');
  }

  const dashboard = mountDashboardEndpoints(shared);
  if (!dashboard?.mounted) {
    throw new Error('SPACEVERSE Dashboard endpoints failed to mount');
  }

  const resolveSessionScope = createSessionScopeResolver({
    loadMemberships,
    resolveAuthorization
  });
  const dashboardSessionScope = mountSessionScopeEndpoint({
    app,
    scopedModeEnabled: true,
    resolveSessionScope
  });
  if (!dashboardSessionScope?.mounted) {
    throw new Error('SPACEVERSE Dashboard session scope endpoint failed to mount');
  }

  return Object.freeze({
    mounted: true,
    actions,
    dashboard,
    dashboardSessionScope
  });
}

export const spaceverseServerCompositionContract = Object.freeze({
  productionEnabledByDefault: SPACEVERSE_RUNTIME.scopedModeEnabled,
  disabledModeRequiresNoRuntimeDependencies: true,
  includesCustomerMetadataActions: true,
  includesDashboardPeriodSummary: true,
  includesDashboardKpiDrilldown: true,
  includesDashboardSessionScope: true,
  dashboardScopeComesFromServerMemberships: true,
  ownsBusinessLogic: false,
  ownsPersistence: false,
  ownsAuthorizationRules: false,
  requiresMountBeforeLegacyApiBoundary: true,
  externalDependenciesAdded: false
});
