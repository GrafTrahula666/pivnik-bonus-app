function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function authorizationFromRequest(req) {
  const authorization = req?.spaceverseAuthorization;
  if (!authorization?.context) {
    throw Object.assign(new Error('SPACEVERSE authorization context is required'), {
      statusCode: 403,
      code: 'authorization_context_required'
    });
  }
  return authorization;
}

const VALUE_FIELDS = Object.freeze({
  addNote: 'note',
  addTag: 'tag',
  removeTag: 'tag',
  addSegment: 'segment',
  removeSegment: 'segment'
});

export function createCustomerMetadataRouteHandler({ mutation, execute } = {}) {
  const valueField = VALUE_FIELDS[mutation];
  if (!valueField) throw new TypeError(`Unknown customer metadata mutation: ${mutation || '<empty>'}`);
  requireFunction(execute, 'execute');

  return async function customerMetadataRouteHandler(req, res, next) {
    try {
      const authorization = authorizationFromRequest(req);
      const tenantId = authorization.requestedScope?.tenantId ?? req.params?.tenantId;
      const locationId = authorization.requestedScope?.locationId ?? req.params?.locationId;
      const result = await execute({
        context: authorization.context,
        tenantId,
        locationId,
        actorId: req.user?.id,
        customerId: req.params?.id,
        [valueField]: req.body?.[valueField],
        reason: req.body?.reason,
        requestKey: req.body?.requestKey
      });

      return res.json({
        ok: true,
        eventId: result?.id ?? null,
        eventType: result?.event_type ?? null,
        value: result?.value ?? null
      });
    } catch (error) {
      const code = String(error?.code || '');
      const statusByCode = {
        authorization_context_required: 403,
        invalid_scope: 403,
        insufficient_role: 403,
        scope_denied: 403,
        actor_required: 400,
        reason_required: 400,
        customer_scope_denied: 404,
        idempotency_conflict: 409,
        idempotency_replay_missing: 409
      };

      if (error instanceof TypeError) {
        return res.status(400).json({ error: error.message });
      }
      if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
        return res.status(error.statusCode).json({ error: error.message, code: code || undefined });
      }
      if (statusByCode[code]) {
        return res.status(statusByCode[code]).json({ error: error.message, code });
      }
      return next(error);
    }
  };
}

export const customerMetadataRouteHandlerContract = Object.freeze({
  requiresScopedAuthorizationMiddleware: true,
  requiresAuthorizationContext: true,
  delegatesCustomerVisibilityProof: true,
  delegatesAppendOnlyPersistence: true,
  exposesCrossTenantExistenceOnScopeDenial: false,
  ownsTransactions: false,
  supportedMutations: Object.freeze(Object.keys(VALUE_FIELDS)),
  productionRouteWired: false
});
