const FEATURED_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'loyal-customers',
    label: 'Постоянные клиенты',
    question: 'Сколько клиентов можно считать постоянными?'
  }),
  Object.freeze({
    id: 'business-health',
    label: 'Состояние бизнеса',
    question: 'Назови 3 главные проблемы и 3 сильные стороны бизнеса сейчас.'
  }),
  Object.freeze({
    id: 'period-report',
    label: 'Отчёт 7 / 30 дней',
    question: 'Сделай краткий отчёт за 7 или 30 дней.'
  }),
  Object.freeze({
    id: 'weak-days',
    label: 'Слабые дни',
    question: 'В какие дни недели бизнес работает хуже всего?'
  })
]);

const ALL_QUESTIONS = Object.freeze([
  'В какие дни недели бизнес работает хуже всего?',
  'В какие часы мы теряем больше всего продаж?',
  'Когда у нас самый высокий средний чек?',
  'Почему изменился средний чек?',
  'Какие показатели сейчас требуют моего внимания?',
  'Где сейчас самая большая точка роста?',
  'Как можно увеличить средний чек?',
  'Какие акции дали лучший результат?',
  'Какие акции почти не дали результата?',
  'Не слишком ли много бонусов мы начисляем?',
  'Есть ли клиенты, которые накопили много бонусов, но перестали приходить?',
  'Сколько клиентов можно считать постоянными?',
  'Как изменилась активность клиентов за последние 3 месяца?',
  'Назови 3 главные проблемы бизнеса сейчас.',
  'Назови 3 самые сильные стороны бизнеса сейчас.',
  'Сделай краткий отчёт за вчера.',
  'Сделай краткий отчёт за 7 или 30 дней.',
  'Сравни этот месяц с прошлым и объясни основные изменения.',
  'Где мы недозарабатываем?'
]);

function assertDocument(documentRef) {
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('documentRef must support createElement');
  }
  return documentRef;
}

function appendText(documentRef, parent, tagName, className, text) {
  const node = documentRef.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function makeButton(documentRef, { className, text, onClick, dataset = {} }) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  Object.assign(button.dataset, dataset);
  button.addEventListener('click', onClick);
  return button;
}

export function createDashboardAiAnalystPanel({ documentRef = globalThis.document } = {}) {
  const doc = assertDocument(documentRef);

  const panel = doc.createElement('section');
  panel.className = 'sv-ai-analyst';
  panel.setAttribute('aria-label', 'AI Аналитик');

  const header = doc.createElement('div');
  header.className = 'sv-ai-analyst__header';

  const titleWrap = doc.createElement('div');
  titleWrap.className = 'sv-ai-analyst__title-wrap';
  appendText(doc, titleWrap, 'span', 'sv-ai-analyst__icon', '✦');
  appendText(doc, titleWrap, 'h2', 'sv-ai-analyst__title', 'AI АНАЛИТИК');
  appendText(doc, titleWrap, 'span', 'sv-ai-analyst__badge', 'PLUS');
  header.append(titleWrap);

  appendText(
    doc,
    header,
    'p',
    'sv-ai-analyst__subtitle',
    'Разбор показателей, клиентов, акций и точек роста по данным выбранного периода.'
  );
  panel.append(header);

  const quick = doc.createElement('div');
  quick.className = 'sv-ai-analyst__quick';
  quick.setAttribute('aria-label', 'Быстрые вопросы');
  panel.append(quick);

  const allQuestions = doc.createElement('div');
  allQuestions.className = 'sv-ai-analyst__all';
  allQuestions.hidden = true;
  allQuestions.setAttribute('aria-label', 'Все вопросы AI Аналитику');

  const drawer = doc.createElement('aside');
  drawer.className = 'sv-ai-analyst-drawer';
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Чат с AI Аналитиком');

  const drawerHeader = doc.createElement('div');
  drawerHeader.className = 'sv-ai-analyst-drawer__header';
  appendText(doc, drawerHeader, 'div', 'sv-ai-analyst-drawer__eyebrow', 'AI АНАЛИТИК');
  const drawerTitle = appendText(doc, drawerHeader, 'h2', 'sv-ai-analyst-drawer__title', 'Спросить аналитика');
  const close = makeButton(doc, {
    className: 'sv-ai-analyst-drawer__close',
    text: 'Закрыть',
    onClick: () => { drawer.hidden = true; }
  });
  drawerHeader.append(close);
  drawer.append(drawerHeader);

  const selectedQuestion = appendText(
    doc,
    drawer,
    'p',
    'sv-ai-analyst-drawer__selected',
    'Выберите вопрос на Dashboard или напишите свой.'
  );

  const composer = doc.createElement('textarea');
  composer.className = 'sv-ai-analyst-drawer__composer';
  composer.rows = 4;
  composer.placeholder = 'Спросить аналитика…';
  composer.setAttribute('aria-label', 'Вопрос AI Аналитику');
  drawer.append(composer);

  const drawerFooter = doc.createElement('div');
  drawerFooter.className = 'sv-ai-analyst-drawer__footer';
  const status = appendText(
    doc,
    drawerFooter,
    'p',
    'sv-ai-analyst-drawer__status',
    'API пока не подключён. Интерфейс готов, токены не расходуются.'
  );
  status.setAttribute('role', 'status');
  const submit = doc.createElement('button');
  submit.type = 'button';
  submit.className = 'sv-ai-analyst-drawer__submit';
  submit.textContent = 'Спросить AI';
  submit.disabled = true;
  drawerFooter.append(submit);
  drawer.append(drawerFooter);

  function chooseQuestion(question) {
    selectedQuestion.textContent = question;
    composer.value = question;
    drawerTitle.textContent = 'Спросить аналитика';
    drawer.hidden = false;
  }

  for (const item of FEATURED_QUESTIONS) {
    quick.append(makeButton(doc, {
      className: 'sv-ai-analyst__quick-button',
      text: item.label,
      dataset: { aiQuestionId: item.id, question: item.question },
      onClick: () => chooseQuestion(item.question)
    }));
  }

  const actions = doc.createElement('div');
  actions.className = 'sv-ai-analyst__actions';

  const ask = makeButton(doc, {
    className: 'sv-ai-analyst__ask',
    text: 'Спросить аналитика…',
    onClick: () => {
      selectedQuestion.textContent = 'Напишите свой вопрос.';
      composer.value = '';
      drawer.hidden = false;
    }
  });
  actions.append(ask);

  const allButton = makeButton(doc, {
    className: 'sv-ai-analyst__all-button',
    text: 'Все вопросы',
    onClick: () => {
      allQuestions.hidden = !allQuestions.hidden;
      allButton.setAttribute('aria-expanded', allQuestions.hidden ? 'false' : 'true');
    }
  });
  allButton.setAttribute('aria-expanded', 'false');
  actions.append(allButton);
  panel.append(actions);

  const questionList = doc.createElement('div');
  questionList.className = 'sv-ai-analyst__question-list';
  for (const [index, question] of ALL_QUESTIONS.entries()) {
    questionList.append(makeButton(doc, {
      className: 'sv-ai-analyst__question',
      text: question,
      dataset: { aiQuestionIndex: String(index + 1), question },
      onClick: () => chooseQuestion(question)
    }));
  }
  allQuestions.append(questionList);
  panel.append(allQuestions);

  return Object.freeze({
    panel,
    drawer,
    featuredQuestions: FEATURED_QUESTIONS,
    allQuestions: ALL_QUESTIONS
  });
}

export const dashboardAiAnalystPanelContract = Object.freeze({
  apiConnected: false,
  tokenUsageWhenIdle: 0,
  featuredQuestionCount: FEATURED_QUESTIONS.length,
  allQuestionCount: ALL_QUESTIONS.length,
  submitEnabled: false,
  productionNavigationWiring: false,
  dependenciesAdded: false
});
