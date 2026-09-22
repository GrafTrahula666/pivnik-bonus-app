import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const materializer = await readFile(new URL('../scripts/apply-customer360-lifecycle-ui.mjs', import.meta.url), 'utf8');
const directory = await readFile(new URL('../admin-user-directory.js', import.meta.url), 'utf8');

test('admin CRM directory exposes lifecycle segment filter end to end', () => {
  assert.match(materializer, /id=\"userLifecycleFilter\"/);
  assert.match(materializer, /params\.set\('lifecycle', lifecycle\)/);
  assert.match(materializer, /userLifecycleFilter.*addEventListener\('change', filterAdminUsers\)/s);
  for (const segment of ['new', 'active', 'at_risk', 'sleeping', 'no_visits']) {
    assert.match(materializer, new RegExp(`option value=\\"${segment}\\"`));
    assert.match(directory, new RegExp(`filters\\.lifecycle === '${segment}'`));
  }
});

test('lifecycle UI materializer remains idempotent', () => {
  assert.match(materializer, /if \(!source\.includes\(directoryMarker\)\)/);
  assert.match(materializer, /if \(!html\.includes\('id=\"userLifecycleFilter\"'\)\)/);
});
