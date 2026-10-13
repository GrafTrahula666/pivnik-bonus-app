import { createSqlDashboardKpiDrilldownRepository } from './dashboard-kpi-drilldown-repository.js';

export function createDashboardKpiDrilldownRuntime({ db, scopedReadsEnabled = false } = {}) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
  if (typeof scopedReadsEnabled !== 'boolean') throw new TypeError('scopedReadsEnabled must be boolean');

  const loadDashboardKpiDrilldown = createSqlDashboardKpiDrilldownRepository({
    query: (...args) => db.query(...args)
  });

  return Object.freeze({
    async getKpiDrilldown(scope) {
      if (!scopedReadsEnabled) {
        throw Object.assign(new Error('Scoped Dashboard reads are disabled until tenant attribution is enabled'), {
          statusCode: 503,
          code: 'scoped_reads_disabled'
        });
      }
      return loadDashboardKpiDrilldown(scope);
    }
  });
}

export const dashboardKpiDrilldownRuntimeContract = Object.freeze({
  readOnly: true,
  tenantAttributionRequired: true,
  failClosedWhenScopedReadsDisabled: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
