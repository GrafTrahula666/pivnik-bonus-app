import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';

// Exercise the parser actually resolved by Express, without a new dependency.
const require = createRequire(import.meta.url);
const qs = createRequire(require.resolve('express'))('qs');

test('HTTP parser rejects bracket/comma arrays beyond the configured limit', () => {
  const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
  assert.deepEqual(qs.parse('a[]=1,2,3', options), { a: [['1', '2', '3']] });
  for (const input of ['a=1,2,3,4', 'a[]=1,2,3,4']) {
    assert.throws(() => qs.parse(input, options), RangeError);
  }
});

test('HTTP parser can serialize attacker-controlled constructor/isBuffer keys', () => {
  for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
    const parsed = qs.parse('x%5Bconstructor%5D%5BisBuffer%5D=y', options);
    assert.equal(qs.stringify(parsed), 'x%5Bconstructor%5D%5BisBuffer%5D=y');
  }
});

test('updated Express preserves query filters, JSON parsing and invalid-JSON errors', async () => {
  // Local HTTP fixture only: no application startup, credentials or database.
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.get('/filters', (req, res) => res.json(req.query));
  app.post('/payload', (req, res) => res.json(req.body));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.type }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const filters = await fetch(`${base}/filters?search=Anna&page=2&filter[role]=viewer`);
    assert.equal(filters.status, 200);
    assert.deepEqual(await filters.json(), { search: 'Anna', page: '2', filter: { role: 'viewer' } });
    const payload = { amount: 25, reason: 'fixture', requestKey: 'fixture-request' };
    const response = await fetch(`${base}/payload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), payload);
    const invalid = await fetch(`${base}/payload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken'
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'entity.parse.failed' });
    assert.equal((await fetch(`${base}/filters?search=Anna`)).status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
