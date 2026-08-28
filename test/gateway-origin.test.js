import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PIVNIK_TEST_IMPORT = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
process.env.SESSION_SECRET = 'gateway-origin-test-session-secret';

const { mutationOriginAllowed } = await import('../universal-server.js?gateway-origin-test');

test('mutation origin accepts direct same-origin Railway requests', () => {
  assert.equal(mutationOriginAllowed({
    origin: 'https://pivnik-vk-test-production-3474.up.railway.app',
    host: 'pivnik-vk-test-production-3474.up.railway.app'
  }, []), true);
});

test('mutation origin accepts the explicitly configured Vercel VK proxy', () => {
  assert.equal(mutationOriginAllowed({
    origin: 'https://pivnik-vk-proxy.vercel.app',
    host: 'pivnik-vk-test-production-3474.up.railway.app'
  }, ['https://pivnik-vk-proxy.vercel.app']), true);
});

test('mutation origin rejects unconfigured hosts and lookalike suffixes', () => {
  const headers = { host: 'pivnik-vk-test-production-3474.up.railway.app' };
  const allowed = ['https://pivnik-vk-proxy.vercel.app'];

  assert.equal(mutationOriginAllowed({
    ...headers,
    origin: 'https://attacker.example'
  }, allowed), false);
  assert.equal(mutationOriginAllowed({
    ...headers,
    origin: 'https://pivnik-vk-proxy.vercel.app.attacker.example'
  }, allowed), false);
});

test('mutation origin rejects malformed origins', () => {
  assert.equal(mutationOriginAllowed({
    origin: 'not a valid origin',
    host: 'pivnik-vk-test-production-3474.up.railway.app'
  }, ['https://pivnik-vk-proxy.vercel.app']), false);
});
