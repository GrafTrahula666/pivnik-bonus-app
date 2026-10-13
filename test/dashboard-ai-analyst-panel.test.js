import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardAiAnalystPanel,
  dashboardAiAnalystPanelContract
} from '../dashboard-ai-analyst-panel.js';

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.listeners = new Map();
    this.value = '';
    this.rows = 0;
    this.placeholder = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
}

const documentRef = { createElement: (tagName) => new FakeNode(tagName) };

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function findAllByClass(root, className, result = []) {
  if (root.className === className) result.push(root);
  for (const child of root.children) findAllByClass(child, className, result);
  return result;
}

test('AI analyst panel exposes the four selected serious Dashboard questions', () => {
  const { panel, featuredQuestions, allQuestions } = createDashboardAiAnalystPanel({ documentRef });

  assert.equal(panel.className, 'sv-ai-analyst');
  assert.equal(featuredQuestions.length, 4);
  assert.equal(allQuestions.length, 19);

  assert.deepEqual(featuredQuestions.map(({ label, question }) => ({ label, question })), [
    { label: 'Постоянные клиенты', question: 'Сколько клиентов можно считать постоянными?' },
    { label: 'Состояние бизнеса', question: 'Назови 3 главные проблемы и 3 сильные стороны бизнеса сейчас.' },
    { label: 'Отчёт 7 / 30 дней', question: 'Сделай краткий отчёт за 7 или 30 дней.' },
    { label: 'Слабые дни', question: 'В какие дни недели бизнес работает хуже всего?' }
  ]);

  const quickButtons = findAllByClass(panel, 'sv-ai-analyst__quick-button');
  assert.equal(quickButtons.length, 4);
  assert.deepEqual(quickButtons.map((button) => button.textContent), [
    'Постоянные клиенты',
    'Состояние бизнеса',
    'Отчёт 7 / 30 дней',
    'Слабые дни'
  ]);
});

test('all questions stays compact until explicitly opened and contains only the selected set', () => {
  const { panel, allQuestions } = createDashboardAiAnalystPanel({ documentRef });
  const all = findByClass(panel, 'sv-ai-analyst__all');
  const toggle = findByClass(panel, 'sv-ai-analyst__all-button');
  const list = findByClass(panel, 'sv-ai-analyst__question-list');

  assert.equal(all.hidden, true);
  assert.equal(toggle.attributes.get('aria-expanded'), 'false');
  assert.equal(list.children.length, 19);
  assert.deepEqual(list.children.map((button) => button.textContent), allQuestions);

  toggle.listeners.get('click')();
  assert.equal(all.hidden, false);
  assert.equal(toggle.attributes.get('aria-expanded'), 'true');

  toggle.listeners.get('click')();
  assert.equal(all.hidden, true);
  assert.equal(toggle.attributes.get('aria-expanded'), 'false');
});

test('choosing a question opens the right-side drawer and pre-fills the exact question', () => {
  const { panel, drawer } = createDashboardAiAnalystPanel({ documentRef });
  const quickButtons = findAllByClass(panel, 'sv-ai-analyst__quick-button');
  const composer = findByClass(drawer, 'sv-ai-analyst-drawer__composer');
  const selected = findByClass(drawer, 'sv-ai-analyst-drawer__selected');
  const close = findByClass(drawer, 'sv-ai-analyst-drawer__close');

  assert.equal(drawer.hidden, true);
  quickButtons[0].listeners.get('click')();

  assert.equal(drawer.hidden, false);
  assert.equal(composer.value, 'Сколько клиентов можно считать постоянными?');
  assert.equal(selected.textContent, 'Сколько клиентов можно считать постоянными?');

  close.listeners.get('click')();
  assert.equal(drawer.hidden, true);
});

test('AI shell cannot spend tokens before API integration is deliberately enabled', () => {
  const { drawer } = createDashboardAiAnalystPanel({ documentRef });
  const submit = findByClass(drawer, 'sv-ai-analyst-drawer__submit');
  const status = findByClass(drawer, 'sv-ai-analyst-drawer__status');

  assert.equal(submit.disabled, true);
  assert.match(status.textContent, /API пока не подключён/u);
  assert.match(status.textContent, /токены не расходуются/u);
  assert.equal(dashboardAiAnalystPanelContract.apiConnected, false);
  assert.equal(dashboardAiAnalystPanelContract.tokenUsageWhenIdle, 0);
  assert.equal(dashboardAiAnalystPanelContract.featuredQuestionCount, 4);
  assert.equal(dashboardAiAnalystPanelContract.allQuestionCount, 19);
  assert.equal(dashboardAiAnalystPanelContract.submitEnabled, false);
  assert.equal(dashboardAiAnalystPanelContract.productionNavigationWiring, false);
});
