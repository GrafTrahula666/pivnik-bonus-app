import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RAILWAY_PRODUCTION } from '../scripts/railway-production-config.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production routing points at the active Railway project and services', () => {
  assert.equal(RAILWAY_PRODUCTION.projectId, '20a942f9-3164-484a-a6f1-565439e38705');
  assert.equal(RAILWAY_PRODUCTION.environmentId, 'cdd9d26c-2aab-45d9-95ed-ef487fafaa8f');
  assert.equal(RAILWAY_PRODUCTION.services.telegram, 'd8d26f64-9ac1-4a03-9036-1a60f43c0be6');
  assert.equal(RAILWAY_PRODUCTION.services.vk, '0573c420-0f9c-43bd-8e87-e1788ce3eefd');
  assert.equal(RAILWAY_PRODUCTION.services.postgres, '4f0c39c3-cd84-4f41-a97e-c95b342653c4');
});

test('release gate resolves live service domains and prefers the account token', async () => {
  const [workflow, deployer] = await Promise.all([
    read('.github/workflows/release-gate.yml'),
    read('scripts/railway-deploy-and-verify-production.mjs')
  ]);

  assert.match(deployer, /query ProductionServiceDomains/);
  assert.match(deployer, /const railwayAuthHeaders = API_TOKEN/);
  assert.doesNotMatch(workflow, /pivnik-bonus-app-production\.up\.railway\.app/);
  assert.doesNotMatch(workflow, /pivnik-vk-test-production\.up\.railway\.app/);
  assert.doesNotMatch(workflow, /github\.event_name == 'push'[\s\S]{0,120}hotfix\/anna-frame-consent-persistence/);
});

test('public production probes use the same central routing configuration', async () => {
  const [probe, unified, separated] = await Promise.all([
    read('scripts/probe-current-production.mjs'),
    read('scripts/verify-unified-production.mjs'),
    read('scripts/verify-platform-separation-production.mjs')
  ]);

  for (const source of [probe, unified, separated]) {
    assert.match(source, /railway-production-config\.mjs/);
  }
  assert.match(probe, /if \(!response\.ok\) failures\.push/);
  assert.match(probe, /if \(failures\.length\)[\s\S]*process\.exitCode = 1/);
  assert.doesNotMatch(probe, /process\.exitCode = 0/);
});
