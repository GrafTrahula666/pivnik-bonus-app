import {
  canAccessLocation,
  canManageTenant
} from './authorization-context.js';

const ACTIONS = Object.freeze({
  READ_PROFILE: 'customer.read',
  READ_HISTORY: 'customer.history.read',
  BONUS_ADJUST: 'bonus.adjust',
  ACHIEVEMENT_GRANT: 'achievement.grant',
  ACHIEVEMENT_REVOKE: 'achievement.revoke',
  NOTE_ADD: 'note.add',
  TAG_ADD: 'tag.add',
  TAG_REMOVE: 'tag.remove',
  SEGMENT_ADD: 'segment.add',
  SEGMENT_REMOVE: 'segment.remove'
});

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));
const MUTATING_ACTIONS = new Set([
  ACTIONS.BONUS_ADJUST,
  ACTIONS.ACHIEVEMENT_GRANT,
  ACTIONS.ACHIEVEMENT_REVOKE,
  ACTIONS.NOTE_ADD,
  ACTIONS.TAG_ADD,
  ACTIONS.TAG_REMOVE,
  ACTIONS.SEGMENT_ADD,
  ACTIONS.SEGMENT_REMOVE
]);
const TENANT_MANAGER_ACTIONS = new Set([
  ACTIONS.BONUS_ADJUST,
  ACTIONS.ACHIEVEMENT_GRANT,
  ACTIONS.ACHIEVEMENT_REVOKE
]);
const REASON_REQUIRED_ACTIONS = new Set([
  ACTIONS.BONUS_ADJUST,
  ACTIONS.ACHIEVEMENT_GRANT,
  ACTIONS.ACHIEVEMENT_REVOKE
]);
const CONFIRMATION_REQUIRED_ACTIONS = new Set([
  ACTIONS.BONUS_ADJUST,
  ACTIONS.ACHIEVEMENT_GRANT,
  ACTIONS.ACHIEVEMENT_REVOKE
]);

function normalizeIdentifier(value, field) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${field} is required`);
  }
  return String(value).trim();
}

function normalizeAction(value) {
  const action = normalizeIdentifier(value, 'action');
  if (!KNOWN_ACTIONS.has(action)) {
    throw new TypeError(`Unknown customer action: ${action}`);
  }
  return action;
}

function normalizeOptionalReason(value) {
  if (value === null || value === undefined) return null;
  const reason = String(value).trim();
  if (!reason) return null;
  if (reason.length > 500) {
    throw new TypeError('reason must not exceed 500 characters');
  }
  return reason;
}

/**
 * Pure authorization contract for Customer 360 actions.
 *
 * It does not write data and does not infer SPACEVERSE membership from legacy
 * users.role values. High-impact actions are intentionally stricter than basic
 * customer metadata operations: only tenant owners/platform admins may mutate
 * balances or achievements. Staff may only operate inside their exact location.
 */
export function evaluateCustomerAction({
  context,
  tenantId,
  locationId,
  action,
  actorId = null,
  reason = null
} = {}) {
  const normalizedTenantId = normalizeIdentifier(tenantId, 'tenantId');
  const normalizedLocationId = normalizeIdentifier(locationId, 'locationId');
  const normalizedAction = normalizeAction(action);
  const normalizedReason = normalizeOptionalReason(reason);
  const isMutation = MUTATING_ACTIONS.has(normalizedAction);
  const actor = isMutation ? normalizeIdentifier(actorId, 'actorId') : (actorId == null ? null : String(actorId).trim() || null);

  if (!canAccessLocation(context, normalizedTenantId, normalizedLocationId)) {
    return Object.freeze({
      allowed: false,
      code: 'scope_denied',
      action: normalizedAction,
      tenantId: normalizedTenantId,
      locationId: normalizedLocationId,
      actorId: actor,
      auditRequired: isMutation,
      confirmationRequired: CONFIRMATION_REQUIRED_ACTIONS.has(normalizedAction),
      reasonRequired: REASON_REQUIRED_ACTIONS.has(normalizedAction)
    });
  }

  if (TENANT_MANAGER_ACTIONS.has(normalizedAction) && !canManageTenant(context, normalizedTenantId)) {
    return Object.freeze({
      allowed: false,
      code: 'manager_required',
      action: normalizedAction,
      tenantId: normalizedTenantId,
      locationId: normalizedLocationId,
      actorId: actor,
      auditRequired: true,
      confirmationRequired: true,
      reasonRequired: true
    });
  }

  if (REASON_REQUIRED_ACTIONS.has(normalizedAction) && !normalizedReason) {
    return Object.freeze({
      allowed: false,
      code: 'reason_required',
      action: normalizedAction,
      tenantId: normalizedTenantId,
      locationId: normalizedLocationId,
      actorId: actor,
      auditRequired: true,
      confirmationRequired: true,
      reasonRequired: true
    });
  }

  return Object.freeze({
    allowed: true,
    code: 'allowed',
    action: normalizedAction,
    tenantId: normalizedTenantId,
    locationId: normalizedLocationId,
    actorId: actor,
    reason: normalizedReason,
    auditRequired: isMutation,
    confirmationRequired: CONFIRMATION_REQUIRED_ACTIONS.has(normalizedAction),
    reasonRequired: REASON_REQUIRED_ACTIONS.has(normalizedAction)
  });
}

export const customerActionPolicyContract = Object.freeze({
  actions: ACTIONS,
  legacyRolesCreateScope: false,
  highImpactActionsRequireTenantManager: true,
  highImpactActionsRequireReason: true,
  highImpactActionsRequireConfirmation: true,
  mutationsRequireActor: true,
  staffScope: 'exact-location',
  auditAllMutations: true
});
