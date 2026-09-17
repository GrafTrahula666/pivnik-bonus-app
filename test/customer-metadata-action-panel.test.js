import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../customer-metadata-action-panel.js', import.meta.url), 'utf8');

test('metadata action panel keeps confirmation and authorization outside presentation layer', () => {
  assert.match(source, /controller\.execute\(kind,/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /actorId|actor_id/);
  assert.doesNotMatch(source, /tenantId|tenant_id|locationId|location_id/);
});

test('metadata action panel requires reason and suppresses duplicate submits', () => {
  assert.match(source, /name: 'reason'/);
  assert.match(source, /required = true/);
  assert.match(source, /if \(submitting\) return/);
  assert.match(source, /submit\.disabled = value/);
  assert.match(source, /aria-busy/);
});

test('metadata action panel exposes only the fixed metadata operations', () => {
  for (const action of ['addNote', 'addTag', 'removeTag', 'addSegment', 'removeSegment']) {
    assert.match(source, new RegExp(`\\['${action}'`));
  }
  assert.doesNotMatch(source, /deleteCustomer|bulk|massAction|arbitraryEndpoint/);
});

test('metadata action panel keeps honest user-visible result states', () => {
  assert.match(source, /Изменение сохранено/);
  assert.match(source, /Действие отменено/);
  assert.match(source, /Предыдущее действие ещё выполняется/);
  assert.match(source, /Не удалось выполнить действие/);
  assert.match(source, /aria-live/);
});

test('metadata action panel remains opt-in and dependency-free', () => {
  assert.match(source, /productionNavigationWiring: false/);
  assert.match(source, /dependenciesAdded: false/);
  assert.doesNotMatch(source, /^import /m);
});
