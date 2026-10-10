import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
const start = source.indexOf("app.use('/api/spaceverse',");
const end = source.indexOf('\n});', start) + '\n});'.length;
assert.ok(start >= 0 && end > start);
assert.ok(end < source.indexOf("app.use((_req, res) => res.sendFile"));
const installBoundary = Function('app', source.slice(start, end));

function extract(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return text.slice(a, b);
}
const sendJson = Function(extract(gateway, 'function sendJson(', '\nasync function proxyRequest(') + ';return sendJson;')();
const proxySource = extract(gateway, 'async function proxyRequest(', '\nexport async function renderAppIndex(');

test('unavailable scoped API is JSON 404 directly and through the existing gateway proxy', async () => {
  // Actual boundary registration and proxy; all route/auth outcomes below are fixtures.
  // No application startup, database, production identity or draft implementation.
  const app = express();
  app.get('/api/spaceverse/fixture', (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture') return res.status(403).json({ error: 'fixture denied' });
    if (req.query.invalid) return res.status(400).json({ error: 'fixture input' });
    if (req.query.external) return res.status(502).json({ error: 'fixture upstream' });
    res.json({ ok: true });
  });
  installBoundary(app);
  app.use((_req, res) => res.type('html').send('<html>fixture app</html>'));
  const child = app.listen(0, '127.0.0.1');
  await once(child, 'listening');
  const readBody = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); };
  const makeProxy = (ready, port) => Function('childReady','sendJson','readRequestBody','canonicalizeSessionToken','internalPort','http',
    proxySource + ';return proxyRequest;')(ready, sendJson, readBody, async () => ({ payload: null }), port, http);
  const proxy = makeProxy(true, child.address().port);
  let mode = 'ready';
  const front = http.createServer((req,res) => (mode === 'offline' ? makeProxy(false, child.address().port) : proxy)(req,res));
  front.listen(0, '127.0.0.1'); await once(front, 'listening');
  try {
    for (const server of [child, front]) {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const pathname of ['/api/spaceverse','/api/spaceverse/','/api/spaceverse/tenants/a/customers/1','/api/spaceverse/tenants/b/customers/bad?limit=0']) {
        for (const method of ['GET','POST','HEAD']) {
          const response = await fetch(base + pathname, { method });
          assert.equal(response.status,404,`${pathname} ${method}`);
          assert.match(response.headers.get('content-type'),/application\/json/);
          assert.equal(response.headers.get('cache-control'),'no-store');
          if (method === 'HEAD') assert.equal(await response.text(),'');
          else assert.deepEqual(await response.json(),{ error:'SPACEVERSE API route not found.' });
        }
      }
      for (const [query,status] of [['',200],['',200],['?invalid=1',400],['?external=1',502]]) {
        const response = await fetch(base+'/api/spaceverse/fixture'+query,{headers:{authorization:'Bearer fixture'}});
        assert.equal(response.status,status); await response.json();
      }
      const denied=await fetch(base+'/api/spaceverse/fixture'); assert.equal(denied.status,403); await denied.json();
      for (const pathname of ['/','/profile','/api/spaceverse-other']) {
        const response = await fetch(base+pathname); assert.equal(response.status,200);
        assert.equal(await response.text(),'<html>fixture app</html>');
      }
    }
    mode='offline';
    const unavailable = await fetch(`http://127.0.0.1:${front.address().port}/api/spaceverse/tenants/a/customers/1`);
    assert.equal(unavailable.status,503); await unavailable.json();
  } finally {
    for (const server of [front,child]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
