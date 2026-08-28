import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Vercel VK proxy routes every path to the active VK Railway service', async () => {
  const config = JSON.parse(await fs.readFile(
    new URL('../vercel-vk-proxy/vercel.json', import.meta.url),
    'utf8'
  ));

  assert.deepEqual(config.rewrites, [{
    source: '/:path*',
    destination: 'https://pivnik-vk-test-production-3474.up.railway.app/:path*'
  }]);
  assert.deepEqual(config.headers, [{
    source: '/:path*',
    headers: [{
      key: 'x-vercel-enable-rewrite-caching',
      value: '0'
    }]
  }]);
  assert.doesNotMatch(JSON.stringify(config), /pivnik-bonus-app-production-df60/);
});
