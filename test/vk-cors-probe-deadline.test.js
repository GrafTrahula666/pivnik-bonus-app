import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
import test from 'node:test';

// Execute the production function without triggering public production probes.
const source = fs.readFileSync(new URL('../scripts/probe-vk-startup-network.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('function probeCors('), source.indexOf('async function probeGateway('));
function load(transport = https, timers = { setTimeout, clearTimeout }) {
  return vm.runInNewContext(`${body}; probeCors`, {
    https: transport, URL, performance, ...timers,
    safeError: (error) => String(error?.cause?.code || error?.code || error?.name || 'UNKNOWN')
      .replace(/[^A-Z0-9_]/gi, '').slice(0, 48)
  });
}

test('CORS deadline aborts a real TCP connection stalled before TLS completes', async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await load()(`https://127.0.0.1:${server.address().port}`, 'https://example.test', 200);
    assert.equal(result.error, 'PROBE_TIMEOUT');
    assert.ok(result.elapsedMs >= 150 && result.elapsedMs < 3000, JSON.stringify(result));
    assert.equal(result.status, undefined);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const mode of ['success', 'refused', 'denied']) {
  test(`CORS ${mode} preserves the response/error and clears its deadline`, async () => {
    let cleared = false;
    let deadline;
    const request = new EventEmitter();
    request.destroy = () => assert.fail('settled probe must not reach deadline');
    const transport = { request(url, options, respond) {
      assert.equal(url.pathname, '/api/me');
      assert.equal(options.method, 'OPTIONS');
      assert.equal(options.headers.origin, 'https://example.test');
      request.end = () => queueMicrotask(() => {
        if (mode === 'refused') request.emit('error', Object.assign(new Error(), { code: 'ECONNREFUSED' }));
        else respond({ statusCode: mode === 'success' ? 204 : 403,
          headers: mode === 'success' ? { 'access-control-allow-origin': 'https://example.test' } : {}, resume() {} });
        request.emit('close');
      });
      return request;
    } };
    const result = await load(transport, {
      setTimeout(fn, ms) { assert.equal(ms, 15_000); deadline = fn; return 123; },
      clearTimeout(id) { assert.equal(id, 123); cleared = true; }
    })('https://gateway.test', 'https://example.test');
    assert.ok(deadline);
    assert.equal(cleared, true);
    if (mode === 'refused') assert.equal(result.error, 'ECONNREFUSED');
    else {
      assert.equal(result.status, mode === 'success' ? 204 : 403);
      assert.equal(result.allowOrigin, mode === 'success' ? 'https://example.test' : null);
    }
  });
}
