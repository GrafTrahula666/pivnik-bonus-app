import { createDashboardUiViewModel } from './dashboard-ui-view-model.js';
import { createDashboardDrilldownViewModel } from './dashboard-drilldown-view-model.js';
import { createDashboardAiAnalystPanel } from './dashboard-ai-analyst-panel.js';

const DEFAULT_DRILLDOWN_LIMIT = 50;

function assertFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function assertRoot(root) {
  if (!root || typeof root.replaceChildren !== 'function') {
    throw new TypeError('root must support replaceChildren');
  }
  return root;
}

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('documentRef must support createElement');
  }
  return documentRef;
}

function appendTextElement(documentRef, parent, tagName, className, text) {
  const node = documentRef.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function buildState(documentRef, title, message, kind) {
  const section = documentRef.createElement('section');
  section.className = `sv-dashboard-state sv-dashboard-state--${kind}`;
  section.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  section.setAttribute('aria-live', 'polite');
  appendTextElement(documentRef, section, 'h2', 'sv-dashboard-state__title', title);
  appendTextElement(documentRef, section, 'p', 'sv-dashboard-state__message', message);
  return section;
}

function renderCard(documentRef, card, onDrilldown) {
  const article = documentRef.createElement('article');
  article.className = 'sv-dashboard-card';
  article.dataset.metric = card.key;

  const header = documentRef.createElement('div');
  header.className = 'sv-dashboard-card__header';
  appendTextElement(documentRef, header, 'h3', 'sv-dashboard-card__label', card.label);
  article.append(header);

  appendTextElement(documentRef, article, 'div', 'sv-dashboard-card__value', card.currentText);
  appendTextElement(documentRef, article, 'div', 'sv-dashboard-card__previous', `Предыдущий период: ${card.previousText}`);

  const change = appendTextElement(documentRef, article, 'div', `sv-dashboard-card__change sv-dashboard-card__change--${card.change.direction}`, card.change.text);
  change.dataset.status = card.change.status;

  if (card.interactive) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'sv-dashboard-card__drilldown';
    button.textContent = 'Показать операции';
    button.dataset.drilldownMetric = card.drilldownMetric;
    button.addEventListener('click', () => onDrilldown(card, 0, DEFAULT_DRILLDOWN_LIMIT));
    article.append(button);
  } else {
    const note = appendTextElement(documentRef, article, 'div', 'sv-dashboard-card__note', 'Детализация пока недоступна');
    note.setAttribute('aria-disabled', 'true');
  }

  return article;
}

function renderReady(documentRef, viewModel, onDrilldown) {
  const section = documentRef.createElement('section');
  section.className = 'sv-dashboard';
  section.setAttribute('aria-label', 'SPACEVERSE Dashboard');

  const hero = documentRef.createElement('div');
  hero.className = 'sv-dashboard__hero';

  const header = documentRef.createElement('header');
  header.className = 'sv-dashboard__header';
  appendTextElement(documentRef, header, 'h1', 'sv-dashboard__title', 'Dashboard');
  appendTextElement(documentRef, header, 'p', 'sv-dashboard__period', `${viewModel.period.start} — ${viewModel.period.end}`);
  hero.append(header);

  const ai = createDashboardAiAnalystPanel({ documentRef });
  hero.append(ai.panel);
  section.append(hero);
  section.append(ai.drawer);

  const grid = documentRef.createElement('div');
  grid.className = 'sv-dashboard__grid';
  for (const card of viewModel.cards) grid.append(renderCard(documentRef, card, onDrilldown));
  section.append(grid);

  const drilldown = documentRef.createElement('section');
  drilldown.className = 'sv-dashboard-drilldown';
  drilldown.hidden = true;
  drilldown.setAttribute('aria-live', 'polite');
  section.append(drilldown);

  return { section, drilldown };
}

function renderDrilldownField(documentRef, field) {
  const wrapper = documentRef.createElement('div');
  wrapper.className = 'sv-dashboard-drilldown__field';
  wrapper.dataset.field = field.key;
  appendTextElement(documentRef, wrapper, 'dt', 'sv-dashboard-drilldown__term', field.label);
  appendTextElement(documentRef, wrapper, 'dd', 'sv-dashboard-drilldown__value', field.text);
  return wrapper;
}

function renderPagination(documentRef, container, viewModel, onPage) {
  const hasPrevious = viewModel.offset > 0;
  if (!hasPrevious && !viewModel.hasMore) return;

  const pagination = documentRef.createElement('nav');
  pagination.className = 'sv-dashboard-drilldown__pagination';
  pagination.setAttribute('aria-label', 'Пагинация детализации');

  const previous = documentRef.createElement('button');
  previous.type = 'button';
  previous.className = 'sv-dashboard-drilldown__page-button';
  previous.textContent = 'Назад';
  previous.disabled = !hasPrevious;
  previous.dataset.pageDirection = 'previous';
  previous.addEventListener('click', () => {
    if (!hasPrevious) return;
    onPage(Math.max(0, viewModel.offset - viewModel.limit), viewModel.limit);
  });
  pagination.append(previous);

  const status = appendTextElement(
    documentRef,
    pagination,
    'span',
    'sv-dashboard-drilldown__page-status',
    viewModel.empty
      ? `Смещение: ${viewModel.offset}`
      : `Записи ${viewModel.offset + 1}–${viewModel.offset + viewModel.rows.length}`
  );
  status.setAttribute('aria-live', 'polite');

  const next = documentRef.createElement('button');
  next.type = 'button';
  next.className = 'sv-dashboard-drilldown__page-button';
  next.textContent = 'Далее';
  next.disabled = !viewModel.hasMore;
  next.dataset.pageDirection = 'next';
  next.addEventListener('click', () => {
    if (!viewModel.hasMore || viewModel.nextOffset === null) return;
    onPage(viewModel.nextOffset, viewModel.limit);
  });
  pagination.append(next);

  container.append(pagination);
}

function renderDrilldownRows(documentRef, container, card, result, onPage) {
  const viewModel = createDashboardDrilldownViewModel(result);
  container.replaceChildren();
  container.hidden = false;

  appendTextElement(documentRef, container, 'h2', 'sv-dashboard-drilldown__title', card.label);
  if (viewModel.empty) {
    appendTextElement(documentRef, container, 'p', 'sv-dashboard-drilldown__empty', 'За выбранный период данных нет.');
    renderPagination(documentRef, container, viewModel, onPage);
    return;
  }

  const list = documentRef.createElement('div');
  list.className = 'sv-dashboard-drilldown__list';
  list.setAttribute('role', 'list');

  for (const item of viewModel.rows) {
    const row = documentRef.createElement('dl');
    row.className = 'sv-dashboard-drilldown__row';
    row.dataset.rowKind = item.kind;
    row.dataset.rowKey = item.key;
    row.setAttribute('role', 'listitem');
    for (const field of item.fields) row.append(renderDrilldownField(documentRef, field));
    list.append(row);
  }
  container.append(list);

  appendTextElement(
    documentRef,
    container,
    'p',
    'sv-dashboard-drilldown__pagination-note',
    viewModel.hasMore
      ? `Показаны записи ${viewModel.offset + 1}–${viewModel.offset + viewModel.rows.length}. Есть ещё данные.`
      : `Показаны записи ${viewModel.offset + 1}–${viewModel.offset + viewModel.rows.length}.`
  );
  renderPagination(documentRef, container, viewModel, onPage);
}

export function createDashboardUiController({ root, documentRef = globalThis.document, loadSummary, loadDrilldown }) {
  assertRoot(root);
  assertDocument(documentRef);
  assertFunction(loadSummary, 'loadSummary');
  assertFunction(loadDrilldown, 'loadDrilldown');

  let mounted = false;
  let requestVersion = 0;
  let activeDrilldown = null;

  async function openDrilldown(card, offset = 0, limit = DEFAULT_DRILLDOWN_LIMIT) {
    if (!mounted || !activeDrilldown || !card.interactive) return;
    const version = ++requestVersion;
    activeDrilldown.hidden = false;
    activeDrilldown.replaceChildren(buildState(documentRef, card.label, 'Загрузка детализации…', 'loading'));
    try {
      const result = await loadDrilldown(card.drilldownMetric, { offset, limit });
      if (!mounted || version !== requestVersion) return;
      renderDrilldownRows(
        documentRef,
        activeDrilldown,
        card,
        result,
        (nextOffset, nextLimit) => void openDrilldown(card, nextOffset, nextLimit)
      );
    } catch {
      if (!mounted || version !== requestVersion) return;
      activeDrilldown.replaceChildren(buildState(documentRef, 'Не удалось загрузить детализацию', 'Данные не изменены. Повторите попытку позже.', 'error'));
    }
  }

  async function refresh() {
    if (!mounted) throw new Error('dashboard controller is not mounted');
    const version = ++requestVersion;
    root.replaceChildren(buildState(documentRef, 'Dashboard', 'Загрузка данных…', 'loading'));

    try {
      const summary = await loadSummary();
      if (!mounted || version !== requestVersion) return;
      const viewModel = createDashboardUiViewModel(summary);
      const ready = renderReady(documentRef, viewModel, openDrilldown);
      activeDrilldown = ready.drilldown;
      root.replaceChildren(ready.section);
    } catch {
      if (!mounted || version !== requestVersion) return;
      activeDrilldown = null;
      root.replaceChildren(buildState(documentRef, 'Dashboard недоступен', 'Не удалось безопасно получить подтверждённые показатели.', 'error'));
    }
  }

  function mount() {
    if (mounted) return false;
    mounted = true;
    void refresh();
    return true;
  }

  function unmount() {
    if (!mounted) return false;
    mounted = false;
    requestVersion += 1;
    activeDrilldown = null;
    root.replaceChildren();
    return true;
  }

  return Object.freeze({
    mount,
    unmount,
    refresh,
    get mounted() { return mounted; }
  });
}

export const dashboardUiControllerContract = Object.freeze({
  autoMount: false,
  productionNavigationWiring: false,
  networkImplementationIncluded: false,
  dependenciesAdded: false,
  states: Object.freeze(['loading', 'ready', 'empty', 'error']),
  drilldownRendering: 'whitelisted semantic fields only',
  rawJsonRendering: false,
  paginationStateVisible: true,
  paginationControls: true,
  defaultDrilldownLimit: DEFAULT_DRILLDOWN_LIMIT,
  staleRequestProtection: true,
  mobileTouchTargetCssRequired: true,
  aiAnalystShellIncluded: true,
  aiApiConnected: false
});
