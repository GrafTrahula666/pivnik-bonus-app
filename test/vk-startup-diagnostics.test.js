import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVkStartupTrace, sanitizeStartupBatch, safeStartupCode, traceVkStage, withVkStartupTrace
} from '../vk-startup-diagnostics.js';

const id = 'a1'.repeat(12);
test('Startup telemetry drops secrets, identities, free text and unknown events', () => {
  const records = sanitizeStartupBatch({ bootId: id, token: 'secret-token', sign: 'secret-sign', events: [{
    event: 'VK_AUTH_FAIL', timestamp: 1_789_300_000_000, elapsedMs: 3100, attempt: 1, status: 401,
    code: 'secret-message', userId: 123, sign: 'secret-sign', token: 'secret-token',
    url: 'https://example.test/?sign=secret-sign', error: { message: 'secret-message' }
  }, { event: 'secret-event' }] });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, 'client');
  assert.equal(records[0].code, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(records), /secret|userId|url/);
  assert.deepEqual(sanitizeStartupBatch({ bootId: 'injection\n', events: [] }), []);
  assert.deepEqual(sanitizeStartupBatch({ bootId: id, events: Array(25).fill({ event: 'VK_BOOT_START' }) }), []);
});

test('Concurrent server startup traces retain their own request correlation', async () => {
  const lines = [];
  let resume;
  const pending = new Promise((resolve) => { resume = resolve; });
  const first = withVkStartupTrace(createVkStartupTrace(id, 'test-sha', (line) => lines.push(JSON.parse(line))), async () => {
    await pending;
    traceVkStage('VK_SIGNATURE_OK', { sign: 'private' });
  });
  const other = 'b2'.repeat(12);
  await withVkStartupTrace(createVkStartupTrace(other, 'test-sha', (line) => lines.push(JSON.parse(line))), async () => {
    traceVkStage('VK_AUTH_FAIL', { status: 401, code: 'EXPIRED_LAUNCH', token: 'private' });
  });
  resume(); await first;
  assert.deepEqual(lines.map((line) => [line.bootId, line.event]), [[other, 'VK_AUTH_FAIL'], [id, 'VK_SIGNATURE_OK']]);
  assert.equal(lines.every((line) => line.source === 'server'), true);
  assert.doesNotMatch(JSON.stringify(lines), /private/);
  assert.doesNotThrow(() => createVkStartupTrace(id, 'test', () => { throw Error('logger failed'); })('VK_AUTH_START'));
});

test('VK auth errors expose enumerated failure reasons, never a raw database message', () => {
  assert.equal(safeStartupCode({ message: 'Ссылка запуска VK устарела. Откройте приложение повторно.', statusCode: 401 }), 'EXPIRED_LAUNCH');
  assert.equal(safeStartupCode({ code: '57014', message: 'user private query' }), 'DB_TIMEOUT');
  assert.equal(safeStartupCode({ code: 'UNKNOWN_SECRET', message: 'private' }), 'UNKNOWN');
});

test('Real universal HTTP path accepts safe telemetry before DB readiness and keeps auth closed', async () => {
  process.env.PIVNIK_TEST_IMPORT = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/test';
  process.env.SESSION_SECRET = 'test-only-session-secret';
  const { server } = await import('../universal-server.js?startup-diagnostics-test');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const lines = [];
  const original = console.info;
  console.info = (line) => lines.push(JSON.parse(line));
  try {
    const response = await fetch(`${base}/api/diagnostics/vk-startup`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bootId: id, events: [{ event: 'VK_BOOT_START', sign: 'do-not-log' }] }) });
    assert.equal(response.status, 202);
    assert.equal(lines[0].event, 'VK_BOOT_START');
    assert.doesNotMatch(JSON.stringify(lines), /do-not-log/);
    const auth = await fetch(`${base}/api/auth`, { method: 'POST', headers: { 'x-pivnik-boot-id': id }, body: '{}' });
    assert.equal(auth.status, 503);
    assert.equal(lines.at(-1).code, 'NOT_READY');
    for (const pathname of ['/api/bootstrap', '/api/me']) {
      const rejected = await fetch(`${base}${pathname}`, {
        headers: { 'x-pivnik-platform': 'vk', 'x-pivnik-boot-id': id }
      });
      assert.equal(rejected.status, 401);
      assert.equal(lines.at(-1).event, 'VK_PROFILE_FAIL');
      assert.equal(lines.at(-1).status, 401);
    }
    const invalid = await fetch(`${base}/api/diagnostics/vk-startup`, { method: 'POST', body: '{}' });
    assert.equal(invalid.status, 400);
    const oversized = await fetch(`${base}/api/diagnostics/vk-startup`, { method: 'POST', body: ' '.repeat(16_385) });
    assert.equal(oversized.status, 413);
    for (const [asset, type, marker] of [
      ['red-cosmos-v2.js', /javascript/, 'const EXPECTED_PRIMARY'],
      ['red-cosmos-v2.css', /text\/css/, '--primary-red']
    ]) {
      const file = await fetch(`${base}/${asset}?v=startup-test`);
      assert.equal(file.status, 200);
      assert.match(file.headers.get('content-type'), type);
      const body = await file.text();
      assert.ok(body.includes(marker));
      assert.doesNotMatch(body, /<!doctype html|<html/i);
    }
  } finally {
    console.info = original;
    await new Promise((resolve) => server.close(resolve));
  }
});
