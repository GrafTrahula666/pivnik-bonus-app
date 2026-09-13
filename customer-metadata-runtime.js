import { createCustomer360ReadRepository } from './customer-360-read-repository.js';
import { createCustomerMetadataRepository } from './customer-metadata-repository.js';
import { createCustomerMetadataService } from './customer-metadata-service.js';

function requireDb(db) {
  if (!db || typeof db.query !== 'function') throw new TypeError('db.query is required');
}

function requireFactory(factory, name) {
  if (typeof factory !== 'function') throw new TypeError(`${name} must be a function`);
}

function scopeDenied() {
  return Object.assign(new Error('Customer is not visible in the requested tenant/location scope'), {
    code: 'customer_scope_denied'
  });
}

/**
 * Composition root for Customer 360 notes, tags and segments.
 *
 * Metadata writes must prove customer visibility through the same canonical
 * Customer 360 read boundary before the append-only metadata repository is
 * touched. This prevents a caller with a valid tenant/location membership from
 * mutating an arbitrary global customer id that is not visible in that scope.
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

  const service = createMetadataService({ repository: metadataRepository });
  const mutationNames = ['addNote', 'addTag', 'removeTag', 'addSegment', 'removeSegment'];
  for (const name of mutationNames) {
    if (typeof service?.[name] !== 'function') {
      throw new TypeError(`Customer metadata service must expose ${name}`);
    }
  }

  async function execute(name, input = {}) {
    const visible = await readRepository.isCustomerVisible(db, input.customerId, {
      authorizationContext: input.context,
      tenantId: input.tenantId,
      locationId: input.locationId
    });
    if (!visible) throw scopeDenied();
    return service[name](input);
  }

  return Object.freeze({
    addNote(input) {
      return execute('addNote', input);
    },
    addTag(input) {
      return execute('addTag', input);
    },
    removeTag(input) {
      return execute('removeTag', input);
    },
    addSegment(input) {
      return execute('addSegment', input);
    },
    removeSegment(input) {
      return execute('removeSegment', input);
    },
    readRepository,
    metadataRepository
  });
}

export const customerMetadataRuntimeContract = Object.freeze({
  visibilityBoundary: 'customer-360-read-repository',
  persistenceBoundary: 'customer-metadata-repository',
  appendOnly: true,
  scopedFallbackToGlobal: false,
  arbitraryGlobalCustomerMutationAllowed: false,
  duplicatesTenantOwnershipLogic: false,
  productionRouteWired: false,
  migrationApplied: false,
  externalDependenciesAdded: false
});
