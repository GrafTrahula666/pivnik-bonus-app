import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomerMetadataRepository } from './customer-metadata-repository.js';
import { createCustomerMetadataService } from './customer-metadata-service.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
}

function requireFactory(factory, name) {
  if (typeof factory !== 'function') throw new TypeError(`${name} must be a function`);
}

/**
 * Composition root for Customer 360 notes, tags and segments.
 *
 * Metadata writes reuse the same canonical Customer 360 visibility proof as
 * reads. The service owns ordering so RBAC is evaluated before visibility and
 * append-only persistence, preventing unauthorized callers from probing global
 * customer ids through the visibility lookup.
 *
 * No HTTP route, migration or production rollout is enabled here.
 */
export function createCustomerMetadataRuntime({
  db,
  scopedReadsEnabled = false,
  createReadRepository = createCustomer360ReadRepository,
  createMetadataRepository = createCustomerMetadataRepository,
  createMetadataService = createCustomerMetadataService
} = {}) {
  requireDb(db);
  requireFactory(createReadRepository, 'createReadRepository');
  requireFactory(createMetadataRepository, 'createMetadataRepository');
  requireFactory(createMetadataService, 'createMetadataService');

  const readRepository = createReadRepository({ scopedReadsEnabled });
  if (!readRepository || typeof readRepository.isCustomerVisible !== 'function') {
    throw new TypeError('Customer 360 read repository must expose isCustomerVisible');
  }

  const metadataRepository = createMetadataRepository({
    query: db.query.bind(db)
  });
  if (!metadataRepository || typeof metadataRepository.appendEvent !== 'function') {
    throw new TypeError('Customer metadata repository must expose appendEvent');
  }

  const service = createMetadataService({
    repository: metadataRepository,
    assertCustomerVisible: ({ context, tenantId, locationId, customerId }) => (
      readRepository.isCustomerVisible(db, customerId, {
        authorizationContext: context,
        tenantId,
        locationId
      })
    )
  });

  const mutationNames = ['addNote', 'addTag', 'removeTag', 'addSegment', 'removeSegment'];
  for (const name of mutationNames) {
    if (typeof service?.[name] !== 'function') {
      throw new TypeError(`Customer metadata service must expose ${name}`);
    }
  }

  return Object.freeze({
    addNote: service.addNote,
    addTag: service.addTag,
    removeTag: service.removeTag,
    addSegment: service.addSegment,
    removeSegment: service.removeSegment,
    readRepository,
    metadataRepository
  });
}

export const customerMetadataRuntimeContract = Object.freeze({
  visibilityBoundary: 'customer-360-read-repository',
  persistenceBoundary: 'customer-metadata-repository',
  appendOnly: true,
  authorizationBeforeVisibilityProof: true,
  scopedFallbackToGlobal: false,
  arbitraryGlobalCustomerMutationAllowed: false,
  duplicatesTenantOwnershipLogic: false,
  productionRouteWired: false,
  migrationApplied: false,
  externalDependenciesAdded: false
});
