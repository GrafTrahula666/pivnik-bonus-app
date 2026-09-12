import { mountCustomer360ActionEndpoints } from './customer-360-action-endpoints.js';
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
  db,
  executeAdjustment,
  grantAchievement,
  mountActionEndpoints = mountCustomer360ActionEndpoints
} = {}) {
  if (!runtime || typeof runtime.scopedModeEnabled !== 'boolean') {
    throw new TypeError('runtime.scopedModeEnabled must be boolean');
  }
  if (typeof mountActionEndpoints !== 'function') {
    throw new TypeError('mountActionEndpoints must be a function');
  }

  if (!runtime.scopedModeEnabled) {
    return Object.freeze({
      mounted: false,
      actions: null
    });
  }

  const actions = mountActionEndpoints({
    app,
    scopedModeEnabled: true,
    resolveAuthorization,
    db,
    executeAdjustment,
    grantAchievement
  });

  if (!actions?.mounted) {
    throw new Error('SPACEVERSE action endpoints failed to mount');
  }

  return Object.freeze({
    mounted: true,
    actions
  });
}

export const spaceverseServerCompositionContract = Object.freeze({
  productionEnabledByDefault: SPACEVERSE_RUNTIME.scopedModeEnabled,
  disabledModeRequiresNoRuntimeDependencies: true,
  ownsBusinessLogic: false,
  ownsPersistence: false,
  ownsAuthorizationRules: false,
  requiresMountBeforeLegacyApiBoundary: true,
  externalDependenciesAdded: false
});
