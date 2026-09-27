import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function adminUsersDirectoryParams('), app.indexOf('async function refreshAdminUsersDirectory('));

function harness() {
  const nodes = Object.fromEntries(['userSearch', 'userRoleFilter', 'allUsersList', 'adminUsersRetry', 'adminUsersMeta', 'adminUsersPageLabel', 'adminUsersPrev', 'adminUsersNext'].map(id => [id, { value: '', hidden: true }]));
  nodes.userStatusFilter = {
    value: '',
    hidden: true,
    options: [
      { value: '', textContent: 'Все' },
      { value: 'new', textContent: 'Новые' },
      { value: 'active', textContent: 'Активные' },
      { value: 'at_risk', textContent: 'В зоне риска' },
      { value: 'sleeping', textContent: 'Спящие' },
      { value: 'no_visits', textContent: 'Без визитов' }
    ]
  };
  const pending = [], renders = [], timers = new Map();
  let timerId = 0;
  const state = { profile: { id: '1' }, adminUsers: [], adminUsersRequestSeq: 0, adminUsersDirectory: { page: 1, pages: 3, limit: 25, total: 60 }, adminUsersFilterTimer: 0 };
  const context = vm.createContext({ state, URLSearchParams, $: selector => nodes[selector.slice(1)], fmt: String,
    api: url => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    renderUsers: users => renders.push(users), openModal() {}, toast() {},
    window: { clearTimeout: id => timers.delete(id), setTimeout: fn => { timers.set(++timerId, fn); return timerId; } }
  });
  vm.runInContext(source, context);
  return { context, state, nodes, pending, renders, timers };
}

const response = name => ({ users: [{ id: name }], pagination: { page: 1, limit: 25, total: 1, pages: 1 }, segments: { new: 1, active: 0, at_risk: 0, sleeping: 0, no_visits: 0 } });

test('CRM search never replaces newer results with a late older response', async () => {
  const h = harness();
  h.nodes.userSearch.value = 'old';
  const first = h.context.loadAdminUsersDirectory(1);
  h.nodes.userSearch.value = 'new';
  const second = h.context.loadAdminUsersDirectory(1);
  h.pending[1].resolve(response('new')); await second;
  h.pending[0].resolve(response('old')); await first;
  assert.equal(h.state.adminUsers[0].id, 'new');
  assert.equal(h.renders.length, 1);
});

test('CRM invalidates old requests during the filter debounce, including old failures', async () => {
  const h = harness();
  const first = h.context.loadAdminUsersDirectory(1);
  h.nodes.userSearch.value = 'next'; h.context.filterAdminUsers();
  h.pending[0].reject(new Error('stale failure')); await first;
  assert.equal(h.nodes.adminUsersRetry.hidden, true);
  assert.equal(h.state.adminUsersDirectory.busy, true);
  assert.equal(h.renders.length, 0);
  assert.equal(h.timers.size, 1);
});

test('CRM failure clears loading and retry loads the requested page', async () => {
  const h = harness();
  const request = h.context.loadAdminUsersDirectory(2);
  h.pending[0].reject(new Error('offline'));
  await assert.rejects(request, /offline/);
  assert.match(h.nodes.allUsersList.textContent, /Не удалось/);
  assert.equal(h.state.adminUsersDirectory.busy, false);
  assert.equal(h.nodes.adminUsersRetry.hidden, false);
  const retry = h.nodes.adminUsersRetry.onclick();
  assert.match(h.pending[1].url, /page=2/);
  assert.equal(h.nodes.adminUsersRetry.hidden, true);
  h.pending[1].resolve(response('recovered')); await retry;
  assert.equal(h.state.adminUsers[0].id, 'recovered');
});

test('CRM ignores responses belonging to a previous signed-in profile', async () => {
  const h = harness(); const request = h.context.loadAdminUsersDirectory(1);
  h.state.profile = { id: '2' };
  h.pending[0].resolve(response('old account')); await request;
  assert.equal(h.renders.length, 0);
  assert.equal(h.state.adminUsers.length, 0);
});
