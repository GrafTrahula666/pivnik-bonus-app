import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomer360TimelineRead } from './customer-360-timeline-read.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
  return db;
}

function normalizeCustomerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('customerId must be a positive safe integer');
  return id;
}

/**
 * Read-only Customer 360 runtime.
 *
 * This layer deliberately composes existing scoped repositories instead of
 * introducing new SQL. Customer visibility, tenant/location predicates,
 * migration gating and bigint validation therefore remain owned by the
 * canonical read boundaries.
 */
export function createCustomer360ReadRuntime({ db, scopedReadsEnabled = false } = {}) {
  requireDb(db);
  const summaryRepository = createCustomer360ReadRepository({ scopedReadsEnabled });
  const timelineRepository = createCustomer360TimelineRead({
    query: (...args) => db.query(...args),
    scopedReadsEnabled
  });

  return Object.freeze({
    async getCustomerCard({
      customerId,
      authorizationContext,
      tenantId = null,
      locationId = null,
      timelineLimit = 25,
      timelineOffset = 0
    } = {}) {
      const normalizedCustomerId = normalizeCustomerId(customerId);
      const scope = { authorizationContext, tenantId, locationId };

      const summary = await summaryRepository.getCustomerSummary(db, normalizedCustomerId, scope);
      if (!summary) return null;

      const timeline = await timelineRepository.listCustomerTimeline(
        normalizedCustomerId,
        scope,
        { limit: timelineLimit, offset: timelineOffset }
      );

      return Object.freeze({
        customerId: normalizedCustomerId,
        identity: summary.identity,
        financial: summary.financial,
        timeline
      });
    }
  });
}

export const customer360ReadRuntimeContract = Object.freeze({
  readOnly: true,
  reusesCanonicalSummaryRepository: true,
  reusesCanonicalTimelineRepository: true,
  scopedFallbackToGlobal: false,
  syntheticMetrics: false,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
