import { createDashboardNetworkAdapter } from './dashboard-network-adapter.js';
import { createDashboardUiController } from './dashboard-ui-controller.js';

const PERIOD_PRESETS = Object.freeze({
  '7d': Object.freeze({ key: '7d', label: '7 дней', days: 7 }),
  '30d': Object.freeze({ key: '30d', label: '30 дней', days: 30 }),
  '90d': Object.freeze({ key: '90d', label: '90 дней', days: 90 })
});

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requireRoot(value) {
  if (!value || typeof value.replaceChildren !== 'function') {
    throw new TypeError('root must support replaceChildren');
  }
  return value;
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} must be non-empty`);
  if (normalized.length > 120) throw new RangeError(`${name} is too long`);
  return normalized;
}

function optionalIdentifier(value, name) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentifier(value, name);
}

function normalizeSessionScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('session scope must be an object');
  }
  return Object.freeze({
    tenantId: requireIdentifier(value.tenantId, 'session tenantId'),
    locationId: optionalIdentifier(value.locationId, 'session locationId')
  });
}

function requirePeriodKey(value) {
  if (typeof value !== 'string' || !Object.hasOwn(PERIOD_PRESETS, value)) {
    throw new RangeError('unsupported Dashboard period');
  }
  return value;
}

function toEpochMilliseconds(value) {
  const raw = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(raw)) throw new TypeError('clock must return a valid instant');
  return raw;
}

function periodFor(key, clock) {
  const preset = PERIOD_PRESETS[requirePeriodKey(key)];
  const endMs = toEpochMilliseconds(clock());
  const startMs = endMs - preset.days * 24 * 60 * 60 * 1000;
  return Object.freeze({
    key: preset.key,
    label: preset.label,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString()
  });
}

export function createDashboardPageComposition({
  root,
  documentRef = globalThis.document,
  resolveSessionScope,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  initialPeriod = '7d',
  networkAdapterFactory = createDashboardNetworkAdapter,
  uiControllerFactory = createDashboardUiController
} = {}) {
  const dashboardRoot = requireRoot(root);
  const getSessionScope = requireFunction(resolveSessionScope, 'resolveSessionScope');
  const request = requireFunction(fetchImpl, 'fetchImpl');
  const now = requireFunction(clock, 'clock');
  const createAdapter = requireFunction(networkAdapterFactory, 'networkAdapterFactory');
  const createController = requireFunction(uiControllerFactory, 'uiControllerFactory');
  let selectedPeriod = requirePeriodKey(initialPeriod);

  let mounted = false;
  let lifecycleVersion = 0;
  let sessionScope = null;
  let controller = null;

  function teardownController() {
    if (controller?.mounted) controller.unmount();
    controller = null;
  }

  function buildController() {
    if (!mounted || !sessionScope) return null;
    const period = periodFor(selectedPeriod, now);
    const adapter = createAdapter({
      tenantId: sessionScope.tenantId,
      locationId: sessionScope.locationId,
      start: period.start,
      end: period.end,
      fetchImpl: request
    });
    controller = createController({
      root: dashboardRoot,
      documentRef,
      loadSummary: adapter.loadSummary,
      loadDrilldown: adapter.loadDrilldown
    });
    controller.mount();
    return controller;
  }

  async function mount() {
    if (mounted) return false;
    mounted = true;
    const version = ++lifecycleVersion;
    try {
      const resolved = await getSessionScope();
      if (!mounted || version !== lifecycleVersion) return false;
      sessionScope = normalizeSessionScope(resolved);
      buildController();
      return true;
    } catch (error) {
      if (mounted && version === lifecycleVersion) {
        mounted = false;
        sessionScope = null;
        teardownController();
        dashboardRoot.replaceChildren();
      }
      throw error;
    }
  }

  function unmount() {
    if (!mounted) return false;
    mounted = false;
    lifecycleVersion += 1;
    sessionScope = null;
    teardownController();
    dashboardRoot.replaceChildren();
    return true;
  }

  function selectPeriod(periodKey) {
    const next = requirePeriodKey(periodKey);
    if (next === selectedPeriod) return false;
    selectedPeriod = next;
    if (mounted && sessionScope) {
      teardownController();
      buildController();
    }
    return true;
  }

  return Object.freeze({
    mount,
    unmount,
    selectPeriod,
    get mounted() { return mounted; },
    get periodKey() { return selectedPeriod; },
    get periodOptions() { return Object.values(PERIOD_PRESETS).map(({ key, label }) => Object.freeze({ key, label })); }
  });
}

export const dashboardPageCompositionContract = Object.freeze({
  autoMount: false,
  productionNavigationWiring: false,
  scopeSource: 'authorized-session-resolver-only',
  acceptsTenantFromDom: false,
  acceptsTenantFromUrl: false,
  acceptsLocationFromDom: false,
  acceptsLocationFromUrl: false,
  supportedPeriods: Object.freeze(Object.keys(PERIOD_PRESETS)),
  periodScopeMutation: false,
  readOnly: true,
  dependenciesAdded: false,
  environmentVariablesAdded: false
});
