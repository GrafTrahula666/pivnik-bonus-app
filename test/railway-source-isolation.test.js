import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyRailwaySourceIsolation, snapshotFromRailwayReadbacks } from '../scripts/railway-source-isolation.mjs';
import { RAILWAY_PRODUCTION } from '../scripts/railway-production-config.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
function fixture() {
  const source = () => ({ repo: 'GrafTrahula666/pivnik-bonus-app', branch: 'main', commitSha: SHA, checkSuites: false });
  return {
    projectId: RAILWAY_PRODUCTION.projectId,
    environmentId: RAILWAY_PRODUCTION.environmentId,
    environmentName: 'production',
    staged: null,
    services: [
      { id: RAILWAY_PRODUCTION.services.telegram, state: 'live', staged: null,
        config: { source: source(), build: { watchPatterns: ['/index.html', '/app.js'] } } },
      { id: RAILWAY_PRODUCTION.services.vk, state: 'live', staged: null,
        config: { source: source(), build: { watchPatterns: ['/index.html', '/app.js'] } } },
    ],
  };
}
const reject = (snapshot, reason) => assert.throws(() => verifyRailwaySourceIsolation(snapshot, SHA), reason);

test('both services explicitly pinned to the approved SHA pass offline policy', () => {
  assert.deepEqual(verifyRailwaySourceIsolation(fixture(), SHA),
    { isolated: true, source: 'pinned-commit', sha: SHA, services: 2 });
});

test('current branch-tracking production shape is rejected even with CI and watch path guards', () => {
  for (const ci of [false, true]) {
    const snap = fixture();
    for (const service of snap.services) {
      delete service.config.source.commitSha;
      service.config.source.checkSuites = ci;
      service.config.build.watchPatterns = ['/ops/never-changes-release.flag'];
    }
    reject(snap, /follows branch/);
  }
});

test('single pinned service cannot stand in for both production services', () => {
  const snap = fixture();
  delete snap.services[1].config.source.commitSha;
  reject(snap, /vk: GitHub source follows branch/);
});

test('different pinned SHA is rejected', () => {
  const snap = fixture();
  snap.services[0].config.source.commitSha = OTHER;
  reject(snap, /telegram: GitHub source follows branch or is pinned to a different SHA/);
});

test('unknown and duplicate production services fail closed', () => {
  const extra = fixture(); extra.services.push(structuredClone(extra.services[0]));
  reject(extra, /exactly two production services/);
  const duplicate = fixture(); duplicate.services[1].id = duplicate.services[0].id;
  reject(duplicate, /IDs must be present and unique/);
  const missing = fixture(); missing.services = [missing.services[0]];
  reject(missing, /exactly two production services/);
});

test('staged changes cannot masquerade as live source policy', () => {
  const env = fixture(); env.staged = { patchId: 'pending' };
  reject(env, /environment has staged changes/);
  const svc = fixture(); svc.services[1].staged = { patchId: 'pending' };
  reject(svc, /not live or has staged changes/);
});

test('foreign project, environment or repo fails closed', () => {
  const project = fixture(); project.projectId = 'other'; reject(project, /unexpected project/);
  const environment = fixture(); environment.environmentName = 'staging'; reject(environment, /unexpected environment/);
  const repo = fixture(); repo.services[1].config.source.repo = 'stranger/repo'; reject(repo, /unexpected repository source/);
});

test('null, missing and malformed evidence fails closed', () => {
  reject(null, /snapshot is required/);
  const noState = fixture(); delete noState.staged; reject(noState, /no staged-change evidence/);
  const noSource = fixture(); delete noSource.services[0].config.source;
  reject(noSource, /unexpected repository source/);
  assert.throws(() => verifyRailwaySourceIsolation(fixture(), 'main'), /approved SHA/);
});

function connectorFixture() {
  const expected = fixture();
  const environment = {
    project: { id: RAILWAY_PRODUCTION.projectId },
    environment: { id: RAILWAY_PRODUCTION.environmentId, name: 'production' },
    staged: null,
    services: expected.services.map(item => ({
      id: item.id, state: item.state, stagedChangeCount: 0,
      source: { repo: item.config.source.repo, branch: item.config.source.branch, image: null,
        commitSha: item.config.source.commitSha },
    })),
  };
  const serviceConfigs = expected.services.map(item => ({
    service: { id: item.id },
    environment: { id: RAILWAY_PRODUCTION.environmentId },
    staged: null,
    config: structuredClone(item.config),
  }));
  return { environment, serviceConfigs };
}

test('actual Railway connector-shaped readbacks map consistently to exact-SHA pin policy', () => {
  const { environment, serviceConfigs } = connectorFixture();
  assert.deepEqual(
    verifyRailwaySourceIsolation(snapshotFromRailwayReadbacks(environment, serviceConfigs), SHA),
    { isolated: true, source: 'pinned-commit', sha: SHA, services: 2 },
  );
  // Current live Railway source follows main with no exact SHA; offline
  // connector reconciliation must not silently invent a pin.
  delete serviceConfigs[0].config.source.commitSha;
  delete serviceConfigs[1].config.source.commitSha;
  assert.throws(
    () => verifyRailwaySourceIsolation(snapshotFromRailwayReadbacks(environment, serviceConfigs), SHA),
    /telegram: GitHub source follows branch/,
  );
});

test('Railway connector readbacks fail closed on cross-service and cross-environment mixing', () => {
  const mixed = connectorFixture();
  mixed.serviceConfigs[0].config.source.branch = 'feature';
  assert.throws(() => snapshotFromRailwayReadbacks(mixed.environment, mixed.serviceConfigs),
    /source mismatch between environment and service readbacks/);

  const foreign = connectorFixture();
  foreign.serviceConfigs[1].environment.id = 'staging';
  assert.throws(() => snapshotFromRailwayReadbacks(foreign.environment, foreign.serviceConfigs),
    /different or staged environment/);

  const missing = connectorFixture();
  missing.environment.services.pop();
  assert.throws(() => snapshotFromRailwayReadbacks(missing.environment, missing.serviceConfigs),
    /not uniquely present in environment inventory/);

  const duplicate = connectorFixture();
  duplicate.serviceConfigs[1].service.id = duplicate.serviceConfigs[0].service.id;
  assert.throws(() => snapshotFromRailwayReadbacks(duplicate.environment, duplicate.serviceConfigs),
    /unknown or duplicate service config readback/);
});

test('Railway connector rejects inconsistent exact-SHA pins across independent readbacks', () => {
  const mismatched = connectorFixture();
  mismatched.environment.services[0].source.commitSha = OTHER;
  assert.throws(
    () => snapshotFromRailwayReadbacks(mismatched.environment, mismatched.serviceConfigs),
    /source mismatch between environment and service readbacks/,
  );
  const onlyService = connectorFixture();
  delete onlyService.environment.services[0].source.commitSha;
  assert.throws(
    () => snapshotFromRailwayReadbacks(onlyService.environment, onlyService.serviceConfigs),
    /source mismatch between environment and service readbacks/,
  );
  const onlyEnvironment = connectorFixture();
  delete onlyEnvironment.serviceConfigs[0].config.source.commitSha;
  assert.throws(
    () => snapshotFromRailwayReadbacks(onlyEnvironment.environment, onlyEnvironment.serviceConfigs),
    /source mismatch between environment and service readbacks/,
  );
});

test('Railway connector readbacks reject staged, missing or non-live service evidence', () => {
  const stagedEnvironment = connectorFixture();
  stagedEnvironment.environment.staged = { patchId: 'pending' };
  assert.throws(() => snapshotFromRailwayReadbacks(stagedEnvironment.environment, stagedEnvironment.serviceConfigs),
    /environment readback contains staged changes/);

  const stagedService = connectorFixture();
  stagedService.serviceConfigs[0].staged = { patchId: 'pending' };
  assert.throws(() => snapshotFromRailwayReadbacks(stagedService.environment, stagedService.serviceConfigs),
    /service config readback belongs to a different or staged environment/);

  const stagedChange = connectorFixture();
  stagedChange.environment.services[0].stagedChangeCount = 1;
  assert.throws(() => snapshotFromRailwayReadbacks(stagedChange.environment, stagedChange.serviceConfigs),
    /not live or has staged changes/);

  const noInventory = connectorFixture();
  delete noInventory.environment.services;
  assert.throws(() => snapshotFromRailwayReadbacks(noInventory.environment, noInventory.serviceConfigs),
    /environment service inventory is missing/);

  const noSource = connectorFixture();
  delete noSource.serviceConfigs[0].config.source;
  assert.throws(() => snapshotFromRailwayReadbacks(noSource.environment, noSource.serviceConfigs),
    /source mismatch between environment and service readbacks/);
});

test('2026-11-11 live Railway production readbacks reject both branch-tracking services', () => {
  // Sanitized from read-only Railway describe_environment + get_service_config,
  // project content-nature, production; no secrets or variable values.
  // This is a historical regression fixture, NOT an authenticated live check.
  const environment = {
    project: { id: '20a942f9-3164-484a-a6f1-565439e38705' },
    environment: { id: 'cdd9d26c-2aab-45d9-95ed-ef487fafaa8f', name: 'production' },
    staged: null,
    services: [
      { id: 'd8d26f64-9ac1-4a03-9036-1a60f43c0be6', state: 'live',
        stagedChangeCount: 0, source: { image: null, repo: 'GrafTrahula666/pivnik-bonus-app', branch: 'main' } },
      { id: '0573c420-0f9c-43bd-8e87-e1788ce3eefd', state: 'live',
        stagedChangeCount: 0, source: { image: null, repo: 'GrafTrahula666/pivnik-bonus-app', branch: 'main' } },
    ],
  };
  const serviceConfigs = environment.services.map(service => ({
    service: { id: service.id },
    environment: { id: environment.environment.id, name: 'production' },
    staged: null,
    config: { source: { repo: service.source.repo, branch: 'main', checkSuites: false },
      build: { watchPatterns: ['/ops/spaceverse-production-release-approval-20261103.flag', '/index.html'] } },
  }));
  const snapshot = snapshotFromRailwayReadbacks(environment, serviceConfigs);
  assert.equal(snapshot.services.length, 2);
  for (const service of snapshot.services) {
    assert.equal(service.config.source.commitSha, undefined);
    assert.equal(service.config.source.checkSuites, false);
  }
  assert.throws(() => verifyRailwaySourceIsolation(snapshot, SHA),
    /telegram: GitHub source follows branch or is pinned to a different SHA/);
});
