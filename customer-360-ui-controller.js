import { createCustomer360ViewModel } from './customer-360-view-model.js';

const DEFAULT_PAGE_SIZE = 25;

function assertFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function assertRoot(root) {
  if (!root || typeof root.replaceChildren !== 'function') throw new TypeError('root must support replaceChildren');
  return root;
}

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('documentRef must support createElement');
  }
  return documentRef;
}

function text(documentRef, parent, tagName, className, value) {
  const node = documentRef.createElement(tagName);
  node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

function formatMoney(money) {
  if (money === null) return 'Недоступно в выбранном scope';
  return `${money.rubles.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function formatCount(value, unavailable = 'Недоступно') {
  return value === null ? unavailable : value.toLocaleString('ru-RU');
}

function formatDate(value) {
  if (!value) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function state(documentRef, title, message, kind) {
  const section = documentRef.createElement('section');
  section.className = `sv-customer-state sv-customer-state--${kind}`;
  section.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  section.setAttribute('aria-live', 'polite');
  text(documentRef, section, 'h2', 'sv-customer-state__title', title);
  text(documentRef, section, 'p', 'sv-customer-state__message', message);
  return section;
}

function metric(documentRef, label, value, kind = '') {
  const item = documentRef.createElement('div');
  item.className = `sv-customer-metric${kind ? ` sv-customer-metric--${kind}` : ''}`;
  text(documentRef, item, 'dt', 'sv-customer-metric__label', label);
  text(documentRef, item, 'dd', 'sv-customer-metric__value', value);
  return item;
}

function renderIdentity(documentRef, view) {
  const section = documentRef.createElement('section');
  section.className = 'sv-customer-profile';
  section.setAttribute('aria-labelledby', 'sv-customer-profile-title');

  const heading = documentRef.createElement('div');
  heading.className = 'sv-customer-profile__heading';
  const title = text(documentRef, heading, 'h1', 'sv-customer-profile__title', view.identity.displayName);
  title.id = 'sv-customer-profile-title';
  if (view.identity.username) text(documentRef, heading, 'p', 'sv-customer-profile__username', `@${view.identity.username}`);
  section.append(heading);

  const meta = documentRef.createElement('dl');
  meta.className = 'sv-customer-profile__meta';
  meta.append(metric(documentRef, 'ID клиента', String(view.customerId)));
  meta.append(metric(documentRef, 'Клиент с', formatDate(view.identity.createdAt)));
  meta.append(metric(documentRef, 'Последняя активность', formatDate(view.financial.lastActivityAt)));
  section.append(meta);
  return section;
}

function renderFinancial(documentRef, view) {
  const section = documentRef.createElement('section');
  section.className = 'sv-customer-panel sv-customer-financial';
  text(documentRef, section, 'h2', 'sv-customer-panel__title', 'Деньги и активность');
  const grid = documentRef.createElement('dl');
  grid.className = 'sv-customer-financial__grid';
  grid.append(metric(documentRef, 'Оплачено', formatMoney(view.financial.cashPaid)));
  grid.append(metric(documentRef, 'Операций', formatCount(view.financial.completedOperations)));
  grid.append(metric(documentRef, 'Бонусов начислено', formatCount(view.financial.bonusCredited)));
  grid.append(metric(documentRef, 'Бонусов списано', formatCount(view.financial.bonusDebited)));
  grid.append(metric(
    documentRef,
    'Текущий бонусный баланс',
    formatCount(view.identity.bonusBalance, 'Не подтверждён для выбранного scope'),
    view.identity.walletScoped ? '' : 'unavailable'
  ));
  section.append(grid);
  if (!view.identity.walletScoped) {
    text(documentRef, section, 'p', 'sv-customer-panel__note', 'Глобальный кошелёк не показывается как баланс конкретного заведения без подтверждённой scope-привязки.');
  }
  return section;
}

function timelineRow(documentRef, row) {
  const item = documentRef.createElement('article');
  item.className = 'sv-customer-timeline__row';
  item.dataset.transactionId = row.id ?? '';
  const header = documentRef.createElement('div');
  header.className = 'sv-customer-timeline__row-header';
  text(documentRef, header, 'strong', 'sv-customer-timeline__mode', row.mode || 'Операция');
  text(documentRef, header, 'span', 'sv-customer-timeline__date', formatDate(row.completedAt || row.createdAt));
  item.append(header);

  const values = documentRef.createElement('dl');
  values.className = 'sv-customer-timeline__values';
  if (row.checkAmount !== null) values.append(metric(documentRef, 'Чек', formatMoney(row.checkAmount)));
  if (row.cashPaid !== null) values.append(metric(documentRef, 'Оплачено', formatMoney(row.cashPaid)));
  if (row.bonusEarned !== null) values.append(metric(documentRef, 'Начислено', formatCount(row.bonusEarned)));
  if (row.bonusSpent !== null) values.append(metric(documentRef, 'Списано', formatCount(row.bonusSpent)));
  item.append(values);
  if (row.reason) text(documentRef, item, 'p', 'sv-customer-timeline__reason', row.reason);
  return item;
}

function pagination(documentRef, { offset, limit, hasMore }, onPage, label) {
  const nav = documentRef.createElement('nav');
  nav.className = 'sv-customer-pagination';
  nav.setAttribute('aria-label', label);
  const previous = documentRef.createElement('button');
  previous.type = 'button';
  previous.className = 'sv-customer-pagination__button';
  previous.textContent = 'Назад';
  previous.disabled = offset <= 0;
  previous.dataset.pageDirection = 'previous';
  previous.addEventListener('click', () => {
    if (!previous.disabled) onPage(Math.max(0, offset - limit));
  });
  nav.append(previous);
  text(documentRef, nav, 'span', 'sv-customer-pagination__status', `С ${offset + 1}`);
  const next = documentRef.createElement('button');
  next.type = 'button';
  next.className = 'sv-customer-pagination__button';
  next.textContent = 'Далее';
  next.disabled = !hasMore;
  next.dataset.pageDirection = 'next';
  next.addEventListener('click', () => {
    if (!next.disabled) onPage(offset + limit);
  });
  nav.append(next);
  return nav;
}

function renderTimeline(documentRef, view, onPage) {
  const section = documentRef.createElement('section');
  section.className = 'sv-customer-panel sv-customer-timeline';
  text(documentRef, section, 'h2', 'sv-customer-panel__title', 'История операций');
  if (view.timeline.rows.length === 0) {
    text(documentRef, section, 'p', 'sv-customer-empty', 'В выбранном scope операций нет.');
  } else {
    const list = documentRef.createElement('div');
    list.className = 'sv-customer-timeline__list';
    list.setAttribute('role', 'list');
    for (const row of view.timeline.rows) {
      const rendered = timelineRow(documentRef, row);
      rendered.setAttribute('role', 'listitem');
      list.append(rendered);
    }
    section.append(list);
  }
  if (view.timeline.offset > 0 || view.timeline.hasMore) {
    section.append(pagination(documentRef, view.timeline, onPage, 'Пагинация истории операций'));
  }
  return section;
}

function chip(documentRef, value, kind) {
  const node = documentRef.createElement('span');
  node.className = `sv-customer-chip sv-customer-chip--${kind}`;
  node.textContent = value;
  return node;
}

function renderMetadata(documentRef, view) {
  const section = documentRef.createElement('section');
  section.className = 'sv-customer-panel sv-customer-metadata';
  text(documentRef, section, 'h2', 'sv-customer-panel__title', 'CRM-контекст');
  if (!view.metadata.available) {
    text(documentRef, section, 'p', 'sv-customer-empty', 'Заметки, теги и сегменты пока недоступны: metadata storage не включён.');
    return section;
  }

  const chips = documentRef.createElement('div');
  chips.className = 'sv-customer-metadata__chips';
  for (const tag of view.metadata.tags) chips.append(chip(documentRef, tag.value || 'Без названия', 'tag'));
  for (const segment of view.metadata.segments) chips.append(chip(documentRef, segment.value || 'Без названия', 'segment'));
  if (chips.children.length > 0) section.append(chips);

  if (view.metadata.events.length === 0) {
    text(documentRef, section, 'p', 'sv-customer-empty', 'Служебных записей пока нет.');
    return section;
  }
  const history = documentRef.createElement('div');
  history.className = 'sv-customer-metadata__history';
  for (const event of view.metadata.events) {
    const row = documentRef.createElement('article');
    row.className = 'sv-customer-metadata__event';
    text(documentRef, row, 'strong', 'sv-customer-metadata__type', event.type || 'Изменение');
    if (event.value) text(documentRef, row, 'p', 'sv-customer-metadata__value', event.value);
    const details = [event.actorId ? `Автор: ${event.actorId}` : null, event.reason ? `Причина: ${event.reason}` : null, formatDate(event.createdAt)].filter(Boolean).join(' · ');
    text(documentRef, row, 'small', 'sv-customer-metadata__details', details);
    history.append(row);
  }
  section.append(history);
  return section;
}

function renderReady(documentRef, view, onTimelinePage) {
  const main = documentRef.createElement('main');
  main.className = 'sv-customer-360';
  main.setAttribute('aria-label', 'Customer 360');
  main.append(renderIdentity(documentRef, view));
  const columns = documentRef.createElement('div');
  columns.className = 'sv-customer-360__columns';
  const primary = documentRef.createElement('div');
  primary.className = 'sv-customer-360__primary';
  primary.append(renderFinancial(documentRef, view));
  primary.append(renderTimeline(documentRef, view, onTimelinePage));
  const secondary = documentRef.createElement('aside');
  secondary.className = 'sv-customer-360__secondary';
  secondary.append(renderMetadata(documentRef, view));
  columns.append(primary, secondary);
  main.append(columns);
  return main;
}

export function createCustomer360UiController({
  root,
  documentRef = globalThis.document,
  loadCustomerCard,
  pageSize = DEFAULT_PAGE_SIZE
} = {}) {
  assertRoot(root);
  assertDocument(documentRef);
  assertFunction(loadCustomerCard, 'loadCustomerCard');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new RangeError('pageSize must be a safe integer between 1 and 100');
  }

  let mounted = false;
  let requestVersion = 0;
  let timelineOffset = 0;

  async function refresh() {
    if (!mounted) throw new Error('Customer 360 controller is not mounted');
    const version = ++requestVersion;
    root.replaceChildren(state(documentRef, 'Customer 360', 'Загрузка карточки клиента…', 'loading'));
    try {
      const customer = await loadCustomerCard({
        timeline: { limit: pageSize, offset: timelineOffset },
        metadata: { limit: pageSize, offset: 0 }
      });
      if (!mounted || version !== requestVersion) return;
      const view = createCustomer360ViewModel(customer);
      root.replaceChildren(renderReady(documentRef, view, (offset) => {
        timelineOffset = offset;
        void refresh();
      }));
    } catch {
      if (!mounted || version !== requestVersion) return;
      root.replaceChildren(state(documentRef, 'Карточка клиента недоступна', 'Не удалось безопасно получить данные в выбранном scope. Никакие значения не подменены.', 'error'));
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

export const customer360UiControllerContract = Object.freeze({
  autoMount: false,
  productionNavigationWiring: false,
  readOnly: true,
  writeActionsIncluded: false,
  rawBackendRendering: false,
  syntheticValuesAllowed: false,
  unknownScopedWalletShownAsZero: false,
  states: Object.freeze(['loading', 'ready', 'empty', 'error', 'unavailable']),
  maxPageSize: 100,
  staleRequestProtection: true,
  dependenciesAdded: false
});
