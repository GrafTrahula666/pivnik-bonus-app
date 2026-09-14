import { mountCustomer360FullActionEndpoints } from './customer-360-full-action-endpoints.js';
import { mountCustomer360ReadEndpoint } from './customer-360-read-endpoint.js';
import { mountDashboardReadEndpoints } from './dashboard-read-endpoints.js';
import { mountDashboardSessionScopeEndpoint } from './dashboard-session-scope-endpoint.js';
import { createDashboardSessionScopeResolver } from './dashboard-session-scope-resolver.js';
import { mountDashboardScopeSelectionEndpoint } from './dashboard-scope-selection-endpoint.js';
import { createDashboardScopeSelectionResolver } from './dashboard-scope-selection-resolver.js';
import { mountDashboardScopeDirectoryEndpoint } from './dashboard-scope-directory-endpoint.js';
import { createDashboardScopeDirectoryResolver } from './dashboard-scope-directory-resolver.js';
import { createScopeDirectoryRepository } from './scope-directory-repository.js';
import { SPACEVERSE_RUNTIME } from './spaceverse-runtime.js';

export function mountSpaceverseServerComposition({
  app,
  runtime = SPACEVERSE_RUNTIME,
  resolveAuthorization,
  loadMemberships,
  db,
  executeAdjustment,
  grantAchievement,
  mountActionEndpoints = mountCustomer360FullActionEndpoints,
  mountCustomerReadEndpoint = mountCustomer360ReadEndpoint,
  mountDashboardEndpoints = mountDashboardReadEndpoints,
  createSessionScopeResolver = createDashboardSessionScopeResolver,
  mountSessionScopeEndpoint = mountDashboardSessionScopeEndpoint,
  createScopeSelectionResolver = createDashboardScopeSelectionResolver,
  createScopeDirectory = createScopeDirectoryRepository,
  mountScopeSelectionEndpoint = mountDashboardScopeSelectionEndpoint,
  createScopeDirectoryResolver = createDashboardScopeDirectoryResolver,
  mountScopeDirectoryEndpoint = mountDashboardScopeDirectoryEndpoint
} = {}) {
  if (!runtime || typeof runtime.scopedModeEnabled !== 'boolean') throw new TypeError('runtime.scopedModeEnabled must be boolean');
  if (typeof mountActionEndpoints !== 'function') throw new TypeError('mountActionEndpoints must be a function');
  if (typeof mountCustomerReadEndpoint !== 'function') throw new TypeError('mountCustomerReadEndpoint must be a function');
  if (typeof mountDashboardEndpoints !== 'function') throw new TypeError('mountDashboardEndpoints must be a function');
  if (typeof createSessionScopeResolver !== 'function') throw new TypeError('createSessionScopeResolver must be a function');
  if (typeof mountSessionScopeEndpoint !== 'function') throw new TypeError('mountSessionScopeEndpoint must be a function');
  if (typeof createScopeSelectionResolver !== 'function') throw new TypeError('createScopeSelectionResolver must be a function');
  if (typeof createScopeDirectory !== 'function') throw new TypeError('createScopeDirectory must be a function');
  if (typeof mountScopeSelectionEndpoint !== 'function') throw new TypeError('mountScopeSelectionEndpoint must be a function');
  if (typeof createScopeDirectoryResolver !== 'function') throw new TypeError('createScopeDirectoryResolver must be a function');
  if (typeof mountScopeDirectoryEndpoint !== 'function') throw new TypeError('mountScopeDirectoryEndpoint must be a function');

  if (!runtime.scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      actions: null,
      customer360Read: null,
      dashboard: null,
      dashboardSessionScope: null,
      dashboardScopeSelection: null,
      dashboardScopeDirectory: null
    });
  }

  if (!db || typeof db.query !== 'function') throw new TypeError('db.query must be a function');
  const shared = { app, scopedModeEnabled: true, resolveAuthorization, db };
  const actions = mountActionEndpoints({ ...shared, executeAdjustment, grantAchievement });
  if (!actions?.mounted) throw new Error('SPACEVERSE action endpoints failed to mount');

  const customer360Read = mountCustomerReadEndpoint(shared);
  if (!customer360Read?.mounted) throw new Error('SPACEVERSE Customer 360 read endpoint failed to mount');

  const dashboard = mountDashboardEndpoints(shared);
  if (!dashboard?.mounted) throw new Error('SPACEVERSE Dashboard endpoints failed to mount');

  const resolveSessionScope = createSessionScopeResolver({ loadMemberships, resolveAuthorization });
  const dashboardSessionScope = mountSessionScopeEndpoint({ app, scopedModeEnabled: true, resolveSessionScope });
  if (!dashboardSessionScope?.mounted) throw new Error('SPACEVERSE Dashboard session scope endpoint failed to mount');

  const scopeDirectory = createScopeDirectory({ query: (...args) => db.query(...args) });
  const selectDashboardScope = createScopeSelectionResolver({ loadMemberships, resolveAuthorization, scopeDirectory });
  const dashboardScopeSelection = mountScopeSelectionEndpoint({ app, scopedModeEnabled: true, selectDashboardScope });
  if (!dashboardScopeSelection?.mounted) throw new Error('SPACEVERSE Dashboard scope selection endpoint failed to mount');

  const resolveDashboardScopeDirectory = createScopeDirectoryResolver({
    loadMemberships,
    resolveAuthorization,
    scopeDirectory
  });
  const dashboardScopeDirectory = mountScopeDirectoryEndpoint({
    app,
    scopedModeEnabled: true,
    resolveDashboardScopeDirectory
  });
  if (!dashboardScopeDirectory?.mounted) throw new Error('SPACEVERSE Dashboard scope directory endpoint failed to mount');

  return Object.freeze({
    mounted: true,
    actions,
    customer360Read,
    dashboard,
    dashboardSessionScope,
    dashboardScopeSelection,
    dashboardScopeDirectory
  });
}

export const spaceverseServerCompositionContract = Object.freeze({
  productionEnabledByDefault: SPACEVERSE_RUNTIME.scopedModeEnabled,
  disabledModeRequiresNoRuntimeDependencies: true,
  includesCustomerMetadataActions: true,
  includesCustomer360ReadCard: true,
  includesDashboardPeriodSummary: true,
  includesDashboardKpiDrilldown: true,
  includesDashboardSessionScope: true,
  includesDashboardValidatedTenantSelection: true,
  includesDashboardRbacFilteredScopeDirectory: true,
  dashboardScopeComesFromServerMemberships: true,
  dashboardBrowserTenantSelectionGrantsNoAuthority: true,
  scopeSelectionUsesAuthoritativeDirectory: true,
  platformAdminSelectionRequiresAuthoritativeDirectory: true,
  locationSelectionRequiresAuthoritativeDirectory: true,
  scopeDirectoryOwnerReadsRestrictedToMemberships: true,
  ownsBusinessLogic: false,
  ownsPersistence: false,
  ownsAuthorizationRules: false,
  requiresMountBeforeLegacyApiBoundary: true,
  externalDependenciesAdded: false
});
