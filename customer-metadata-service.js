import {
  customerActionPolicyContract,
  evaluateCustomerAction
} from './customer-action-policy.js';

const ACTIONS = customerActionPolicyContract.actions;

const MUTATIONS = Object.freeze({
  addNote: Object.freeze({ action: ACTIONS.NOTE_ADD, eventType: 'note_added', valueField: 'note', maxLength: 2000 }),
  addTag: Object.freeze({ action: ACTIONS.TAG_ADD, eventType: 'tag_added', valueField: 'tag', maxLength: 80 }),
  removeTag: Object.freeze({ action: ACTIONS.TAG_REMOVE, eventType: 'tag_removed', valueField: 'tag', maxLength: 80 }),
  addSegment: Object.freeze({ action: ACTIONS.SEGMENT_ADD, eventType: 'segment_added', valueField: 'segment', maxLength: 120 }),
  removeSegment: Object.freeze({ action: ACTIONS.SEGMENT_REMOVE, eventType: 'segment_removed', valueField: 'segment', maxLength: 120 })
});

function normalizeRequired(value, field, maxLength = 500) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  const normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new TypeError(`${field} must not exceed ${maxLength} characters`);
  }
  return normalized;
}

function requireRepository(repository) {
  if (!repository || typeof repository.appendEvent !== 'function') {
    throw new TypeError('repository.appendEvent must be a function');
  }
}

function denied(decision) {
  return Object.assign(new Error(`Customer action denied: ${decision.code}`), {
    code: decision.code,
    decision
  });
}

/**
 * Authorized Customer 360 orchestration for notes, tags and segments.
 *
 * The repository remains persistence-only. This service is the boundary that
 * applies SPACEVERSE tenant/location RBAC before any append-only metadata event
 * can be written. Every command carries actor, reason and request key so manual
 * CRM mutations are attributable and idempotent.
 */
export function createCustomerMetadataService({ repository } = {}) {
  requireRepository(repository);

  async function execute(kind, input = {}) {
    const config = MUTATIONS[kind];
    if (!config) throw new TypeError(`Unknown customer metadata mutation: ${kind}`);

    const customerId = normalizeRequired(input.customerId, 'customerId', 200);
    const requestKey = normalizeRequired(input.requestKey, 'requestKey', 200);
    const reason = normalizeRequired(input.reason, 'reason', 500);
    const value = normalizeRequired(input[config.valueField], config.valueField, config.maxLength);

    const decision = evaluateCustomerAction({
      context: input.context,
      tenantId: input.tenantId,
      locationId: input.locationId,
      action: config.action,
      actorId: input.actorId,
      reason
    });

    if (!decision.allowed) throw denied(decision);

    return repository.appendEvent({
      tenantId: decision.tenantId,
      locationId: decision.locationId,
      customerId,
      actorId: decision.actorId,
      eventType: config.eventType,
      value,
      reason,
      requestKey
    });
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
    }
  });
}

export const customerMetadataServiceContract = Object.freeze({
  appendOnly: true,
  requiresAuthorizedTenantLocation: true,
  requiresActor: true,
  requiresReason: true,
  requiresIdempotencyKey: true,
  staffMayMutateOwnLocationMetadata: true,
  financialActionsIncluded: false,
  achievementActionsIncluded: false,
  productionRouteWired: false,
  mutations: Object.freeze(
    Object.fromEntries(
      Object.entries(MUTATIONS).map(([name, config]) => [name, Object.freeze({
        action: config.action,
        eventType: config.eventType
      })])
    )
  )
});
