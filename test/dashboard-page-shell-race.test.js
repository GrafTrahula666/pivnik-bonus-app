import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardPageShell } from '../dashboard-page-shell.js';

class FakeNode {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.disabled = false;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
}

const documentRef = { createElement: (tagName) => new FakeNode(tagName) };

function collect(node, predicate, result = []) {
  if (predicate(node)) result.push(node);
  for (const child of node.children) collect(child, predicate, result);
  return result;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function createScopeAdapters() {
  return {
    sessionScopeAdapterFactory: () => async () => ({ tenantId: 'tenant-a', locationId: null }),
    scopeBrowserAdapterFactory: () => ({
      loadTenants: async () => [
        { tenantId: 'tenant-a', displayName: 'Бар А' },
        { tenantId: 'tenant-b', displayName: 'Бар Б' }
      ],
      loadLocations: async (tenantId) => ({ tenant: { tenantId }, locations: [] }),
      selectScope: async ({ tenantId, locationId = null }) => ({ tenantId, locationId })
    })
  };
}

test('late stale scope mount only unmounts its own composition, never the newer Dashboard', async () => {
  const root = new FakeNode('main');
  const slowMount = deferred();
  const instances = [];
  let creationIndex = 0;

  const compositionFactory = ({ resolveSessionScope }) => {
    const index = creationIndex++;
    let mounted = false;
    let unmountCount = 0;
    const instance = {
      periodKey: '7d',
      get mounted() { return mounted; },
      get unmountCount() { return unmountCount; },
      async mount() {
        instance.scope = await resolveSessionScope();
        if (index === 1) await slowMount.promise;
        mounted = true;
        return true;
      },
      unmount() {
        unmountCount += 1;
        mounted = false;
        return true;
      },
      selectPeriod() {}
    };
    instances.push(instance);
    return instance;
  };

  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: async () => { throw new Error('network should be injected away'); },
    compositionFactory,
    ...createScopeAdapters()
  });

  assert.equal(await shell.mount(), true);
  const tenant = collect(root, (node) => node.dataset?.scopeSelector === 'tenant')[0];
  assert.ok(tenant);

  tenant.value = 'tenant-b';
  tenant.listeners.get('change')();
  await settle();
  assert.equal(instances.length, 2);
  assert.deepEqual(instances[1].scope, { tenantId: 'tenant-b', locationId: null });

  tenant.value = 'tenant-a';
  tenant.listeners.get('change')();
  await settle();
  assert.equal(instances.length, 3);
  assert.equal(instances[2].mounted, true);
  assert.deepEqual(instances[2].scope, { tenantId: 'tenant-a', locationId: null });

  slowMount.resolve();
  await settle();

  assert.equal(instances[1].mounted, false);
  assert.equal(instances[1].unmountCount, 1);
  assert.equal(instances[2].mounted, true);
  assert.equal(instances[2].unmountCount, 0);
});

test('unmount during a pending scope mount invalidates and cleans up only that pending composition', async () => {
  const root = new FakeNode('main');
  const slowMount = deferred();
  const instances = [];
  let creationIndex = 0;

  const compositionFactory = ({ resolveSessionScope }) => {
    const index = creationIndex++;
    let mounted = false;
    let unmountCount = 0;
    const instance = {
      periodKey: '7d',
      get mounted() { return mounted; },
      get unmountCount() { return unmountCount; },
      async mount() {
        instance.scope = await resolveSessionScope();
        if (index === 1) await slowMount.promise;
        mounted = true;
        return true;
      },
      unmount() {
        unmountCount += 1;
        mounted = false;
        return true;
      },
      selectPeriod() {}
    };
    instances.push(instance);
    return instance;
  };

  const shell = createDashboardPageShell({
    root,
    documentRef,
    fetchImpl: async () => { throw new Error('network should be injected away'); },
    compositionFactory,
    ...createScopeAdapters()
  });

  assert.equal(await shell.mount(), true);
  const tenant = collect(root, (node) => node.dataset?.scopeSelector === 'tenant')[0];
  tenant.value = 'tenant-b';
  tenant.listeners.get('change')();
  await settle();
  assert.equal(instances.length, 2);

  assert.equal(shell.unmount(), true);
  assert.equal(root.children.length, 0);

  slowMount.resolve();
  await settle();

  assert.equal(shell.mounted, false);
  assert.equal(instances[1].mounted, false);
  assert.equal(instances[1].unmountCount, 1);
  assert.equal(root.children.length, 0);
});
