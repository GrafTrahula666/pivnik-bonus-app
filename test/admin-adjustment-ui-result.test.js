import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('const pendingAdminAdjustments =');
const end = source.indexOf("$('#openProfileSettings')", start);
assert.ok(start >= 0 && end > start);
function fixture({ input = '25', reason = ' Fixture reason ', result = { ok: true, balance: 125 }, failure, refreshFailure, pending, responses } = {}) {
  const prompts = [input, reason], messages = [], calls = [];
  const controls = [];
  const state = { profile: { id: '10', role: 'admin' } };
  let confirmations = 0;
  let refreshes = 0;
  const run = new Function('prompt', 'api', 'requestId', 'toast', 'refreshAdminUsersDirectory', 'fmt', 'state', 'roleCanWrite', 'confirm', '$$',
    source.slice(start, end) + '\nreturn adjustAdminBonus;')(
    () => prompts.shift(), async (url, options) => {
      calls.push({ url, ...JSON.parse(options.body) }); if (pending) await pending;
      const response = responses?.[calls.length - 1];
      if (response instanceof Error) throw response;
      if (response) return response;
      if (failure) throw failure; return result;
    }, () => 'fixture-request-key', text => messages.push(text), async () => {
      refreshes++; if (refreshFailure) throw Error('Read outage');
    }, String, state, role => role === 'admin', () => { confirmations++; return true; }, () => controls);
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
    assert.equal(h.messages.at(-1), status < 500 ? `Failure ${status}` : 'Результат корректировки не подтверждён. Нажмите «Повторить» для проверки той же операции. Не обновляйте страницу до подтверждения.'); assert.equal(h.refreshes, 0);
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
