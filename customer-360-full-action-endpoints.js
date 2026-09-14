import { mountCustomer360ActionEndpoints } from './customer-360-action-endpoints.js';
import { mountCustomerMetadataEndpoints } from './customer-metadata-endpoint.js';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

/**
 * Additive composition boundary that keeps all Customer 360 write capabilities
 * behind the same explicit scoped rollout decision without changing the
 * existing production server composition.
 */
export function mountCustomer360FullActionEndpoints({
  app,
  scopedModeEnabled = false,
  resolveAuthorization,
  db,
  executeAdjustment,
  grantAchievement,
  mountCoreActionEndpoints = mountCustomer360ActionEndpoints,
  mountMetadataEndpoints = mountCustomerMetadataEndpoints
} = {}) {
  if (typeof scopedModeEnabled !== 'boolean') {
    throw new TypeError('scopedModeEnabled must be boolean');
  }

  if (!scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      core: null,
      metadata: null
    });
  }

  requireFunction(mountCoreActionEndpoints, 'mountCoreActionEndpoints');
  requireFunction(mountMetadataEndpoints, 'mountMetadataEndpoints');

  const shared = {
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db
  };

  const core = mountCoreActionEndpoints({
    ...shared,
    executeAdjustment,
    grantAchievement
  });
  if (!core?.mounted) {
    throw new Error('Customer 360 core action endpoints failed to mount');
  }

  const metadata = mountMetadataEndpoints(shared);
  if (!metadata?.mounted) {
    throw new Error('Customer 360 metadata endpoints failed to mount');
  }

  return Object.freeze({
    mounted: true,
    core,
    metadata
  });
}

export const customer360FullActionEndpointsContract = Object.freeze({
  failClosedWhenScopedModeDisabled: true,
  sharedScopedRolloutBoundary: true,
  metadataUsesCanonicalCustomerVisibilityProof: true,
  metadataRemainsLocationScoped: true,
  productionEnabledByDefault: false,
  externalDependenciesAdded: false
});
