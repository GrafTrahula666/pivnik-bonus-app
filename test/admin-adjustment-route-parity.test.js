import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const [server, handlerSource, executorSource, wiringSource] = await Promise.all([
  fs.readFile(new URL('../server.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin-adjustment-route-handler.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin-adjustment-executor.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../admin-adjustment-server-wiring.js', import.meta.url), 'utf8')
]);

function legacyRouteSource() {
  const startMarker = "app.post('/api/admin/users/:id/adjust'";
  const endMarker = "app.post('/api/admin/transactions/:id/cancel'";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'legacy adjustment route must exist before parity wiring');
  assert.notEqual(end, -1, 'transaction cancel route must follow legacy adjustment route');
  return server.slice(start, end);
}

test('prepared HTTP adapter preserves the legacy adjustment request and response contract', () => {
  const legacy = legacyRouteSource();

  for (const source of [legacy, handlerSource]) {
    assert.match(source, /Math\.trunc\(Number\(req\.body\?\.amount \|\| 0\)\)/);
    assert.match(source, /String\(req\.body\?\.reason \|\| ''\)\.trim\(\)/);
    assert.match(source, /normalizeRequestKey\(req\.body\?\.requestKey\)/);
    assert.match(source, /Укажите сумму и причину\./);
    assert.match(source, /Некорректный requestKey корректировки\./);
    assert.match(source, /replayed: true/);
  }

  assert.match(handlerSource, /balance: Number\(result\.balanceAfter \|\| 0\)/);
  assert.match(legacy, /balance: Number\(existing\.rows\[0\]\.balance_after \|\| walletResult\.rows\[0\]\.balance \|\| 0\)/);
  assert.match(legacy, /balance: newBalance/);
});

test('prepared wiring preserves legacy authentication and admin-role ordering', () => {
  const legacy = legacyRouteSource();

  assert.match(
    legacy,
    /^app\.post\('\/api\/admin\/users\/:id\/adjust', authRequired, requireRole\('admin'\),/m
  );
  assert.match(wiringSource, /const adminOnly = requireRole\('admin'\)/);
  assert.match(
    wiringSource,
    /app\.post\(\s*'\/api\/admin\/users\/:id\/adjust',\s*authRequired,\s*adminOnly,\s*runtime\.handler\s*\)/s
  );
});

test('shared executor preserves the financial mutation invariants of the legacy route', () => {
  const legacy = legacyRouteSource();

  for (const source of [legacy, executorSource]) {
    assert.match(source, /BEGIN/);
    assert.match(source, /lockRequestKey/);
    assert.match(source, /FROM users/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /SELECT balance FROM wallets WHERE user_id = \$1 FOR UPDATE/);
    assert.match(source, /SELECT \* FROM transactions WHERE request_key = \$1/);
    assert.match(source, /hasUnlimitedBonus/);
    assert.match(source, /UPDATE wallets SET balance = \$1, updated_at = NOW\(\) WHERE user_id = \$2/);
    assert.match(source, /COMMIT/);
    assert.match(source, /ROLLBACK/);
  }

  assert.match(executorSource, /createAdminAdjustmentPersistence/);
  assert.match(executorSource, /assertMatchingTransaction/);
  assert.match(executorSource, /newBalance < 0/);
});

test('parity wiring intentionally tightens only malformed unsafe amount handling before production switch', () => {
  assert.match(handlerSource, /error instanceof TypeError/);
  assert.match(handlerSource, /Укажите корректную целую сумму\./);
  assert.match(executorSource, /Number\.isSafeInteger\(amount\)/);
  assert.match(executorSource, /Number\.isSafeInteger\(oldBalance\)/);
  assert.match(executorSource, /Number\.isSafeInteger\(newBalance\)/);
});

test('production route is still legacy until the explicit final wiring patch', () => {
  const legacy = legacyRouteSource();
  assert.match(legacy, /createAdminAdjustmentPersistence/);
  assert.doesNotMatch(server, /createAdminAdjustmentServerWiring\(/);
});
