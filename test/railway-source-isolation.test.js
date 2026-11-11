import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyRailwaySourceIsolation } from '../scripts/railway-source-isolation.mjs';
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
