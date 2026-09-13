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
    this.className = '';
    this.textContent = '';
    this.listeners = new Map();
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

function collectText(node) {
  return [node.textContent, ...node.children.flatMap((child) => collectText(child))].join(' ');
}

test('controller is explicit-mount only and renders verified summary cards', async () => {
  const root = new FakeNode('main');
  let loads = 0;
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => { loads += 1; return summary(); },
    loadDrilldown: async () => ({ drilldown: { rowKind: 'transaction', rows: [], limit: 50, offset: 0 } })
  });

  assert.equal(controller.mounted, false);
  assert.equal(loads, 0);
  assert.equal(root.children.length, 0);
  assert.equal(controller.mount(), true);
  await settle();

  assert.equal(controller.mounted, true);
  assert.equal(loads, 1);
  assert.equal(root.children.length, 1);
  const dashboard = root.children[0];
  assert.equal(dashboard.className, 'sv-dashboard');
  const grid = dashboard.children.find((node) => node.className === 'sv-dashboard__grid');
  assert.equal(grid.children.length, 6);
  assert.equal(grid.children.filter((node) => node.children.some((child) => child.dataset?.drilldownMetric)).length, 5);
});

test('controller renders backend drilldown rows through whitelist presentation model', async () => {
  const root = new FakeNode('main');
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => summary(),
    loadDrilldown: async () => ({
      ok: true,
      drilldown: {
        rowKind: 'transaction',
        rows: [{
          id: 'tx-1',
          client_id: 'client-1',
          location_id: 'location-1',
          mode: 'purchase',
          check_amount_cents: 25000,
          cash_paid_cents: 20000,
          bonus_earned: 25,
          bonus_spent: 5,
          reason: 'Покупка',
          reward_code: null,
          created_at: '2026-09-13T12:00:00Z',
          completed_at: '2026-09-13T12:01:00Z',
          private_database_column: 'secret-value'
        }],
        hasMore: true,
        limit: 50,
        offset: 0
      }
    })
  });

  controller.mount();
  await settle();

  const dashboard = root.children[0];
  const grid = dashboard.children.find((node) => node.className === 'sv-dashboard__grid');
  const button = grid.children[0].children.find((child) => child.dataset?.drilldownMetric);
  assert.ok(button);
  button.listeners.get('click')();
  await settle();

  const drilldown = dashboard.children.find((node) => node.className === 'sv-dashboard-drilldown');
  assert.equal(drilldown.hidden, false);
  const text = collectText(drilldown);
  assert.match(text, /client-1/u);
  assert.match(text, /Покупка/u);
  assert.match(text, /Есть ещё данные/u);
  assert.equal(text.includes('secret-value'), false);
  assert.equal(text.includes('private_database_column'), false);
  const list = drilldown.children.find((node) => node.className === 'sv-dashboard-drilldown__list');
  assert.equal(list.children[0].tagName, 'dl');
  assert.equal(list.children[0].dataset.rowKind, 'transaction');
});

test('controller renders honest error state instead of synthetic values', async () => {
  const root = new FakeNode('main');
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => { throw new Error('backend unavailable'); },
    loadDrilldown: async () => ({ drilldown: { rowKind: 'transaction', rows: [], limit: 50, offset: 0 } })
  });

  controller.mount();
  await settle();
  assert.equal(root.children.length, 1);
  assert.match(root.children[0].className, /sv-dashboard-state--error/);
  assert.match(root.children[0].children[1].textContent, /подтверждённые показатели/);
});

test('unmount invalidates in-flight summary and clears DOM', async () => {
  const root = new FakeNode('main');
  let resolveSummary;
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: () => new Promise((resolve) => { resolveSummary = resolve; }),
    loadDrilldown: async () => ({ drilldown: { rowKind: 'transaction', rows: [], limit: 50, offset: 0 } })
  });

  controller.mount();
  assert.equal(controller.unmount(), true);
  resolveSummary(summary());
  await settle();
  assert.equal(controller.mounted, false);
  assert.equal(root.children.length, 0);
});

test('controller contract keeps production wiring, network and raw JSON disabled', () => {
  assert.equal(dashboardUiControllerContract.autoMount, false);
  assert.equal(dashboardUiControllerContract.productionNavigationWiring, false);
  assert.equal(dashboardUiControllerContract.networkImplementationIncluded, false);
  assert.equal(dashboardUiControllerContract.dependenciesAdded, false);
  assert.equal(dashboardUiControllerContract.rawJsonRendering, false);
  assert.equal(dashboardUiControllerContract.paginationStateVisible, true);
});
