import { canAccessLocation, canAccessTenant } from './authorization-context.js';

const LEGACY_CAPABILITIES = new Set(['staff', 'adminRead', 'adminWrite']);
const SCOPE_MODES = new Set(['none', 'tenant', 'location']);

function normalizeScopeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function defaultScope(req) {
  return {
    tenantId: normalizeScopeValue(req?.params?.tenantId ?? req?.query?.tenantId),
    locationId: normalizeScopeValue(req?.params?.locationId ?? req?.query?.locationId)
  };
}

/**
 * Compatibility middleware for incrementally moving legacy admin endpoints to
 * the SPACEVERSE authorization contract.
 *
 * Important migration property: an unscoped legacy endpoint never becomes
 * accessible merely because a user has tenant membership. For scopeMode=none,
 * only the requested historical capability can pass. Tenant/location access is
 * considered only when the endpoint explicitly declares that scope.
 */
export function createScopedAuthorizationMiddleware({
  resolveAuthorization,
  legacyCapability,
  scopeMode = 'none',
  getScope = defaultScope
} = {}) {
  if (typeof resolveAuthorization !== 'function') {
    throw new TypeError('resolveAuthorization must be a function');
  }
  if (!LEGACY_CAPABILITIES.has(legacyCapability)) {
    throw new TypeError(`Unknown legacy capability: ${legacyCapability || '<empty>'}`);
  }
  if (!SCOPE_MODES.has(scopeMode)) {
    throw new TypeError(`Unknown scope mode: ${scopeMode}`);
  }
  if (typeof getScope !== 'function') {
    throw new TypeError('getScope must be a function');
  }

  return async function scopedAuthorization(req, res, next) {
    try {
      if (!req?.user?.id) {
        return res.status(401).json({ error: 'Требуется авторизация.' });
      }

      const requestedScope = getScope(req) || {};
      const tenantId = normalizeScopeValue(requestedScope.tenantId);
      const locationId = normalizeScopeValue(requestedScope.locationId);

      if (scopeMode === 'tenant' && !tenantId) {
        return res.status(400).json({ error: 'Не указан tenant scope.' });
      }
      if (scopeMode === 'location' && (!tenantId || !locationId)) {
        return res.status(400).json({ error: 'Не указан tenant/location scope.' });
      }

      const authorization = await resolveAuthorization({
        userId: req.user.id,
        platformRole: req.user.platformRole ?? null,
        legacyRole: req.user.role ?? null,
        tenantId,
        locationId
      });

      const legacyAllowed = Boolean(authorization?.legacyCapabilities?.[legacyCapability]);
      let scopedAllowed = false;

      if (scopeMode === 'tenant') {
        scopedAllowed = canAccessTenant(authorization?.context, tenantId);
      } else if (scopeMode === 'location') {
        scopedAllowed = canAccessLocation(authorization?.context, tenantId, locationId);
      }

      // During migration legacy rights remain compatible, while scoped rights
      // cannot grant access to a global/unscoped endpoint.
      if (!legacyAllowed && !scopedAllowed) {
        return res.status(403).json({ error: 'Недостаточно прав.' });
      }

      req.spaceverseAuthorization = Object.freeze({
        ...authorization,
        requestedScope: Object.freeze({ tenantId, locationId }),
        scopeMode
      });
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
