import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'evotor-gateway-test-only';

test('Gateway serves POS assets for both shells and denies unauthenticated financial routes', async () => {
  const { server, renderAppIndex } = await import('../universal-server.js?evotor-http-test');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const platform of ['vk', 'telegram']) {
      const shell = await renderAppIndex(platform);
      assert.match(shell, /src="\/pos-admin\.js/);
      assert.match(shell, /href="\/pos-admin\.css/);
    }
    for (const [file, type] of [['pos-admin.js', 'text/javascript'], ['pos-admin.css', 'text/css']]) {
      const response = await fetch(`${base}/${file}`);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').startsWith(type));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    }
    for (const [path, method] of [['dashboard', 'GET'], ['sync', 'POST'], ['link', 'POST']]) {
      const response = await fetch(`${base}/api/admin/pos/${path}`, {
        method, headers: { Origin: base, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {})
      });
      assert.equal(response.status, 401);
      assert.match((await response.json()).error, /вход/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
