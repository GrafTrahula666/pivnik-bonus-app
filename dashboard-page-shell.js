import { createAuthorizedDashboardPageComposition } from './dashboard-page-composition.js';

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

function buildErrorState(documentRef) {
  const state = documentRef.createElement('section');
  state.className = 'sv-dashboard-state sv-dashboard-state--error';
  state.setAttribute('role', 'alert');
  appendTextElement(documentRef, state, 'h2', 'sv-dashboard-state__title', 'Dashboard недоступен');
  appendTextElement(
    documentRef,
    state,
    'p',
    'sv-dashboard-state__message',
    'Не удалось безопасно определить доступ к данным. Попробуйте открыть раздел позже.'
  );
  return state;
}

/**
 * Isolated browser shell for the owner Dashboard.
 *
 * It deliberately does not read tenant/location from DOM, URL or caller input.
 * The nested authorized composition resolves scope from the fixed server-side
 * session endpoint and owns all scoped API requests.
 */
export function createDashboardPageShell({
  root,
  documentRef = globalThis.document,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  compositionFactory = createAuthorizedDashboardPageComposition
} = {}) {
  const pageRoot = requireRoot(root);
  const documentApi = requireDocument(documentRef);
  const createComposition = requireFunction(compositionFactory, 'compositionFactory');

  let mounted = false;
  let lifecycleVersion = 0;
  let composition = null;
  let periodButtons = new Map();
  let contentRoot = null;

  function syncPeriodButtons(periodKey) {
    for (const [key, button] of periodButtons) {
      const selected = key === periodKey;
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      button.dataset.selected = selected ? 'true' : 'false';
    }
  }

  function teardownComposition() {
    if (composition?.mounted) composition.unmount();
    composition = null;
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

    const periodGroup = documentApi.createElement('div');
    periodGroup.className = 'sv-dashboard-page__periods';
    periodGroup.setAttribute('role', 'group');
    periodGroup.setAttribute('aria-label', 'Период Dashboard');

    periodButtons = new Map();
    for (const option of composition.periodOptions) {
      const button = documentApi.createElement('button');
      button.type = 'button';
      button.className = 'sv-dashboard-page__period-button';
      button.textContent = option.label;
      button.dataset.period = option.key;
      button.addEventListener('click', () => {
        if (!mounted || !composition) return;
        composition.selectPeriod(option.key);
        syncPeriodButtons(composition.periodKey);
      });
      periodButtons.set(option.key, button);
      periodGroup.append(button);
    }
    controls.append(periodGroup);
    page.append(controls);

    contentRoot = documentApi.createElement('div');
    contentRoot.className = 'sv-dashboard-page__content';
    page.append(contentRoot);

    syncPeriodButtons(composition.periodKey);
    return page;
  }

  async function mount() {
    if (mounted) return false;
    mounted = true;
    const version = ++lifecycleVersion;

    composition = createComposition({
      root: {
        replaceChildren: (...nodes) => contentRoot?.replaceChildren(...nodes)
      },
      documentRef: documentApi,
      fetchImpl,
      clock
    });

    const page = buildShell();
    pageRoot.replaceChildren(page);

    try {
      const didMount = await composition.mount();
      if (!mounted || version !== lifecycleVersion) return false;
      return didMount;
    } catch {
      if (!mounted || version !== lifecycleVersion) return false;
      if (contentRoot) contentRoot.replaceChildren(buildErrorState(documentApi));
      return false;
    }
  }

  function unmount() {
    if (!mounted) return false;
    mounted = false;
    lifecycleVersion += 1;
    teardownComposition();
    periodButtons = new Map();
    contentRoot = null;
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
  periodControls: Object.freeze(['7d', '30d', '90d']),
  tenantInputAccepted: false,
  locationInputAccepted: false,
  scopeSource: 'authorized-dashboard-composition-only',
  readOnly: true,
  dependenciesAdded: false,
  environmentVariablesAdded: false
});
