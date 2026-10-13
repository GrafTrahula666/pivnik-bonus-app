const ACTIONS = Object.freeze({
  addNote: Object.freeze({ valueField: 'note', label: 'служебную заметку' }),
  addTag: Object.freeze({ valueField: 'tag', label: 'тег' }),
  removeTag: Object.freeze({ valueField: 'tag', label: 'удаление тега' }),
  addSegment: Object.freeze({ valueField: 'segment', label: 'сегмент' }),
  removeSegment: Object.freeze({ valueField: 'segment', label: 'удаление сегмента' })
});

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function normalizeRequired(value, field, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  if (normalized.length > maxLength) throw new TypeError(`${field} must not exceed ${maxLength} characters`);
  return normalized;
}

export function createCustomerMetadataActionController({
  adapter,
  confirmAction,
  createRequestKey = () => globalThis.crypto?.randomUUID?.(),
  onChanged = async () => {}
} = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter is required');
  requireFunction(confirmAction, 'confirmAction');
  requireFunction(createRequestKey, 'createRequestKey');
  requireFunction(onChanged, 'onChanged');

  let pending = false;
  let disposed = false;

  async function execute(kind, input = {}) {
    if (disposed) throw new Error('Customer metadata action controller is disposed');
    if (pending) return Object.freeze({ ok: false, reason: 'already_pending' });

    const action = ACTIONS[kind];
    const mutation = adapter[kind];
    if (!action || typeof mutation !== 'function') throw new TypeError(`Unsupported metadata action: ${kind}`);

    const value = normalizeRequired(input[action.valueField], action.valueField, action.valueField === 'note' ? 2000 : action.valueField === 'segment' ? 120 : 80);
    const reason = normalizeRequired(input.reason, 'reason', 500);

    const confirmed = await confirmAction(Object.freeze({
      kind,
      label: action.label,
      value,
      reason
    }));
    if (!confirmed) return Object.freeze({ ok: false, reason: 'cancelled' });
    if (disposed) return Object.freeze({ ok: false, reason: 'disposed' });

    const requestKey = normalizeRequired(createRequestKey(), 'requestKey', 200);
    pending = true;
    try {
      const result = await mutation.call(adapter, {
        [action.valueField]: value,
        reason,
        requestKey
      });
      if (!disposed) await onChanged(Object.freeze({ kind, result }));
      return Object.freeze({ ok: true, result });
    } finally {
      pending = false;
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    return true;
  }

  return Object.freeze({
    execute,
    addNote(input) { return execute('addNote', input); },
    addTag(input) { return execute('addTag', input); },
    removeTag(input) { return execute('removeTag', input); },
    addSegment(input) { return execute('addSegment', input); },
    removeSegment(input) { return execute('removeSegment', input); },
    dispose,
    get pending() { return pending; },
    get disposed() { return disposed; }
  });
}

export const customerMetadataActionControllerContract = Object.freeze({
  explicitConfirmationRequired: true,
  reasonRequired: true,
  requestKeyGeneratedAfterConfirmation: true,
  actorSuppliedByServerSession: true,
  duplicateSubmitSuppressed: true,
  serverAuthorizationAuthoritative: true,
  refreshAfterSuccessSupported: true,
  productionNavigationWiring: false,
  dependenciesAdded: false
});
