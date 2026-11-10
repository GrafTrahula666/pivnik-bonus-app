import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import express from 'express';

// Exercise the copies actually resolved by Express and its body parser.
const require = createRequire(import.meta.url);
const expressRequire = createRequire(require.resolve('express'));
const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'));
const serializers = [expressRequire('qs'), bodyParserRequire('qs')];

test('HTTP dependency serializers survive hostile comma-array elements', () => {
  for (const qs of serializers) {
    const inputs = [
      qs.parse('a[0][toString]=x', { allowPrototypes: true }),
      JSON.parse('{"a":[{"toString":"x"}]}'),
      qs.parse('a[][b]=c', { plainObjects: true }),
      { a: [[{ toString: 'x' }]] }
    ];
    for (const input of inputs) for (const encodeValuesOnly of [false, true]) {
      assert.doesNotThrow(() => qs.stringify(input, { arrayFormat: 'comma', encodeValuesOnly }));
    }
    assert.equal(qs.stringify({ a: ['one', 'two'] }, { arrayFormat: 'comma' }), 'a=one%2Ctwo');
    assert.equal(qs.stringify({ a: [null, undefined, 'ok'] }, { arrayFormat: 'comma', encodeValuesOnly: true }), 'a=,,ok');
    assert.equal(qs.stringify({ a: [{ toString: () => 'custom' }] }, { arrayFormat: 'comma' }), 'a=custom');
  }
});

test('Express query and extended form parsing preserve nested values and pollution guards', async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.get('/echo', (req, res) => res.json(req.query));
  app.post('/echo', (req, res) => res.json(req.body));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/echo`;
  try {
    const data = 'filter[name]=fixture&ids[]=1&ids[]=2&__proto__[polluted]=yes';
    for (const response of [
      await fetch(`${url}?${data}`),
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: data })
    ]) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { filter: { name: 'fixture' }, ids: ['1', '2'] });
      assert.equal({}.polluted, undefined);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
