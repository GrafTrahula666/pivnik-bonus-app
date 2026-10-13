import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardUiController, dashboardUiControllerContract } from '../dashboard-ui-controller.js';

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

function summary() {
  const available = (current, previous, value = 0) => ({
    current,
    previous,
    changePercent: { status: 'available', value, reason: null }
  });
  return {
    period: { start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' },
    comparisonPeriod: { start: '2026-08-25T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
    metrics: {
      completedOps: available(10, 8, 25),
      checkCents: available(100000, 80000, 25),
      averageCheckCents: available(10000, 10000, 0),
      bonusIssued: available(500, 400, 25),
      bonusSpent: available(250, 200, 25),
      activeClients: available(6, 5, 20)
    }
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function findByClass(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test('Dashboard renders AI analyst beside the heading without replacing KPI cards', async () => {
  const root = new FakeNode('main');
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => summary(),
    loadDrilldown: async () => ({ drilldown: { rowKind: 'transaction', rows: [], limit: 50, offset: 0 } })
  });

  controller.mount();
  await settle();

  const dashboard = root.children[0];
  const hero = findByClass(dashboard, 'sv-dashboard__hero');
  const header = findByClass(hero, 'sv-dashboard__header');
  const aiPanel = findByClass(hero, 'sv-ai-analyst');
  const drawer = findByClass(dashboard, 'sv-ai-analyst-drawer');
  const grid = findByClass(dashboard, 'sv-dashboard__grid');

  assert.ok(hero);
  assert.ok(header);
  assert.ok(aiPanel);
  assert.ok(drawer);
  assert.equal(drawer.hidden, true);
  assert.ok(grid);
  assert.equal(grid.children.length, 6);
  assert.equal(dashboardUiControllerContract.aiAnalystShellIncluded, true);
  assert.equal(dashboardUiControllerContract.aiApiConnected, false);
});
