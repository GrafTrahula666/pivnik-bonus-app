import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const a = source.indexOf('function isConfirmedCancellation('), b = source.indexOf('function renderStaffRecent(', a);
assert.ok(a >= 0 && b > a);
function fixture({ response, failure, refreshFailure = false, pending } = {}) {
  const tx = { id: '30', clientId: '20', status: 'completed', clientName: 'Fixture' };
  const state = { staffRecent: [tx], adminTransactions: [tx], resolvedClient: { profile: { id: '20', balance: 100 } } };
  const messages = [], calls = [], renders = [], meta = { textContent: '' };
  const run = new Function('state', '$', 'api', 'requestId', 'toast', 'renderStaffRecent', 'renderAdminTransactions',
    'filterAdminTransactions', 'fmt', 'updateResolvedBeer', 'loadStaffRecent', 'loadAdmin', 'loadLeaderboard', 'openAllTransactions',
    source.slice(a, b) + '\nreturn cancelOperation;')(
    state, selector => selector === '#foundMeta' ? meta : null,
    async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); if (pending) await pending; if (failure) throw failure;
      return response ?? { ok: true, transaction: { ...tx, status: 'cancelled', cancelReason: 'Fixture reason' }, quota: { active: true, remaining: 2 } }; },
    () => 'stable-fixture-key', text => messages.push(text), data => renders.push(data), data => renders.push(data), () => {}, String, () => {},
    async () => { if (refreshFailure) throw new Error('refresh error'); }, async () => { if (refreshFailure) throw new Error('refresh error'); }, async () => {}, async () => {});
  const button = { disabled: false, textContent: 'Отменить', dataset: { staffCancel: '30', adminCancel: '30' } };
  return { run, state, messages, calls, renders, meta, button };
}
function confirmedPayload(id = '30') { return { code: 'cancellation_committed', cancelled: true, transaction: { id, clientId: '20', status: 'cancelled', cancelReason: 'Fixture reason' } }; }

test('cancellation UI: successful save survives refresh failure for staff and owner', async () => {
  for (const scope of ['staff', 'admin']) {
    const h = fixture({ refreshFailure: true }); await h.run(h.button, scope, 'Fixture reason');
    assert.equal(h.state.staffRecent[0].status, 'cancelled'); assert.equal(h.state.adminTransactions[0].status, 'cancelled');
    assert.equal(h.state.staffRecent[0].clientName, 'Fixture'); assert.equal(h.button.disabled, true);
    assert.match(h.messages.at(-1), /Операция отменена.*не обновилась/);
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.requestKey, 'stable-fixture-key');
  }
});

test('cancellation UI: confirmed 503 preserves saved state and marks unavailable quota/profile', async () => {
  const h = fixture({ failure: { status: 503, payload: confirmedPayload(), message: 'Server ancillary failure' }, refreshFailure: true });
  await h.run(h.button, 'staff', 'Fixture reason');
  assert.equal(h.state.staffRecent[0].status, 'cancelled'); assert.equal(h.renders[0].quotaUnavailable, true);
  assert.match(h.meta.textContent, /требует обновления/); assert.equal(h.state.resolvedClient.profile.balance, 100);
  assert.match(h.messages.at(-1), /Операция отменена/);
});

test('cancellation UI: malformed confirmation, foreign ID and ordinary denial do not cancel local data', async () => {
  for (const failure of [
    { status: 403, payload: confirmedPayload(), message: 'Denied' },
    { status: 503, payload: confirmedPayload('31'), message: 'Foreign' },
    { status: 503, payload: { ...confirmedPayload(), cancelled: false }, message: 'Unconfirmed' },
    { status: 503, payload: { ...confirmedPayload(), code: 'other' }, message: 'Other' },
    { status: 400, message: 'Invalid reason' }, { status: 500, message: 'DB failed' }
  ]) {
    const h = fixture({ failure }); await h.run(h.button, 'staff', 'Fixture reason');
    assert.equal(h.state.staffRecent[0].status, 'completed'); assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, 'Отменить'); assert.equal(h.messages.at(-1), failure.message);
    assert.equal(h.renders.length, 0);
  }
});

test('cancellation UI: repeated click while request is pending posts once', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ pending }); const first = h.run(h.button, 'admin', 'Fixture reason');
  assert.equal(h.button.disabled, true); assert.equal(h.button.textContent, 'Отмена…');
  await h.run(h.button, 'admin', 'Fixture reason'); release(); await first;
  assert.equal(h.calls.length, 1); assert.equal(h.messages.at(-1), 'Операция отменена');
});

test('cancellation UI: unknown successful response never claims a saved reversal', async () => {
  const h = fixture({ response: { ok: true } }); await h.run(h.button, 'admin', 'Fixture reason');
  assert.equal(h.state.adminTransactions[0].status, 'completed'); assert.equal(h.button.disabled, false);
  assert.match(h.messages.at(-1), /Не удалось подтвердить/);
});
