import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomer360TimelineRead } from './customer-360-timeline-read.js';
import { createCustomerMetadataRepository } from './customer-metadata-repository.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
  return db;
}

function requireFactory(factory, name) {
  if (typeof factory !== 'function') throw new TypeError(`${name} must be a function`);
  return factory;
}

function normalizeCustomerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('customerId must be a positive safe integer');
  return id;
}

function normalizeMetadataEvent(row) {
  return Object.freeze({
    id: row.id === null || row.id === undefined ? null : String(row.id),
    tenantId: String(row.tenant_id),
    locationId: row.location_id === null || row.location_id === undefined ? null : String(row.location_id),
    customerId: String(row.customer_id),
    actorId: String(row.actor_id),
    type: String(row.event_type),
    value: String(row.value),
    reason: String(row.reason),
    requestKey: String(row.request_key),
    createdAt: row.created_at ?? null
  });
}

function normalizeCurrentLabels(rows) {
  const tags = [];
  const segments = [];
  for (const row of rows || []) {
    const target = row.label_kind === 'tag' ? tags : row.label_kind === 'segment' ? segments : null;
    if (!target) continue;
    target.push(Object.freeze({
      value: String(row.value),
      actorId: String(row.actor_id),
      reason: String(row.reason),
      createdAt: row.created_at ?? null
    }));
  }
  return Object.freeze({ tags: Object.freeze(tags), segments: Object.freeze(segments) });
}

/**
 * Read-only Customer 360 runtime.
 *
 * This layer deliberately composes existing scoped repositories instead of
 * introducing new SQL. Customer visibility, tenant/location predicates,
 * migration gating and bigint validation therefore remain owned by the
 * canonical read boundaries.
 *
 * Customer metadata is additionally gated because migration 010 is additive
 * and intentionally not part of startup migrations. Environments without that
 * table therefore keep the existing Customer 360 card working and receive
 * metadata: null rather than an accidental database error.
 */
export function createCustomer360ReadRuntime({
  db,
  scopedReadsEnabled = false,
  metadataReadsEnabled = false,
  createMetadataRepository = createCustomerMetadataRepository
} = {}) {
  requireDb(db);
  if (typeof metadataReadsEnabled !== 'boolean') throw new TypeError('metadataReadsEnabled must be boolean');
  requireFactory(createMetadataRepository, 'createMetadataRepository');

  const summaryRepository = createCustomer360ReadRepository({ scopedReadsEnabled });
  const timelineRepository = createCustomer360TimelineRead({
    query: (...args) => db.query(...args),
    scopedReadsEnabled
  });
  const metadataRepository = metadataReadsEnabled
    ? createMetadataRepository({ query: db.query.bind(db) })
    : null;

  if (metadataRepository) {
    if (typeof metadataRepository.listEvents !== 'function') {
      throw new TypeError('Customer metadata repository must expose listEvents');
    }
    if (typeof metadataRepository.listCurrentLabels !== 'function') {
      throw new TypeError('Customer metadata repository must expose listCurrentLabels');
    }
  }

  return Object.freeze({
    async getCustomerCard({
      customerId,
      authorizationContext,
      tenantId = null,
      locationId = null,
      timelineLimit = 25,
      timelineOffset = 0,
      metadataLimit = 50,
      metadataOffset = 0
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

      let metadata = null;
      if (metadataRepository) {
        const metadataScope = {
          tenantId,
          locationId,
          customerId: normalizedCustomerId
        };
        const [events, currentLabels] = await Promise.all([
          metadataRepository.listEvents({
            ...metadataScope,
            limit: metadataLimit,
            offset: metadataOffset
          }),
          metadataRepository.listCurrentLabels(metadataScope)
        ]);
        const labels = normalizeCurrentLabels(currentLabels);
        metadata = Object.freeze({
          events: Object.freeze((events || []).map(normalizeMetadataEvent)),
          tags: labels.tags,
          segments: labels.segments
        });
      }

      return Object.freeze({
        customerId: normalizedCustomerId,
        identity: summary.identity,
        financial: summary.financial,
        timeline,
        metadata
      });
    }
  });
}

export const customer360ReadRuntimeContract = Object.freeze({
  readOnly: true,
  reusesCanonicalSummaryRepository: true,
  reusesCanonicalTimelineRepository: true,
  reusesCanonicalMetadataRepository: true,
  metadataMigration: '010_spaceverse_customer_metadata.sql',
  metadataFailClosedByDefault: true,
  scopedFallbackToGlobal: false,
  syntheticMetrics: false,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
