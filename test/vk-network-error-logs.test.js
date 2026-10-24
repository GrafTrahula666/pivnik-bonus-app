import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('async function sendVkCommunityMessage');
const end = source.indexOf('const BROADCAST_CHANNELS', start);
const deliveryStart = source.indexOf('async function deliverBroadcast');
const deliveryEnd = source.indexOf('function transactionResponse', deliveryStart);
assert.ok(start >= 0 && end > start && deliveryStart >= 0 && deliveryEnd > deliveryStart);
function runtime(fetch, config = {}) {
  const logs = [], calls = [];
  const context = vm.createContext({ vkCommunityToken: 'fixture-secret-token', vkCommunityId: '1',
    vkApiVersion: '5.199', URLSearchParams, crypto,
    console: { error(...args) { logs.push(args); } }, ...config,
    fetch: async (...args) => { calls.push(args); return fetch(...args); } });
  vm.runInContext(source.slice(start, end) + source.slice(deliveryStart, deliveryEnd)
    + ';globalThis.send = sendVkCommunityMessage;globalThis.deliver = deliverBroadcast', context);
  return { context, calls, logs };
}

test('VK network failures expose only a fixed error code in logs and campaign results', async () => {
  const failure = new Error('fixture-secret-token https://api.vk.com private recipient 1910');
  failure.cause = { access_token: 'fixture-secret-token' };
  const { context, calls, logs } = runtime(async () => { throw failure; });
  const summary = await context.deliver(['1910', '1911'], id => context.send(id, 'fixture'), 0);
  assert.equal(summary.delivered, 0); assert.equal(summary.failed, 2);
  assert.equal(summary.errors.length, 1); assert.equal(summary.errors[0].error, 'vk_network_error');
  assert.equal(summary.errors[0].count, 2); assert.equal(calls.length, 2);
  assert.deepEqual(logs, Array.from({ length: 2 }, () => ['VK messages.send error:', 'vk_network_error']));
  assert.doesNotMatch(JSON.stringify({ logs, summary }), /fixture-secret-token|api\.vk\.com|private recipient|1910/);
});

test('VK sender handles arbitrary rejected values without reading exception properties', async () => {
  let reads = 0;
  const hostile = { get message() { reads++; throw new Error('fixture-secret-token'); } };
  for (const failure of [null, undefined, 'fixture-secret-token', 0, hostile]) {
    const { context, calls, logs } = runtime(async () => { throw failure; });
    const result = await context.send('1910', 'fixture');
    assert.equal(result.ok, false); assert.equal(result.status, 0); assert.equal(result.error, 'vk_network_error');
    assert.equal(calls.length, 1); assert.deepEqual(logs, [['VK messages.send error:', 'vk_network_error']]);
  }
  assert.equal(reads, 0);
});

test('VK send can recover after a transport failure without automatic retry', async () => {
  let attempts = 0;
  const { context, calls, logs } = runtime(async () => {
    if (++attempts === 1) throw new Error('fixture-secret-token');
    return new Response(JSON.stringify({ response: 7 }), { status: 200 });
  });
  assert.equal((await context.send('1910', 'fixture')).error, 'vk_network_error');
  assert.equal(calls.length, 1);
  const recovered = await context.send('1910', 'new explicit send');
  assert.equal(recovered.ok, true); assert.equal(recovered.messageId, 7); assert.equal(calls.length, 2);
  assert.equal(logs.length, 1);
  const missing = runtime(async () => { throw new Error('unexpected send'); }, { vkCommunityToken: '' });
  assert.equal((await missing.context.send('1910', 'fixture')).error, 'vk_not_configured');
  assert.equal(missing.calls.length, 0); assert.equal(missing.logs.length, 0);
});
