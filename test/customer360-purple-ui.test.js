import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('Customer 360 is wired into canonical purple CRM without a write path', async () => {
  const [app, html, styles] = await Promise.all([
    read('app.js'),
    read('index.html'),
    read('styles.css')
  ]);

  assert.match(html, /id="customer360Modal"/);
  assert.match(html, /id="customer360Metrics"/);
  assert.match(html, /id="customer360History"/);
  assert.match(app, /async function openCustomer360\(userId\)/);
  assert.match(app, /api\(\`\/api\/admin\/users\/\$\{id\}\`\)/);
  assert.match(app, /data-customer360-user=/);
  assert.match(app, /renderCustomer360\(data\.customer\)/);
  assert.match(styles, /SPACEVERSE Customer 360/);
  assert.match(styles, /\.customer360-metrics/);

  const start = app.indexOf('async function openCustomer360(userId)');
  const end = app.indexOf('function renderUsers(', start);
  const source = app.slice(start, end);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('Customer 360 API materializes last and reuses existing admin read authorization', async () => {
  const [pkg, materializer] = await Promise.all([
    read('package.json'),
    read('scripts/apply-spaceverse-customer360-api.mjs')
  ]);

  const parsed = JSON.parse(pkg);
  for (const scriptName of ['prestart', 'materialize']) {
    const script = parsed.scripts[scriptName];
    assert.ok(script.endsWith('node scripts/apply-spaceverse-customer360-api.mjs'), `${scriptName} must finish with Customer 360 materialization`);
  }
  assert.match(parsed.scripts.check, /apply-spaceverse-customer360-api\.mjs/);
  assert.match(parsed.scripts.check, /customer-360-repository\.js/);

  assert.match(materializer, /requireGatewayUser\(req\)/);
  assert.match(materializer, /termsAccepted/);
  assert.match(materializer, /\['viewer', 'admin'\]/);
  assert.match(materializer, /req\.method === 'GET'/);
  assert.doesNotMatch(materializer, /req\.method === '(?:POST|PUT|PATCH|DELETE)'/);
});
