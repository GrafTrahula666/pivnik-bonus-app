import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('const pendingAdminAdjustments =');
const end = source.indexOf("$('#openProfileSettings')", start);
assert.ok(start >= 0 && end > start);
function fixture({ input = '25', reason = ' Fixture reason ', result = { ok: true, balance: 125 }, failure, refreshFailure, pending, responses, storage, isVk = false, confirmResult = true } = {}) {
  const records = new Map();
  storage ||= { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const prompts = [input, reason], messages = [], calls = [];
  const controls = [];
  const state = { profile: { id: '10', role: 'admin' } };
  let confirmations = 0;
  let refreshes = 0;
  const run = new Function('prompt', 'api', 'requestId', 'toast', 'refreshAdminUsersDirectory', 'fmt', 'state', 'roleCanWrite', 'confirm', '$$', 'sessionStorage', 'IS_VK',
    source.slice(start, end) + '\nreturn adjustAdminBonus;')(
    () => prompts.shift(), async (url, options) => {
      calls.push({ url, ...JSON.parse(options.body) }); if (pending) await pending;
      const response = responses?.[calls.length - 1];
      if (response instanceof Error) throw response;
      if (response) return response;
      if (failure) throw failure; return result;
    }, () => 'fixture-request-key', text => messages.push(text), async () => {
      refreshes++; if (refreshFailure) throw Error('Read outage');
    }, String, state, role => role === 'admin', () => { confirmations++; return confirmResult; }, () => controls, storage, isVk);
  const button = { dataset: { adjustUser: '20' }, disabled: false, textContent: 'Баланс' };
  controls.push(button);
  return { run, button, controls, messages, calls, state, get confirmations() { return confirmations; }, get refreshes() { return refreshes; } };
}

test('adjustment UI preserves confirmed save when directory refresh fails', async () => {
  const h = fixture({ refreshFailure: true }); await h.run(h.button);
  assert.match(h.messages.at(-1), /Корректировка сохранена.*125 Б.*Список не обновился/);
  assert.equal(h.calls[0].reason, 'Fixture reason'); assert.equal(h.refreshes, 1);
  assert.equal(h.button.disabled, false);
});

test('adjustment UI supports confirmed credit/debit/replay without local balance arithmetic', async () => {
  for (const [input, balance, replayed] of [['25', 125, false], ['-25', 75, false], ['25', 125, true]]) {
    const h = fixture({ input, result: { ok: true, balance, replayed } }); await h.run(h.button);
    assert.equal(h.calls[0].amount, Number(input)); assert.equal(h.messages.at(-1), `Баланс изменён: ${balance} Б`);
    assert.equal(h.calls[0].requestKey, 'fixture-request-key');
  }
});

test('adjustment UI rejects invalid amount and cancelled/empty reason before POST', async () => {
  for (const input of ['1.9', '0', '', 'NaN', 'Infinity', '9007199254740992', 'true', null]) {
    const h = fixture({ input }); await h.run(h.button); assert.equal(h.calls.length, 0);
  }
  for (const reason of ['', ' ', null]) {
    const h = fixture({ reason }); await h.run(h.button); assert.equal(h.calls.length, 0);
  }
});

test('adjustment UI never claims success for denial, external errors or malformed success', async () => {
  for (const status of [401, 403, 400, 409, 500]) {
    const h = fixture({ failure: Object.assign(Error(`Failure ${status}`), { status }) }); await h.run(h.button);
    assert.equal(h.messages.at(-1), status < 500 ? `Failure ${status}` : 'Результат не подтверждён. Нажмите «Повторить». Ключ сохранён для перезагрузки этой вкладки. Не закрывайте её.'); assert.equal(h.refreshes, 0);
    assert.equal(h.button.disabled, false); assert.equal(h.button.textContent, status < 500 ? 'Баланс' : 'Повторить');
  }
  for (const result of [{}, { ok: true }, { ok: false, balance: 125 }, { ok: true, balance: -1 }, { ok: true, balance: '125' }]) {
    const h = fixture({ result }); await h.run(h.button); assert.match(h.messages.at(-1), /не подтверждён/);
    assert.equal(h.refreshes, 0);
  }
});

test('adjustment UI pending repeated click posts only once', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ pending }); const first = h.run(h.button);
  assert.equal(h.button.disabled, true); assert.equal(h.button.textContent, 'Сохранение…');
  await h.run(h.button); assert.equal(h.calls.length, 1); release(); await first;
  assert.equal(h.button.disabled, false); assert.equal(h.button.textContent, 'Баланс');
});


test('adjustment UI retries an uncertain result with the original semantic command and key', async () => {
  const h = fixture({ responses: [Error('Lost response after save'), { ok: true, balance: 125, replayed: true }] });
  await h.run(h.button); assert.equal(h.button.textContent, 'Повторить');
  await h.run(h.button); assert.equal(h.confirmations, 1);
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.messages.at(-1), 'Баланс изменён: 125 Б');
  assert.equal(h.button.textContent, 'Баланс');
});

test('adjustment UI pending guard survives a different button for the same customer', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const h = fixture({ pending }); const first = h.run(h.button);
  const replacement = { ...h.button, disabled: false }; h.controls.push(replacement); await h.run(replacement);
  assert.equal(h.calls.length, 1); release(); await first;
  assert.equal(replacement.disabled, false); assert.equal(replacement.textContent, 'Баланс');
});

test('adjustment UI later denial retains the uncertain command for safe recovery', async () => {
  const h = fixture({ responses: [Error('Unknown'), Object.assign(Error('Denied'), { status: 403 }), { ok: true, balance: 125 }] });
  await h.run(h.button); await h.run(h.button); assert.equal(h.button.textContent, 'Повторить');
  await h.run(h.button); assert.deepEqual(h.calls[0], h.calls[2]);
  assert.equal(h.messages.at(-1), 'Баланс изменён: 125 Б');
});

function tabStorage() {
  const records = new Map();
  return { records, getItem: key => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
}

test('adjustment UI reload uses stored command, skips new inputs and clears only after confirmation', async () => {
  const storage = tabStorage();
  const before = fixture({ storage, failure: Error('Lost reply') });
  await before.run(before.button); assert.equal(storage.records.size, 1);
  const after = fixture({ storage, input: '900', reason: 'New reason' });
  await after.run(after.button);
  assert.deepEqual(after.calls[0], before.calls[0]); assert.equal(after.confirmations, 1);
  assert.equal(storage.records.size, 0);
});

test('adjustment UI fails before POST for unavailable storage or invalid persisted command', async () => {
  for (const storage of [
    { getItem() { throw Error('Read denied'); } },
    { getItem() { return null; }, setItem() { throw Error('Quota exceeded'); } },
    { getItem() { return null; }, setItem() {} },
    { getItem() { return 'broken JSON'; } },
    { getItem() { return JSON.stringify({ version: 1, scope: 'telegram:10:20', amount: 25, reason: 'x', requestKey: '' }); } },
    { getItem() { return 'x'.repeat(8193); } }
  ]) {
    const h = fixture({ storage }); await h.run(h.button);
    assert.equal(h.calls.length, 0); assert.equal(h.refreshes, 0);
    assert.match(h.messages.at(-1), /заблокирована|не отправлена/);
  }
  const h = fixture({ reason: 'x'.repeat(8193) }); await h.run(h.button);
  assert.equal(h.calls.length, 0);
});

test('adjustment UI storage remains scoped to the authenticated actor and target client', async () => {
  const storage = tabStorage();
  const original = fixture({ storage, failure: Error('Unknown') }); await original.run(original.button);
  for (const [actor, target] of [['11', '20'], ['10', '21']]) {
    const h = fixture({ storage, input: '50', failure: Error('Unknown') });
    h.state.profile.id = actor; h.button.dataset.adjustUser = target;
    await h.run(h.button); assert.equal(h.calls[0].amount, 50); assert.equal(h.confirmations, 0);
  }
  const vk = fixture({ storage, isVk: true, input: '50', failure: Error('Unknown') });
  await vk.run(vk.button); assert.equal(vk.calls[0].amount, 50); assert.equal(vk.confirmations, 0);
  const recovered = fixture({ storage }); await recovered.run(recovered.button);
  assert.deepEqual(recovered.calls[0], original.calls[0]); assert.equal(storage.records.size, 3);
});

test('adjustment UI confirms saved result even when removing the stored key fails', async () => {
  const storage = tabStorage(); storage.removeItem = () => { throw Error('Storage unavailable'); };
  const h = fixture({ storage }); await h.run(h.button);
  assert.equal(h.messages.at(-1), 'Баланс изменён: 125 Б'); assert.equal(h.button.textContent, 'Баланс');
  const reloaded = fixture({ storage, result: { ok: true, balance: 125, replayed: true } });
  await reloaded.run(reloaded.button); assert.deepEqual(h.calls[0], reloaded.calls[0]);
});


test('adjustment UI reload confirmation can be declined without losing its stored command', async () => {
  const storage = tabStorage();
  const initial = fixture({ storage, failure: Error('Unknown') }); await initial.run(initial.button);
  const cancelled = fixture({ storage, confirmResult: false }); await cancelled.run(cancelled.button);
  assert.equal(cancelled.calls.length, 0); assert.equal(storage.records.size, 1);
  const confirmed = fixture({ storage }); await confirmed.run(confirmed.button);
  assert.deepEqual(confirmed.calls[0], initial.calls[0]); assert.equal(storage.records.size, 0);
});


test('uncertain correction recovery explains denial without replacing the saved command', async () => {
  for (const [status, message] of [[401, /Войдите прежним аккаунтом/], [403, /Нет доступа/],
    [409, /Конфликт команды/], [400, /Команда отклонена/], [404, /Клиент недоступен/]]) {
    const h = fixture({ responses: [Error('Unknown outcome'), Object.assign(Error('Untrusted provider detail'), { status }), { ok: true, balance: 125, replayed: true }] });
    await h.run(h.button); await h.run(h.button);
    assert.match(h.messages.at(-1), message);
    assert.match(h.messages.at(-1), /Исходный ключ сохранён/);
    assert.doesNotMatch(h.messages.at(-1), /Untrusted provider detail/);
    assert.equal(h.button.textContent, 'Повторить');
    assert.equal(h.refreshes, 0);
    assert.deepEqual(h.calls[1], h.calls[0]);
    await h.run(h.button);
    assert.deepEqual(h.calls[2], h.calls[0]);
    assert.equal(h.button.textContent, 'Баланс');
    assert.equal(h.messages.at(-1), 'Баланс изменён: 125 Б');
  }
});
