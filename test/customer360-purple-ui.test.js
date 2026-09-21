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

test('Customer 360 API keeps admin read authorization and lifecycle UI materializes last', async () => {
  const [pkg, apiMaterializer, lifecycleMaterializer] = await Promise.all([
    read('package.json'),
    read('scripts/apply-spaceverse-customer360-api.mjs'),
    read('scripts/apply-customer360-lifecycle-ui.mjs')
  ]);

  const parsed = JSON.parse(pkg);
  for (const scriptName of ['prestart', 'materialize']) {
    const script = parsed.scripts[scriptName];
    const apiStep = 'node scripts/apply-spaceverse-customer360-api.mjs';
    const lifecycleStep = 'node scripts/apply-customer360-lifecycle-ui.mjs';
    assert.ok(script.includes(apiStep), `${scriptName} must include Customer 360 API materialization`);
    assert.ok(script.endsWith(lifecycleStep), `${scriptName} must finish with Customer 360 lifecycle UI materialization`);
    assert.ok(script.indexOf(apiStep) < script.indexOf(lifecycleStep), `${scriptName} must materialize API before lifecycle UI`);
  }
  assert.match(parsed.scripts.check, /apply-spaceverse-customer360-api\.mjs/);
  assert.match(parsed.scripts.check, /apply-customer360-lifecycle-ui\.mjs/);
  assert.match(parsed.scripts.check, /customer-360-repository\.js/);

  assert.match(apiMaterializer, /requireGatewayUser\(req\)/);
  assert.match(apiMaterializer, /termsAccepted/);
  assert.match(apiMaterializer, /\['viewer', 'admin'\]/);
  assert.match(apiMaterializer, /req\.method === 'GET'/);
  assert.doesNotMatch(apiMaterializer, /req\.method === '(?:POST|PUT|PATCH|DELETE)'/);

  assert.match(lifecycleMaterializer, /customer\.lifecycle/);
  assert.match(lifecycleMaterializer, /daysSinceLastVisit/);
});
