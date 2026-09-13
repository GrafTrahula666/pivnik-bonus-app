import { createSqlDashboardPeriodSummaryRepository } from './dashboard-period-summary-repository.js';
import { createDashboardPeriodSummaryService } from './dashboard-period-summary-service.js';

/**
 * Compose the read-only Dashboard period summary over tenant-attributed
 * transactions. The runtime is deliberately migration-gated: callers must
 * explicitly enable scoped reads before any query can be executed.
 */
export function createDashboardPeriodSummaryRuntime({ db, scopedReadsEnabled = false } = {}) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
  if (typeof scopedReadsEnabled !== 'boolean') throw new TypeError('scopedReadsEnabled must be boolean');

  const loadPeriodSummary = createSqlDashboardPeriodSummaryRepository({
    query: (...args) => db.query(...args)
  });
  const getPeriodSummary = createDashboardPeriodSummaryService({ loadPeriodSummary });

  return Object.freeze({
    async getPeriodSummary(scope) {
      if (!scopedReadsEnabled) {
        throw Object.assign(new Error('Scoped Dashboard reads are disabled until tenant attribution is enabled'), {
          statusCode: 503,
          code: 'scoped_reads_disabled'
        });
      }
      return getPeriodSummary(scope);
    }
  });
}

export const dashboardPeriodSummaryRuntimeContract = Object.freeze({
  readOnly: true,
  tenantAttributionRequired: true,
  failClosedWhenScopedReadsDisabled: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
