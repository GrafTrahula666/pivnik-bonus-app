import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const source = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function adjustAdminBonus(');
const end = source.indexOf("$('#openProfileSettings')", start);
assert.ok(start >= 0 && end > start);
function fixture({ input = '25', reason = ' Fixture reason ', result = { ok: true, balance: 125 }, failure, refreshFailure, pending } = {}) {
  const prompts = [input, reason], messages = [], calls = [];
  let refreshes = 0;
  const run = new Function('prompt', 'api', 'requestId', 'toast', 'refreshAdminUsersDirectory', 'fmt',
    source.slice(start, end) + '\nreturn adjustAdminBonus;')(
    () => prompts.shift(), async (url, options) => {
      calls.push({ url, ...JSON.parse(options.body) }); if (pending) await pending;
      if (failure) throw failure; return result;
    }, () => 'fixture-request-key', text => messages.push(text), async () => {
      refreshes++; if (refreshFailure) throw Error('Read outage');
    }, String);
  const button = { dataset: { adjustUser: '20' }, disabled: false, textContent: 'Баланс' };
  return { run, button, messages, calls, get refreshes() { return refreshes; } };
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
    assert.equal(h.messages.at(-1), `Failure ${status}`); assert.equal(h.refreshes, 0);
    assert.equal(h.button.disabled, false); assert.equal(h.button.textContent, 'Баланс');
  }
  for (const result of [{}, { ok: true }, { ok: false, balance: 125 }, { ok: true, balance: -1 }, { ok: true, balance: '125' }]) {
    const h = fixture({ result }); await h.run(h.button); assert.match(h.messages.at(-1), /Не удалось подтвердить/);
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
