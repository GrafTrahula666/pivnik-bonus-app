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
function runtime(payload, status = 200, config = {}) {
  const calls = [], logs = [];
  const context = vm.createContext({ vkCommunityToken: 'fixture-secret-token', vkCommunityId: '1',
    vkApiVersion: '5.199', URLSearchParams, crypto,
    console: { error(...args) { logs.push(args); } }, ...config,
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(payload), { status }); } });
  vm.runInContext(source.slice(start, end) + source.slice(deliveryStart, deliveryEnd)
    + ';globalThis.send = sendVkCommunityMessage;globalThis.deliver = deliverBroadcast', context);
  return { context, calls, logs };
}

test('VK provider prose never leaves sender or campaign summary', async () => {
  for (const status of [200, 401, 403, 429, 500]) {
    const { context, calls, logs } = runtime({ error: { error_code: 901,
      error_msg: 'fixture-secret-token private recipient detail <script>example</script>',
      request_params: [{ key: 'access_token', value: 'fixture-secret-token' }] } }, status);
    const summary = await context.deliver(['1910', '1911'], id => context.send(id, 'fixture'), 0);
    assert.equal(summary.delivered, 0); assert.equal(summary.failed, 2);
    assert.equal(summary.errors.length, 1); assert.equal(summary.errors[0].error, 'vk_901');
    assert.equal(summary.errors[0].count, 2); assert.equal(calls.length, 2);
    assert.doesNotMatch(JSON.stringify({ summary, logs }), /fixture-secret-token|private recipient|script|request_params/);
  }
});

test('VK error code must be a positive safe integer before appearing in results or logs', async () => {
  for (const code of [undefined, null, 0, -1, 1.5, '901', 'fixture-secret-token', {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    const { context, calls, logs } = runtime({ error: { error_code: code, error_msg: 'fixture-secret-token' } });
    const result = await context.send('1910', 'fixture');
    assert.equal(result.ok, false); assert.equal(result.error, 'vk_send_failed');
    assert.equal(calls.length, 1); assert.doesNotMatch(JSON.stringify({ result, logs }), /fixture-secret-token/);
  }
  for (const code of [1, 5, 6, 901]) {
    const { context } = runtime({ error: { error_code: code } });
    assert.equal((await context.send('1910', 'fixture')).error, `vk_${code}`);
  }
});

test('VK safe error handling preserves successful sends and missing configuration', async () => {
  const { context, calls } = runtime({ response: 7 });
  const result = await context.send('1910', 'fixture');
  assert.equal(result.ok, true); assert.equal(result.messageId, 7); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body.get('user_id'), '1910');
  const missing = runtime({}, 200, { vkCommunityToken: '' });
  assert.equal((await missing.context.send('1910', 'fixture')).error, 'vk_not_configured');
  assert.equal(missing.calls.length, 0);
});
