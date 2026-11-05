import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf('async function sendVkCommunityMessage');
const end = source.indexOf('const BROADCAST_CHANNELS', start);
assert.ok(start >= 0 && end > start);
function sender(fetch, signalApi = AbortSignal, config = {}) {
  const context = vm.createContext({ vkCommunityToken: 'fixture-token', vkCommunityId: '1',
    vkApiVersion: '5.199', URLSearchParams, crypto, fetch, AbortSignal: signalApi,
    console: { error() {} }, ...config });
  vm.runInContext(source.slice(start, end) + ';globalThis.send = sendVkCommunityMessage', context);
  return context.send;
}

for (const phase of ['headers', 'body']) {
  test(`VK deadline fails once while waiting for ${phase}, including swallowed JSON abort`, async () => {
    let calls = 0;
    const timers = [];
    const signals = { timeout(ms) {
      assert.equal(ms, 8_000);
      const controller = new AbortController();
      timers.push(setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), 25));
      return controller.signal;
    } };
    const send = sender(async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.vk.com/method/messages.send');
      assert.ok(options.signal instanceof AbortSignal);
      const stalled = () => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
      return phase === 'headers' ? stalled() : { ok: true, status: 200, json: stalled };
    }, signals);
    try {
      const result = await send('1910', 'fixture');
      assert.equal(result.ok, false);
      assert.equal(result.error, 'vk_network_error');
      assert.equal(result.status, 0);
      assert.equal(calls, 1);
    } finally { timers.forEach(clearTimeout); }
  });
}

test('real VK deadline aborts stalled HTTP headers and partial body without retry', { timeout: 12_000 }, async () => {
  const calls = [];
  const provider = http.createServer((req, res) => {
    calls.push(req.url);
    if (req.url === '/body') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"response":');
    }
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const port = provider.address().port;
  try {
    const results = await Promise.all(['headers', 'body'].map(phase =>
      sender((url, options) => fetch(`http://127.0.0.1:${port}/${phase}`, options))('1910', 'fixture')));
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.error, 'vk_network_error');
      assert.equal(result.status, 0);
    }
    assert.deepEqual(calls.sort(), ['/body', '/headers']);
  } finally {
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
  }
});

test('VK deadline preserves success, explicit failure, network error and missing configuration', async () => {
  const response = async (payload, status = 200) => sender(async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('user_id'), '1910');
    return new Response(JSON.stringify(payload), { status });
  })('1910', 'fixture');
  const success = await response({ response: 7 });
  assert.equal(success.ok, true); assert.equal(success.messageId, 7);
  for (const status of [200, 401, 403, 429, 500]) {
    const result = await response({ error: { error_code: 901, error_msg: 'vk_901' } }, status);
    assert.equal(result.ok, false); assert.equal(result.error, 'vk_901');
  }
  const network = await sender(async () => { throw Error('fixture-token'); })('1910', 'fixture');
  assert.equal(network.error, 'vk_network_error');
  let calls = 0;
  const absent = await sender(async () => { calls++; }, AbortSignal, { vkCommunityToken: '' })('1910', 'fixture');
  assert.equal(absent.error, 'vk_not_configured'); assert.equal(calls, 0);
});
