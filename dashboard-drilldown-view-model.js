const SUPPORTED_ROW_KINDS = Object.freeze(['transaction', 'client']);

function unwrapDrilldown(result) {
  const value = result?.drilldown ?? result;
  if (!value || typeof value !== 'object') {
    throw new TypeError('dashboard drilldown response must be an object');
  }
  return value;
}

function safeInteger(value, name, { allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  const normalized = typeof value === 'string' && /^-?\d+$/.test(value.trim())
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return normalized;
}

function safeText(value, name, { allowNull = true, maxLength = 200 } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (allowNull) return null;
    throw new TypeError(`${name} must be non-empty`);
  }
  if (normalized.length > maxLength) {
    throw new TypeError(`${name} exceeds display limit`);
  }
  return normalized;
}

function safeInstant(value, name, { allowNull = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowNull) return null;
    throw new TypeError(`${name} is required`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${name} must be a valid timestamp`);
  return parsed.toISOString();
}

function formatInteger(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatMoneyCents(value) {
  const sign = value < 0 ? '−' : '';
  const absolute = Math.abs(value);
  const rubles = Math.floor(absolute / 100);
  const kopecks = absolute % 100;
  return `${sign}${formatInteger(rubles)}${kopecks ? `,${String(kopecks).padStart(2, '0')}` : ''} ₽`;
}

function formatInstant(value) {
  if (!value) return '—';
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${day}.${month}.${year}, ${hours}:${minutes} UTC`;
}

function field(key, label, value, text) {
  return Object.freeze({ key, label, value, text });
}

function transactionRow(row) {
  if (!row || typeof row !== 'object') throw new TypeError('transaction row must be an object');

  const id = safeText(row.id, 'transaction.id', { allowNull: false, maxLength: 100 });
  const clientId = safeText(row.client_id, 'transaction.client_id', { maxLength: 100 });
  const locationId = safeText(row.location_id, 'transaction.location_id', { maxLength: 100 });
  const mode = safeText(row.mode, 'transaction.mode', { maxLength: 80 });
  const reason = safeText(row.reason, 'transaction.reason', { maxLength: 200 });
  const rewardCode = safeText(row.reward_code, 'transaction.reward_code', { maxLength: 120 });
  const checkCents = safeInteger(row.check_amount_cents ?? 0, 'transaction.check_amount_cents');
  const cashPaidCents = safeInteger(row.cash_paid_cents ?? 0, 'transaction.cash_paid_cents');
  const bonusEarned = safeInteger(row.bonus_earned ?? 0, 'transaction.bonus_earned');
  const bonusSpent = safeInteger(row.bonus_spent ?? 0, 'transaction.bonus_spent');
  const createdAt = safeInstant(row.created_at, 'transaction.created_at', { allowNull: false });
  const completedAt = safeInstant(row.completed_at, 'transaction.completed_at');

  return Object.freeze({
    kind: 'transaction',
    key: id,
    fields: Object.freeze([
      field('createdAt', 'Дата', createdAt, formatInstant(createdAt)),
      field('clientId', 'Клиент', clientId, clientId ?? '—'),
      field('locationId', 'Точка', locationId, locationId ?? '—'),
      field('mode', 'Тип', mode, mode ?? '—'),
      field('check', 'Чек', checkCents, formatMoneyCents(checkCents)),
      field('cashPaid', 'Оплачено', cashPaidCents, formatMoneyCents(cashPaidCents)),
      field('bonusEarned', 'Начислено', bonusEarned, formatInteger(bonusEarned)),
      field('bonusSpent', 'Списано', bonusSpent, formatInteger(bonusSpent)),
      field('reason', 'Причина', reason, reason ?? '—'),
      field('rewardCode', 'Награда', rewardCode, rewardCode ?? '—'),
      field('completedAt', 'Завершено', completedAt, formatInstant(completedAt))
    ])
  });
}

function clientRow(row) {
  if (!row || typeof row !== 'object') throw new TypeError('client row must be an object');

  const clientId = safeText(row.client_id, 'client.client_id', { allowNull: false, maxLength: 100 });
  const completedOps = safeInteger(row.completed_ops ?? 0, 'client.completed_ops');
  const checkCents = safeInteger(row.check_cents ?? 0, 'client.check_cents');
  const bonusIssued = safeInteger(row.bonus_issued ?? 0, 'client.bonus_issued');
  const bonusSpent = safeInteger(row.bonus_spent ?? 0, 'client.bonus_spent');
  const lastActivityAt = safeInstant(row.last_activity_at, 'client.last_activity_at', { allowNull: false });

  return Object.freeze({
    kind: 'client',
    key: clientId,
    fields: Object.freeze([
      field('clientId', 'Клиент', clientId, clientId),
      field('completedOps', 'Операций', completedOps, formatInteger(completedOps)),
      field('check', 'Сумма чеков', checkCents, formatMoneyCents(checkCents)),
      field('bonusIssued', 'Начислено', bonusIssued, formatInteger(bonusIssued)),
      field('bonusSpent', 'Списано', bonusSpent, formatInteger(bonusSpent)),
      field('lastActivityAt', 'Последняя активность', lastActivityAt, formatInstant(lastActivityAt))
    ])
  });
}

export function createDashboardDrilldownViewModel(result) {
  const drilldown = unwrapDrilldown(result);
  const rowKind = safeText(drilldown.rowKind, 'drilldown.rowKind', { allowNull: false, maxLength: 30 });
  if (!SUPPORTED_ROW_KINDS.includes(rowKind)) throw new TypeError('drilldown.rowKind is not supported');

  const sourceRows = Array.isArray(drilldown.rows)
    ? drilldown.rows
    : Array.isArray(drilldown.items)
      ? drilldown.items
      : null;
  if (!sourceRows) throw new TypeError('drilldown rows must be an array');

  const defaultLimit = sourceRows.length > 0 ? sourceRows.length : 1;
  const limit = safeInteger(drilldown.limit ?? defaultLimit, 'drilldown.limit');
  const offset = safeInteger(drilldown.offset ?? 0, 'drilldown.offset');
  if (limit < 1 || limit > 100) throw new RangeError('drilldown.limit must be between 1 and 100');
  if (offset < 0) throw new RangeError('drilldown.offset must not be negative');

  const rows = sourceRows.map(rowKind === 'transaction' ? transactionRow : clientRow);
  const hasMore = drilldown.hasMore === true;

  return Object.freeze({
    rowKind,
    rows: Object.freeze(rows),
    empty: rows.length === 0,
    hasMore,
    limit,
    offset,
    nextOffset: hasMore ? offset + limit : null,
    displayedFieldKeys: Object.freeze(rows[0]?.fields.map((item) => item.key) ?? [])
  });
}

export const dashboardDrilldownViewModelContract = Object.freeze({
  acceptedApiEnvelope: 'result.drilldown or direct drilldown object',
  acceptedRowsKeys: Object.freeze(['rows', 'items']),
  supportedRowKinds: SUPPORTED_ROW_KINDS,
  rawJsonRendering: false,
  unknownFieldsDisplayed: false,
  maxPageSize: 100,
  dependenciesAdded: false,
  productionWiringEnabled: false
});
