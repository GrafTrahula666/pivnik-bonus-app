import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('gateway serves mutable app assets no-store before request fallback', async () => {
  const gateway = await read('universal-server.js');
  for (const [asset, type] of [
    ['app.js', 'text/javascript; charset=utf-8'],
    ['styles.css', 'text/css; charset=utf-8']
  ]) {
    const route = `url.pathname === '/${asset}'`;
    const pos = gateway.indexOf(route);
    assert.ok(pos > 0, `${asset} explicit gateway route missing`);
    const block = gateway.slice(pos, pos + 360);
    assert.match(block, /serveFile\(/);
    assert.ok(block.includes(type), `${asset} content type missing`);
    assert.match(block, /'no-store'/);
  }
  assert.ok(
    gateway.indexOf("url.pathname === '/app.js'") < gateway.indexOf("url.pathname === '/loader-fix.css'"),
    'mutable app assets must be handled before later static/fallback routes'
  );
});

test('effective service role survives auth response and profile save response', async () => {
  const gateway = await read('universal-server.js');
  assert.match(
    gateway,
    /const authPayload = await getAppPayload\(userId, provider, \{ startup: true \}\);[\s\S]{0,500}authPayload\.profile\.role = effectiveRoleForAuthenticatedIdentity/
  );
  assert.match(
    gateway,
    /const updated = await updateUnifiedProfile\(user\.id, platform, body\);[\s\S]{0,180}updated\.profile\.role = user\.role/
  );
});
