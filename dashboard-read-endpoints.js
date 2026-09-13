import { mountDashboardPeriodSummaryEndpoint } from './dashboard-period-summary-endpoint.js';
import { mountDashboardKpiDrilldownEndpoint } from './dashboard-kpi-drilldown-endpoint.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Single composition boundary for read-only owner Dashboard HTTP capabilities.
 *
 * Both endpoints share the same immutable rollout decision and authorization/
 * persistence dependencies. Disabled mode remains dependency-free so merely
 * importing this module cannot make production depend on scoped migrations.
 */
export function mountDashboardReadEndpoints({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  mountPeriodSummary = mountDashboardPeriodSummaryEndpoint,
  mountKpiDrilldown = mountDashboardKpiDrilldownEndpoint
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }
  requireFunction(mountPeriodSummary, 'mountPeriodSummary');
  requireFunction(mountKpiDrilldown, 'mountKpiDrilldown');

  if (!scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      periodSummary: null,
      kpiDrilldown: null
    });
  }

  const shared = {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  };

  const periodSummary = mountPeriodSummary(shared);
  if (!periodSummary?.mounted) {
    throw new Error('Dashboard period summary endpoint failed to mount');
  }

  const kpiDrilldown = mountKpiDrilldown(shared);
  if (!kpiDrilldown?.mounted) {
    throw new Error('Dashboard KPI drilldown endpoint failed to mount');
  }

  return Object.freeze({
    mounted: true,
    periodSummary,
    kpiDrilldown
  });
}

export const dashboardReadEndpointsContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  disabledModeRequiresNoRuntimeDependencies: true,
  scopeMode: 'tenant',
  legacyCapability: 'adminRead',
  staffTenantWideAccess: false,
  optionalLocationFilter: true,
  readOnly: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
