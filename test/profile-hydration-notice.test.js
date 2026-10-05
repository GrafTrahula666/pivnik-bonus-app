import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
function original(start) {
  const from = source.indexOf(start), to = source.indexOf('\n}\n', from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to + 3);
}
const loader = ['async function hydrateAfterBoot(', 'function applyProfilePayload(',
  'function renderCoreProfile('].map(original).join('\n');
function fixture({ error, data, consent = false, designError = false } = {}) {
  const profile = { id: 'fixture', balance: 17, termsAccepted: consent };
  const state = { token: 'fixture-session', profile, statuses: ['old'] };
  const calls = { api: [], toast: [], render: 0, secondary: 0 };
  const context = vm.createContext({ state, console: { warn() {}, error() {} },
    api: async (path, options) => { calls.api.push({ path, options }); if (error) throw error;
      return data ?? { profile: { ...profile, balance: 18 }, statuses: ['new'] }; },
    toast: text => calls.toast.push(text), applyTelegramChrome() {}, renderProfile() { calls.render++; },
    renderStatuses() {}, applyDesign() { if (designError) throw Error('fixture design error'); },
    loadSecondaryData: async () => { calls.secondary++; }
  });
  vm.runInContext(loader + '\nglobalThis.hydrate=hydrateAfterBoot;', context);
  return { state, profile, calls, run: context.hydrate };
}
test('successful hydration applies confirmed profile without a failure notice', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.state.profile.balance, 18); assert.deepEqual(f.state.statuses, ['new']);
  assert.equal(f.calls.render, 1); assert.deepEqual(f.calls.toast, []);
  assert.equal(f.calls.api.length, 1); assert.equal(f.calls.api[0].options.retries, 0);
});
for (const status of [401, 403, 503, undefined]) {
  test(`failed hydration ${status ?? 'transport'} retains state and reports safe error`, async () => {
    const f = fixture({ error: Object.assign(Error('private fixture SQL/provider detail'), { status }) });
    await f.run();
    assert.equal(f.state.profile, f.profile); assert.equal(f.state.token, 'fixture-session');
    assert.deepEqual(f.state.statuses, ['old']); assert.equal(f.calls.render, 0);
    assert.equal(f.calls.api.length, 1); assert.equal(f.calls.toast.length, 1);
    assert.match(f.calls.toast[0], /ранее загруженные данные/);
    assert.equal(f.calls.toast[0].includes('private'), false);
    assert.equal(f.calls.toast[0].includes('Откройте приложение заново'), status === 401 || status === 403);
  });
}
test('invalid profile response retains state and reports failure', async () => {
  const f = fixture({ data: { profile: null } }); await f.run();
  assert.equal(f.state.profile, f.profile); assert.equal(f.calls.render, 0);
  assert.equal(f.calls.toast.length, 1);
});
test('existing consent guard still controls secondary reads after failure', async () => {
  for (const consent of [true, false]) {
    const f = fixture({ consent, error: Error('fixture outage') }); await f.run();
    assert.equal(f.calls.secondary, Number(consent)); assert.equal(f.state.profile, f.profile);
  }
});
test('optional design rendering failure does not claim profile loading failed', async () => {
  const f = fixture({ data: { profile: { id: 'fixture', balance: 19 }, design: {} }, designError: true });
  await f.run(); assert.equal(f.state.profile.balance, 19); assert.equal(f.calls.render, 1);
  assert.deepEqual(f.calls.toast, []);
});
