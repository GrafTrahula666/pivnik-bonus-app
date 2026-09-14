import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomer360UiController, customer360UiControllerContract } from '../customer-360-ui-controller.js';

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
    this.id = '';
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
}

const documentRef = { createElement: (tagName) => new FakeNode(tagName) };

function customer({ offset = 0, hasMore = true, wallet = null, metadata = null } = {}) {
  return {
    customerId: 42,
    identity: {
      id: 42,
      username: 'client42',
      firstName: 'Ada',
      lastName: 'Lovelace',
      createdAt: '2026-01-01T00:00:00.000Z',
      photoUrl: null,
      profileFrame: null,
      bonusBalance: wallet,
      paidMlTotal: null,
      giftMlBalance: null
    },
    financial: {
      cashPaidCents: 12345,
      bonusCredited: 50,
      bonusDebited: 10,
      completedOperations: 2,
      lastActivityAt: '2026-09-10T10:00:00.000Z'
    },
    timeline: {
      rows: [{
        id: `tx-${offset}`,
        mode: 'purchase',
        status: 'completed',
        checkAmountCents: 2500,
        cashPaidCents: null,
        bonusEarned: 20,
        bonusSpent: null,
        reason: 'Покупка',
        rewardCode: null,
        createdAt: '2026-09-10T10:00:00.000Z',
        completedAt: '2026-09-10T10:00:01.000Z',
        cancelledAt: null,
        cancelReason: null
      }],
      hasMore,
      limit: 25,
      offset
    },
    metadata
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function collectText(node) {
  return [node.textContent, ...node.children.flatMap((child) => collectText(child))].join(' ');
}

function findByClass(node, className) {
  if (node.className === className) return node;
  for (const child of node.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

test('Customer 360 controller is explicit-mount and renders scoped read model without synthetic wallet', async () => {
  const root = new FakeNode('div');
  let calls = 0;
  const controller = createCustomer360UiController({
    root,
    documentRef,
    loadCustomerCard: async () => { calls += 1; return customer(); }
  });

  assert.equal(controller.mounted, false);
  assert.equal(calls, 0);
  assert.equal(controller.mount(), true);
  await settle();

  assert.equal(controller.mounted, true);
  assert.equal(calls, 1);
  assert.equal(root.children[0].className, 'sv-customer-360');
  const rendered = collectText(root);
  assert.match(rendered, /Ada Lovelace/u);
  assert.match(rendered, /123,45/u);
  assert.match(rendered, /Не подтверждён для выбранного scope/u);
  assert.equal(rendered.includes('0 бонусов'), false);
});

test('Customer 360 controller renders metadata unavailable explicitly and enabled metadata when present', async () => {
  const root = new FakeNode('div');
  let current = customer();
  const controller = createCustomer360UiController({ root, documentRef, loadCustomerCard: async () => current });
  controller.mount();
  await settle();
  assert.match(collectText(root), /metadata storage не включён/u);

  current = customer({ metadata: {
    events: [{ id: '1', actorId: 'owner-1', type: 'note_added', value: 'Тихий стол', reason: 'Контекст сервиса', createdAt: '2026-09-14T06:00:00.000Z' }],
    tags: [{ value: 'vip', actorId: 'owner-1', reason: 'review', createdAt: '2026-09-14T06:00:00.000Z' }],
    segments: [{ value: 'returning', actorId: 'owner-1', reason: 'review', createdAt: '2026-09-14T06:00:00.000Z' }]
  } });
  await controller.refresh();
  const rendered = collectText(root);
  assert.match(rendered, /vip/u);
  assert.match(rendered, /returning/u);
  assert.match(rendered, /Тихий стол/u);
  assert.match(rendered, /Автор: owner-1/u);
});

test('Customer 360 timeline pagination reloads only through bounded adapter arguments', async () => {
  const root = new FakeNode('div');
  const calls = [];
  const controller = createCustomer360UiController({
    root,
    documentRef,
    pageSize: 25,
    loadCustomerCard: async (options) => {
      calls.push(options);
      return customer({ offset: options.timeline.offset, hasMore: options.timeline.offset === 0 });
    }
  });
  controller.mount();
  await settle();
  assert.deepEqual(calls[0], { timeline: { limit: 25, offset: 0 }, metadata: { limit: 25, offset: 0 } });

  let pagination = findByClass(root, 'sv-customer-pagination');
  let next = pagination.children.find((node) => node.dataset?.pageDirection === 'next');
  next.listeners.get('click')();
  await settle();
  assert.deepEqual(calls[1], { timeline: { limit: 25, offset: 25 }, metadata: { limit: 25, offset: 0 } });
  assert.match(collectText(root), /tx-25/u);

  pagination = findByClass(root, 'sv-customer-pagination');
  const previous = pagination.children.find((node) => node.dataset?.pageDirection === 'previous');
  assert.equal(previous.disabled, false);
  previous.listeners.get('click')();
  await settle();
  assert.deepEqual(calls[2], { timeline: { limit: 25, offset: 0 }, metadata: { limit: 25, offset: 0 } });
});

test('Customer 360 controller ignores stale responses and late responses after unmount', async () => {
  const root = new FakeNode('div');
  let resolveFirst;
  let call = 0;
  const controller = createCustomer360UiController({
    root,
    documentRef,
    loadCustomerCard: () => {
      call += 1;
      if (call === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(customer({ wallet: 77 }));
    }
  });
  controller.mount();
  const newer = controller.refresh();
  await newer;
  assert.match(collectText(root), /77/u);
  resolveFirst(customer({ wallet: 999 }));
  await settle();
  assert.equal(collectText(root).includes('999'), false);

  let resolveLate;
  const lateController = createCustomer360UiController({
    root,
    documentRef,
    loadCustomerCard: () => new Promise((resolve) => { resolveLate = resolve; })
  });
  controller.unmount();
  lateController.mount();
  assert.equal(lateController.unmount(), true);
  resolveLate(customer({ wallet: 123 }));
  await settle();
  assert.equal(root.children.length, 0);
});

test('Customer 360 controller renders honest error and keeps production wiring disabled', async () => {
  const root = new FakeNode('div');
  const controller = createCustomer360UiController({
    root,
    documentRef,
    loadCustomerCard: async () => { throw new Error('denied'); }
  });
  controller.mount();
  await settle();
  assert.match(root.children[0].className, /sv-customer-state--error/u);
  assert.match(collectText(root), /Никакие значения не подменены/u);
  assert.equal(customer360UiControllerContract.productionNavigationWiring, false);
  assert.equal(customer360UiControllerContract.readOnly, true);
  assert.equal(customer360UiControllerContract.writeActionsIncluded, false);
  assert.equal(customer360UiControllerContract.syntheticValuesAllowed, false);
  assert.equal(customer360UiControllerContract.staleRequestProtection, true);
});

test('Customer 360 controller rejects unsafe page sizes before any network call', () => {
  const root = new FakeNode('div');
  let called = false;
  assert.throws(() => createCustomer360UiController({
    root,
    documentRef,
    pageSize: 101,
    loadCustomerCard: async () => { called = true; return customer(); }
  }), /between 1 and 100/u);
  assert.equal(called, false);
});
