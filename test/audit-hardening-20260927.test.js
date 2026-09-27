import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const end = source.indexOf('\n  }\n', start);
  assert.notEqual(end, -1, `${name} has no end`);
  return source.slice(start, end + 4);
}

test('admin data panels escape Telegram/VK profile names before innerHTML', async () => {
  const overlay = await read('red-cosmos-v2.js');
  assert.doesNotMatch(overlay, /const name = \[item\.first_name/);
  const context = { target: { className: '', textContent: '', innerHTML: '' } };
  vm.runInNewContext(`${extractFunction(overlay, 'escapeAdminText')}\n${extractFunction(overlay, 'renderAdminRows')}
    renderAdminRows(target, [{ first_name: '<img src=x onerror=alert(1)>', username: 'a"b', frame_id: '<i>', acquired_source: 'shop', selected_frame: 'none' }], 'frames');`, context);
  assert.doesNotMatch(context.target.innerHTML, /<img|<i>/);
  assert.match(context.target.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt; · @a&quot;b/);
});

test('Telegram notifications cannot stall pooled database clients indefinitely', async () => {
  const server = await read('server.js');
  assert.match(server, /signal: AbortSignal\.timeout\(TELEGRAM_SEND_TIMEOUT_MS\)/);
});
