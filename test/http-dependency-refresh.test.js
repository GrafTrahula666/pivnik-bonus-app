import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import express from 'express';
import compression from 'compression';

const require = createRequire(import.meta.url);
const proxyaddr = createRequire(require.resolve('express'))('proxy-addr');

test('mapped IPv6 trust ranges cannot accept unrelated IPv4 proxies', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::ffff:10.0.0.0/104']) {
    const trust = proxyaddr.compile(subnet);
    for (const remoteAddress of ['203.0.113.8', '::ffff:203.0.113.8']) {
      assert.equal(trust(remoteAddress), false);
      assert.equal(proxyaddr({ socket: { remoteAddress }, headers: { 'x-forwarded-for': '192.0.2.99' } }, trust), remoteAddress);
    }
  }
  assert.equal(proxyaddr.compile('::ffff:10.0.0.0/104')('10.1.2.3'), true);
});

test('compressed HTTP preserves failures and recovers after a client disconnect', async () => {
  // Dependency-only fixture: no production app startup, credentials or DB.
  const app = express();
  app.use(compression({ threshold: 0 }));
  app.use(express.json());
  app.get('/ok', (req, res) => res.json({ data: 'fixture '.repeat(1000) }));
  app.get('/denied', (req, res) => res.status(403).json({ error: 'denied' }));
  app.get('/external-error', (req, res) => res.status(502).json({ error: 'upstream_unavailable' }));
  app.post('/input', (req, res) => res.json(req.body));
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  app.get('/stream', (req, res) => {
    res.type('text/plain');
    const timer = setInterval(() => { res.write('fixture '.repeat(1000)); res.flush(); }, 5);
    res.once('close', () => { clearInterval(timer); resolveClosed(); });
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Accept-Encoding': 'gzip' };
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/ok`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), 'gzip');
      assert.deepEqual(await response.json(), { data: 'fixture '.repeat(1000) });
    }
    for (const [path, status, error] of [['denied', 403, 'denied'], ['external-error', 502, 'upstream_unavailable']]) {
      const response = await fetch(`${base}/${path}`, { headers });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error });
    }
    const invalid = await fetch(`${base}/input`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'entity.parse.failed' });
    await new Promise((resolve, reject) => {
      const request = http.get(`${base}/stream`, { headers }, response => {
        assert.equal(response.headers['content-encoding'], 'gzip');
        response.once('data', () => { response.destroy(); request.destroy(); resolve(); });
      });
      request.setTimeout(3000, () => request.destroy(new Error('stream fixture timeout')));
      request.once('error', reject);
    });
    await closed;
    const recovered = await fetch(`${base}/ok`, { headers });
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { data: 'fixture '.repeat(1000) });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
