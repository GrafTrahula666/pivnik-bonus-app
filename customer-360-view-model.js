function asObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}

function nullableText(value, maxLength = 500) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new RangeError('text value is too long');
  return normalized;
}

function safeInteger(value, name, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  return value;
}

function positiveCustomerId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('customerId must be a positive safe integer');
  return id;
}

function nullableIso(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function moneyFromCents(cents, name, { nullable = false } = {}) {
  const value = safeInteger(cents, name, { nullable });
  if (value === null) return null;
  return Object.freeze({ cents: value, rubles: value / 100 });
}

function normalizeIdentity(identity) {
  const source = asObject(identity, 'identity');
  const firstName = nullableText(source.firstName, 160);
  const lastName = nullableText(source.lastName, 160);
  const username = nullableText(source.username, 160);
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || (username ? `@${username}` : 'Клиент');
  return Object.freeze({
    id: positiveCustomerId(source.id),
    displayName,
    username,
    firstName,
    lastName,
    createdAt: nullableIso(source.createdAt, 'identity.createdAt'),
    photoUrl: nullableText(source.photoUrl, 2048),
    profileFrame: nullableText(source.profileFrame, 255),
    bonusBalance: safeInteger(source.bonusBalance, 'identity.bonusBalance', { nullable: true }),
    paidMlTotal: safeInteger(source.paidMlTotal, 'identity.paidMlTotal', { nullable: true }),
    giftMlBalance: safeInteger(source.giftMlBalance, 'identity.giftMlBalance', { nullable: true }),
    walletScoped: source.bonusBalance !== null && source.bonusBalance !== undefined
  });
}

function normalizeFinancial(financial) {
  const source = asObject(financial, 'financial');
  return Object.freeze({
    cashPaid: moneyFromCents(source.cashPaidCents, 'financial.cashPaidCents'),
    bonusCredited: safeInteger(source.bonusCredited, 'financial.bonusCredited'),
    bonusDebited: safeInteger(source.bonusDebited, 'financial.bonusDebited'),
    completedOperations: safeInteger(source.completedOperations, 'financial.completedOperations'),
    lastActivityAt: nullableIso(source.lastActivityAt, 'financial.lastActivityAt')
  });
}

function normalizeTimelineRow(row) {
  const source = asObject(row, 'timeline row');
  return Object.freeze({
    id: source.id === null || source.id === undefined ? null : String(source.id),
    mode: nullableText(source.mode, 40),
    status: nullableText(source.status, 40),
    checkAmount: moneyFromCents(source.checkAmountCents, 'timeline.checkAmountCents', { nullable: true }),
    cashPaid: moneyFromCents(source.cashPaidCents, 'timeline.cashPaidCents', { nullable: true }),
    bonusEarned: safeInteger(source.bonusEarned, 'timeline.bonusEarned', { nullable: true }),
    bonusSpent: safeInteger(source.bonusSpent, 'timeline.bonusSpent', { nullable: true }),
    reason: nullableText(source.reason, 500),
    rewardCode: nullableText(source.rewardCode, 160),
    createdAt: nullableIso(source.createdAt, 'timeline.createdAt'),
    completedAt: nullableIso(source.completedAt, 'timeline.completedAt'),
    cancelledAt: nullableIso(source.cancelledAt, 'timeline.cancelledAt'),
    cancelReason: nullableText(source.cancelReason, 500)
  });
}

function normalizeTimeline(timeline) {
  const source = asObject(timeline, 'timeline');
  const rows = Array.isArray(source.rows) ? source.rows.map(normalizeTimelineRow) : [];
  return Object.freeze({
    rows: Object.freeze(rows),
    hasMore: source.hasMore === true,
    limit: safeInteger(source.limit, 'timeline.limit'),
    offset: safeInteger(source.offset, 'timeline.offset')
  });
}

function normalizeLabel(row, kind) {
  const source = asObject(row, `${kind} label`);
  return Object.freeze({
    value: nullableText(source.value, 160),
    actorId: nullableText(source.actorId, 160),
    reason: nullableText(source.reason, 500),
    createdAt: nullableIso(source.createdAt, `${kind}.createdAt`)
  });
}

function normalizeMetadataEvent(row) {
  const source = asObject(row, 'metadata event');
  return Object.freeze({
    id: source.id === null || source.id === undefined ? null : String(source.id),
    actorId: nullableText(source.actorId, 160),
    type: nullableText(source.type, 80),
    value: nullableText(source.value, 1000),
    reason: nullableText(source.reason, 500),
    createdAt: nullableIso(source.createdAt, 'metadata.createdAt')
  });
}

function normalizeMetadata(metadata) {
  if (metadata === null || metadata === undefined) {
    return Object.freeze({ available: false, events: Object.freeze([]), tags: Object.freeze([]), segments: Object.freeze([]) });
  }
  const source = asObject(metadata, 'metadata');
  return Object.freeze({
    available: true,
    events: Object.freeze((Array.isArray(source.events) ? source.events : []).map(normalizeMetadataEvent)),
    tags: Object.freeze((Array.isArray(source.tags) ? source.tags : []).map((row) => normalizeLabel(row, 'tag'))),
    segments: Object.freeze((Array.isArray(source.segments) ? source.segments : []).map((row) => normalizeLabel(row, 'segment')))
  });
}

export function createCustomer360ViewModel(customer) {
  const source = asObject(customer, 'customer');
  const customerId = positiveCustomerId(source.customerId);
  const identity = normalizeIdentity(source.identity);
  if (identity.id !== customerId) throw new TypeError('Customer 360 identity does not match customerId');

  return Object.freeze({
    customerId,
    identity,
    financial: normalizeFinancial(source.financial),
    timeline: normalizeTimeline(source.timeline),
    metadata: normalizeMetadata(source.metadata)
  });
}

export const customer360ViewModelContract = Object.freeze({
  whitelistOnly: true,
  rawBackendObjectExposed: false,
  unknownFieldsIgnored: true,
  unsafeIntegersFailClosed: true,
  unknownFinancialValuesRemainNull: true,
  scopedUnknownWalletDisplayedAsZero: false,
  metadataUnavailableIsExplicit: true,
  dependenciesAdded: false,
  productionNavigationWiring: false
});
