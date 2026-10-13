import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function original(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}
const names = ['loadCurrentShift', 'loadPromotions', 'loadCatalog', 'loadLeaderboard', 'loadAchievements', 'loadShopContact', 'loadWalletConfig', 'loadWheelStatus'];
function fixture(role = 'client') {
  const state = { bootSecondaryStarted: false, bootSecondaryPending: null, bootSecondaryFailedJobs: [], profile: { role, balance: 17 }, token: 'fixture-token' };
  const counts = {}, behavior = {}, warnings = [], toasts = [], removed = [];
  const apiError = { current: null };
  const context = vm.createContext({ state, navigator: { onLine: true }, console: { warn: (...args) => warnings.push(args) }, toast: text => toasts.push(text),
    roleCanStaff: value => ['admin', 'staff'].includes(value),
    safeStorage: { remove: key => removed.push(key) }, renderStaffSession() {},
    api: async () => { if (apiError.current) throw apiError.current; return { profile: { role, balance: 18 } }; },
    applyProfilePayload: data => { if (!data?.profile) throw Error('Invalid profile'); state.profile = data.profile; }
  });
  for (const name of [...names, 'loadStaffSession', 'loadStaffRecent']) {
    context[name] = (...args) => { counts[name] = (counts[name] || 0) + 1; return behavior[name]?.(...args); };
  }
  vm.runInContext(original('loadSecondaryData') + original('refreshMe') + '\nglobalThis.load=loadSecondaryData;globalThis.refresh=refreshMe;', context);
  return { state, counts, behavior, warnings, toasts, removed, context, apiError, load: context.load, refresh: context.refresh };
}
test('successful reads stay loaded; manual refresh still refreshes wheel once', async () => {
  const f = fixture(); await f.load(); await f.load(); await f.refresh(); await f.state.bootSecondaryPending;
  for (const name of names) assert.equal(f.counts[name], name === 'loadWheelStatus' ? 2 : 1);
  assert.equal(f.state.profile.balance, 18); assert.equal(f.state.bootSecondaryPending, null);
  assert.equal(f.state.bootSecondaryFailedJobs.length, 0); assert.deepEqual(f.toasts, []);
});
for (const status of [403, 503, undefined]) test(`only rejected read retries after explicit refresh (${status ?? 'transport'})`, async () => {
  const f = fixture(), error = Object.assign(Error('private provider detail'), { status });
  f.behavior.loadPromotions = () => { throw error; };
  await f.load(); assert.equal(f.state.bootSecondaryFailedJobs.length, 1);
  assert.equal(f.toasts.length, 1); assert.equal(f.toasts[0].includes('private'), false);
  delete f.behavior.loadPromotions;
  await f.refresh(); await f.state.bootSecondaryPending;
  assert.equal(f.counts.loadPromotions, 2); assert.equal(f.counts.loadWheelStatus, 2);
  for (const name of names.filter(name => !['loadPromotions', 'loadWheelStatus'].includes(name))) assert.equal(f.counts[name], 1);
  assert.equal(f.state.bootSecondaryFailedJobs.length, 0); assert.equal(f.state.token, 'fixture-token');
});
test('failed retry remains queued; recovered jobs are removed separately', async () => {
  const f = fixture(); f.behavior.loadPromotions = f.behavior.loadCatalog = () => { throw Error('outage'); };
  await f.load(); delete f.behavior.loadCatalog; await f.load();
  assert.equal(f.state.bootSecondaryFailedJobs.length, 1); assert.equal(f.counts.loadCatalog, 2);
  delete f.behavior.loadPromotions; await f.load(); await f.load();
  assert.equal(f.counts.loadPromotions, 3); assert.equal(f.counts.loadCatalog, 2); assert.equal(f.toasts.length, 2);
});
test('parallel startup and refresh share pending reads without duplicate wheel', async () => {
  const f = fixture(); let release; f.behavior.loadPromotions = () => new Promise(resolve => { release = resolve; });
  const initial = f.load(); await Promise.resolve(); await Promise.resolve();
  const again = f.load(); await f.refresh(); await f.refresh();
  assert.equal(f.counts.loadPromotions, 1); assert.equal(f.counts.loadWheelStatus, 1);
  release(); await Promise.all([initial, again]); assert.equal(f.state.bootSecondaryPending, null);
});
test('parallel explicit retries cannot multiply rejected reads', async () => {
  const f = fixture(); f.behavior.loadWheelStatus = () => { throw Error('outage'); }; await f.load();
  let release; f.behavior.loadWheelStatus = () => new Promise(resolve => { release = resolve; });
  await Promise.all([f.refresh(), f.refresh()]); await Promise.resolve();
  assert.equal(f.counts.loadWheelStatus, 2); release(); await f.state.bootSecondaryPending;
  assert.equal(f.state.bootSecondaryFailedJobs.length, 0);
});
test('profile access failure blocks secondary retry and retains confirmed state', async () => {
  for (const status of [401, 403, 503]) {
    const f = fixture(); f.behavior.loadPromotions = () => { throw Error('outage'); }; await f.load();
    const profile = f.state.profile; f.apiError.current = Object.assign(Error('denied'), { status });
    await assert.rejects(f.refresh(), error => error.status === status);
    assert.equal(f.counts.loadPromotions, 1); assert.equal(f.counts.loadWheelStatus, 1); assert.equal(f.state.profile, profile);
  }
});
test('staff session preloads once and preserves original failure cleanup', async () => {
  for (const role of ['staff', 'admin']) {
    const f = fixture(role); f.behavior.loadStaffSession = () => { throw Error('denied'); };
    f.behavior.loadPromotions = () => { throw Error('outage'); }; await f.load();
    await f.load(); assert.equal(f.counts.loadStaffSession, 1); assert.equal(f.counts.loadStaffRecent, undefined);
    assert.equal(f.state.staffSession, ''); assert.equal(f.state.activeStaff, null); assert.deepEqual(f.removed, ['pivnik_staff_session']);
  }
});
test('offline failures stay queued without toast and resolved fallback is not retried', async () => {
  const f = fixture(); f.context.navigator.onLine = false;
  f.behavior.loadPromotions = () => { throw Error('offline'); }; f.behavior.loadWalletConfig = () => ({ fallback: true });
  await f.load(); assert.deepEqual(f.toasts, []); assert.equal(f.state.bootSecondaryFailedJobs.length, 1);
  await f.load(); assert.equal(f.counts.loadWalletConfig, 1);
});

test('invalid confirmed profile cannot trigger secondary retry', async () => {
  const f = fixture(); f.behavior.loadPromotions = () => { throw Error('outage'); }; await f.load();
  const profile = f.state.profile; f.context.api = async () => ({ profile: null });
  await assert.rejects(f.refresh(), /Invalid profile/);
  assert.equal(f.state.profile, profile); assert.equal(f.counts.loadPromotions, 1);
});
