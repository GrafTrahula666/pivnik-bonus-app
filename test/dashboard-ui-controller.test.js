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

test('controller is explicit-mount only and renders verified summary cards', async () => {
  const root = new FakeNode('main');
  let loads = 0;
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => { loads += 1; return summary(); },
    loadDrilldown: async () => ({ items: [] })
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

test('controller renders honest error state instead of synthetic values', async () => {
  const root = new FakeNode('main');
  const controller = createDashboardUiController({
    root,
    documentRef,
    loadSummary: async () => { throw new Error('backend unavailable'); },
    loadDrilldown: async () => ({ items: [] })
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
    loadDrilldown: async () => ({ items: [] })
  });

  controller.mount();
  assert.equal(controller.unmount(), true);
  resolveSummary(summary());
  await settle();
  assert.equal(controller.mounted, false);
  assert.equal(root.children.length, 0);
});

test('controller contract keeps production wiring and network implementation disabled', () => {
  assert.equal(dashboardUiControllerContract.autoMount, false);
  assert.equal(dashboardUiControllerContract.productionNavigationWiring, false);
  assert.equal(dashboardUiControllerContract.networkImplementationIncluded, false);
  assert.equal(dashboardUiControllerContract.dependenciesAdded, false);
});
