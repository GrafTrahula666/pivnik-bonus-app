import { createDashboardPageComposition } from './dashboard-page-composition.js';
import { createDashboardScopeBrowserAdapter } from './dashboard-scope-browser-adapter.js';
import { createDashboardSessionScopeAdapter } from './dashboard-session-scope-adapter.js';

const PERIOD_OPTIONS = Object.freeze([
  Object.freeze({ key: '7d', label: '7 дней' }),
  Object.freeze({ key: '30d', label: '30 дней' }),
  Object.freeze({ key: '90d', label: '90 дней' })
]);

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

function requireDocument(value) {
  if (!value || typeof value.createElement !== 'function') {
    throw new TypeError('documentRef must support createElement');
  }
  return value;
}

function appendTextElement(documentRef, parent, tagName, className, text) {
  const node = documentRef.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function errorCode(error) {
  return typeof error?.message === 'string' ? error.message.trim() : '';
}

function buildErrorState(documentRef, message = 'Не удалось безопасно определить доступ к данным. Попробуйте открыть раздел позже.') {
  const state = documentRef.createElement('section');
  state.className = 'sv-dashboard-state sv-dashboard-state--error';
  state.setAttribute('role', 'alert');
  appendTextElement(documentRef, state, 'h2', 'sv-dashboard-state__title', 'Dashboard недоступен');
  appendTextElement(documentRef, state, 'p', 'sv-dashboard-state__message', message);
  return state;
}

function buildLoadingState(documentRef, message = 'Проверяем доступ к выбранному scope…') {
  const state = documentRef.createElement('section');
  state.className = 'sv-dashboard-state sv-dashboard-state--loading';
  state.setAttribute('role', 'status');
  appendTextElement(documentRef, state, 'p', 'sv-dashboard-state__message', message);
  return state;
}

function replaceOptions(documentRef, select, options, { emptyLabel = null } = {}) {
  const nodes = [];
  if (emptyLabel !== null) {
    const option = documentRef.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    nodes.push(option);
  }
  for (const item of options) {
    const option = documentRef.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    nodes.push(option);
  }
  select.replaceChildren(...nodes);
}

/**
 * Isolated browser shell for the owner Dashboard.
 *
 * Tenant/location values never become authority on the client. Initial scope is
 * read from the fixed session endpoint. Selector values come from the
 * RBAC-filtered directory and every selection is revalidated by the server;
 * only the exact scope returned by that selection endpoint is used for data.
 */
export function createDashboardPageShell({
  root,
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  compositionFactory = createDashboardPageComposition,
  sessionScopeAdapterFactory = createDashboardSessionScopeAdapter,
  scopeBrowserAdapterFactory = createDashboardScopeBrowserAdapter
} = {}) {
  const pageRoot = requireRoot(root);
  const documentApi = requireDocument(documentRef);
  const createComposition = requireFunction(compositionFactory, 'compositionFactory');
  const createSessionScopeAdapter = requireFunction(sessionScopeAdapterFactory, 'sessionScopeAdapterFactory');
  const createScopeBrowserAdapter = requireFunction(scopeBrowserAdapterFactory, 'scopeBrowserAdapterFactory');
  const request = requireFunction(fetchImpl, 'fetchImpl');

  let mounted = false;
  let lifecycleVersion = 0;
  let scopeVersion = 0;
  let composition = null;
  let selectedPeriod = '7d';
  let selectedScope = null;
  let periodButtons = new Map();
  let contentRoot = null;
  let scopeStatus = null;
  let tenantSelect = null;
  let locationSelect = null;
  let scopeControls = null;
  let directoryTenants = [];
  let directoryLocations = [];

  const resolveSessionScope = createSessionScopeAdapter({ fetchImpl: request });
  const scopeAdapter = createScopeBrowserAdapter({ fetchImpl: request });

  function syncPeriodButtons() {
    for (const [key, button] of periodButtons) {
      const selected = key === selectedPeriod;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.dataset.selected = selected ? 'true' : 'false';
    }
  }

  function setScopeBusy(busy, message = '') {
    if (tenantSelect) tenantSelect.disabled = busy;
    if (locationSelect) locationSelect.disabled = busy || !selectedScope;
    if (scopeStatus) {
      scopeStatus.textContent = message;
      scopeStatus.setAttribute('aria-live', 'polite');
    }
  }

  function syncScopeSelections() {
    if (!selectedScope) return;
    if (tenantSelect) tenantSelect.value = selectedScope.tenantId;
    if (locationSelect) locationSelect.value = selectedScope.locationId ?? '';
  }

  function teardownComposition() {
    if (composition?.mounted) composition.unmount();
    composition = null;
  }

  function showContentLoading(message) {
    if (contentRoot) contentRoot.replaceChildren(buildLoadingState(documentApi, message));
  }

  function showContentError(message) {
    if (contentRoot) contentRoot.replaceChildren(buildErrorState(documentApi, message));
  }

  async function mountValidatedScope(scope, version) {
    if (!mounted || version !== scopeVersion) return false;
    selectedScope = Object.freeze({ tenantId: scope.tenantId, locationId: scope.locationId ?? null });
    composition = createComposition({
      root: contentRoot,
      documentRef: documentApi,
      resolveSessionScope: async () => selectedScope,
      fetchImpl: request,
      clock,
      initialPeriod: selectedPeriod
    });
    const didMount = await composition.mount();
    if (!mounted || version !== scopeVersion) {
      if (composition?.mounted) composition.unmount();
      return false;
    }
    selectedPeriod = composition.periodKey;
    syncPeriodButtons();
    syncScopeSelections();
    return didMount;
  }

  function renderTenantDirectory(tenants) {
    directoryTenants = tenants;
    replaceOptions(
      documentApi,
      tenantSelect,
      tenants.map((tenant) => ({ value: tenant.tenantId, label: tenant.displayName })),
      { emptyLabel: tenants.length ? 'Выберите заведение' : 'Нет доступных заведений' }
    );
    tenantSelect.disabled = tenants.length === 0;
    if (selectedScope && tenants.some((tenant) => tenant.tenantId === selectedScope.tenantId)) {
      tenantSelect.value = selectedScope.tenantId;
    }
  }

  function renderLocationDirectory(locations) {
    directoryLocations = locations;
    replaceOptions(
      documentApi,
      locationSelect,
      locations.map((location) => ({ value: location.locationId, label: location.displayName })),
      { emptyLabel: 'Все точки' }
    );
    locationSelect.disabled = !selectedScope;
    syncScopeSelections();
  }

  async function loadLocations(tenantId, version) {
    const result = await scopeAdapter.loadLocations(tenantId);
    if (!mounted || version !== scopeVersion || selectedScope?.tenantId !== tenantId) return false;
    renderLocationDirectory(result.locations);
    return true;
  }

  async function selectAndMountScope({ tenantId, locationId = null }, { loadTenantLocations = false } = {}) {
    const version = ++scopeVersion;
    teardownComposition();
    selectedScope = null;
    directoryLocations = [];
    renderLocationDirectory([]);
    showContentLoading('Проверяем доступ и загружаем выбранные данные…');
    setScopeBusy(true, 'Проверяем права доступа…');

    try {
      const validatedScope = await scopeAdapter.selectScope({ tenantId, locationId });
      if (!mounted || version !== scopeVersion) return false;
      const didMount = await mountValidatedScope(validatedScope, version);
      if (!didMount || !mounted || version !== scopeVersion) return false;
      setScopeBusy(false, '');
      if (loadTenantLocations) {
        try {
          await loadLocations(validatedScope.tenantId, version);
        } catch {
          if (mounted && version === scopeVersion) {
            renderLocationDirectory([]);
            if (scopeStatus) scopeStatus.textContent = 'Список точек временно недоступен. Данные заведения остаются доступны.';
          }
        }
      }
      return true;
    } catch {
      if (!mounted || version !== scopeVersion) return false;
      selectedScope = null;
      renderLocationDirectory([]);
      setScopeBusy(false, 'Не удалось подтвердить выбранный scope.');
      showContentError('Выбранный scope не прошёл серверную проверку доступа.');
      return false;
    }
  }

  async function handleTenantChange() {
    const tenantId = tenantSelect?.value || '';
    if (!tenantId || !directoryTenants.some((tenant) => tenant.tenantId === tenantId)) return false;
    return selectAndMountScope({ tenantId }, { loadTenantLocations: true });
  }

  async function handleLocationChange() {
    if (!selectedScope) return false;
    const locationId = locationSelect?.value || null;
    if (locationId && !directoryLocations.some((location) => location.locationId === locationId)) return false;
    return selectAndMountScope({ tenantId: selectedScope.tenantId, locationId });
  }

  function buildScopeControls() {
    scopeControls = documentApi.createElement('div');
    scopeControls.className = 'sv-dashboard-page__scope-controls';
    scopeControls.setAttribute('aria-label', 'Scope Dashboard');

    const tenantField = documentApi.createElement('label');
    tenantField.className = 'sv-dashboard-page__scope-field';
    appendTextElement(documentApi, tenantField, 'span', 'sv-dashboard-page__scope-label', 'Заведение');
    tenantSelect = documentApi.createElement('select');
    tenantSelect.className = 'sv-dashboard-page__scope-select';
    tenantSelect.dataset.scopeSelector = 'tenant';
    tenantSelect.disabled = true;
    tenantSelect.addEventListener('change', () => { void handleTenantChange(); });
    tenantField.append(tenantSelect);

    const locationField = documentApi.createElement('label');
    locationField.className = 'sv-dashboard-page__scope-field';
    appendTextElement(documentApi, locationField, 'span', 'sv-dashboard-page__scope-label', 'Точка');
    locationSelect = documentApi.createElement('select');
    locationSelect.className = 'sv-dashboard-page__scope-select';
    locationSelect.dataset.scopeSelector = 'location';
    locationSelect.disabled = true;
    locationSelect.addEventListener('change', () => { void handleLocationChange(); });
    locationField.append(locationSelect);

    scopeStatus = documentApi.createElement('p');
    scopeStatus.className = 'sv-dashboard-page__scope-status';
    scopeStatus.setAttribute('role', 'status');

    scopeControls.append(tenantField, locationField, scopeStatus);
    return scopeControls;
  }

  function buildShell() {
    const page = documentApi.createElement('section');
    page.className = 'sv-dashboard-page';
    page.setAttribute('aria-label', 'SPACEVERSE Dashboard');

    const header = documentApi.createElement('header');
    header.className = 'sv-dashboard-page__header';
    appendTextElement(documentApi, header, 'p', 'sv-dashboard-page__eyebrow', 'SPACEVERSE');
    appendTextElement(documentApi, header, 'h1', 'sv-dashboard-page__title', 'Dashboard владельца');
    appendTextElement(
      documentApi,
      header,
      'p',
      'sv-dashboard-page__description',
      'Подтверждённые показатели по выбранному периоду без расчётных замен и фиктивных значений.'
    );
    page.append(header);

    const controls = documentApi.createElement('div');
    controls.className = 'sv-dashboard-page__controls';
    controls.append(buildScopeControls());

    const periodGroup = documentApi.createElement('div');
    periodGroup.className = 'sv-dashboard-page__periods';
    periodGroup.setAttribute('role', 'group');
    periodGroup.setAttribute('aria-label', 'Период Dashboard');

    periodButtons = new Map();
    for (const option of PERIOD_OPTIONS) {
      const button = documentApi.createElement('button');
      button.type = 'button';
      button.className = 'sv-dashboard-page__period-button';
      button.textContent = option.label;
      button.dataset.period = option.key;
      button.addEventListener('click', () => {
        if (!mounted) return;
        selectedPeriod = option.key;
        if (composition) composition.selectPeriod(option.key);
        syncPeriodButtons();
      });
      periodButtons.set(option.key, button);
      periodGroup.append(button);
    }
    controls.append(periodGroup);
    page.append(controls);

    contentRoot = documentApi.createElement('div');
    contentRoot.className = 'sv-dashboard-page__content';
    page.append(contentRoot);

    syncPeriodButtons();
    return page;
  }

  async function loadTenantDirectory(version) {
    const tenants = await scopeAdapter.loadTenants();
    if (!mounted || version !== lifecycleVersion) return false;
    renderTenantDirectory(tenants);
    return true;
  }

  async function mount() {
    if (mounted) return false;
    mounted = true;
    const lifecycle = ++lifecycleVersion;
    const version = ++scopeVersion;
    const page = buildShell();
    pageRoot.replaceChildren(page);
    showContentLoading('Определяем доступный scope…');
    setScopeBusy(true, 'Загружаем доступные заведения…');

    let initialScope = null;
    try {
      initialScope = await resolveSessionScope();
    } catch (error) {
      if (!mounted || lifecycle !== lifecycleVersion) return false;
      if (errorCode(error) !== 'scope_selection_required') {
        setScopeBusy(false, '');
        showContentError();
        return false;
      }
    }

    if (!mounted || lifecycle !== lifecycleVersion) return false;

    if (initialScope) {
      try {
        await mountValidatedScope(initialScope, version);
      } catch {
        if (!mounted || lifecycle !== lifecycleVersion) return false;
        showContentError();
        return false;
      }
    } else {
      contentRoot.replaceChildren(buildLoadingState(documentApi, 'Выберите доступное заведение для просмотра Dashboard.'));
    }

    try {
      await loadTenantDirectory(lifecycle);
      if (!mounted || lifecycle !== lifecycleVersion) return false;
      setScopeBusy(false, '');
      if (initialScope && directoryTenants.some((tenant) => tenant.tenantId === initialScope.tenantId)) {
        try {
          await loadLocations(initialScope.tenantId, version);
        } catch {
          if (scopeStatus) scopeStatus.textContent = 'Список точек временно недоступен. Данные заведения остаются доступны.';
        }
      }
      return true;
    } catch {
      if (!mounted || lifecycle !== lifecycleVersion) return false;
      if (initialScope) {
        setScopeBusy(false, 'Переключение заведений временно недоступно.');
        return true;
      }
      setScopeBusy(false, 'Не удалось загрузить доступные заведения.');
      showContentError('Не удалось получить серверный список доступных заведений.');
      return false;
    }
  }

  function unmount() {
    if (!mounted) return false;
    mounted = false;
    lifecycleVersion += 1;
    scopeVersion += 1;
    teardownComposition();
    selectedScope = null;
    directoryTenants = [];
    directoryLocations = [];
    periodButtons = new Map();
    contentRoot = null;
    scopeStatus = null;
    tenantSelect = null;
    locationSelect = null;
    scopeControls = null;
    pageRoot.replaceChildren();
    return true;
  }

  return Object.freeze({
    mount,
    unmount,
    get mounted() { return mounted; }
  });
}

export const dashboardPageShellContract = Object.freeze({
  autoMount: false,
  productionNavigationWiring: false,
  periodControls: Object.freeze(PERIOD_OPTIONS.map(({ key }) => key)),
  tenantInputAcceptedAsAuthority: false,
  locationInputAcceptedAsAuthority: false,
  selectorDirectorySource: 'rbac-filtered-same-origin-directory',
  selectorAuthoritySource: 'server-validated-selection-response-only',
  teardownBeforeScopeDataReload: true,
  readOnly: true,
  dependenciesAdded: false,
  environmentVariablesAdded: false
});
