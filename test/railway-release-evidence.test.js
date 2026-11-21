import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRailwayDeployments, RAILWAY_RELEASE_TARGETS,
  RAILWAY_RELEASE_ENVIRONMENT, RAILWAY_RELEASE_PROJECT } from '../scripts/verify-railway-release-evidence.mjs';

const sha = 'a'.repeat(40);
const url = 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/12345';
const manifest = () => ({
  schemaVersion: 1, releaseSha: sha, createdAt: '2026-11-09T15:00:00Z',
  approval: { actor: 'reviewer', prNumber: 123, sha, at: '2026-11-09T14:00:00Z',
    evidenceUrl: 'https://github.com/GrafTrahula666/pivnik-bonus-app/pull/123#pullrequestreview-456' },
  checks: [
    { name: 'Pivnik release gate', sha, runId: 12345, required: true,
      conclusion: 'success', event: 'workflow_dispatch', evidenceUrl: url,
      releaseConfirm: 'DEPLOY_PIVNIK_PRODUCTION', runAttempt: 1,
      completedAt: '2026-11-09T14:50:00Z', productionSteps: {
        'Deploy exact commit and verify both production services': 'success',
        'Probe production documents and public endpoints': 'success',
        'Verify separate Telegram and VK production accounts': 'success',
        'Verify signed Telegram and VK production sessions': 'success' } },
    { name: 'VK native hosting main parity', sha, runId: 12346, required: true,
      conclusion: 'success', event: 'push', evidenceUrl: url.replace('12345', '12346') },
  ],
  artifacts: [{ name: 'bundle', sha, sha256: 'c'.repeat(64), evidenceUrl: url }],
  deployments: [
    { target: 'pivnik-bonus-app', sha, environment: 'production',
      deploymentId: 'deployment-1', deployedAt: '2026-11-09T14:15:00Z',
      status: 'success', evidenceUrl: url },
    { target: 'vk-native-hosting', sha, environment: 'production',
      deploymentId: 'deployment-2', deployedAt: '2026-11-09T14:20:00Z',
      status: 'success', evidenceUrl: url },
  ],
  smoke: [
    { target: 'pivnik-bonus-app', sha, at: '2026-11-09T14:40:00Z',
      result: 'passed', evidenceUrl: url },
    { target: 'vk-native-hosting', sha, at: '2026-11-09T14:42:00Z',
      result: 'passed', evidenceUrl: url },
  ],
  rollback: { sha: 'b'.repeat(40), deploymentId: 'known-good',
    verifiedAt: '2026-11-09T13:50:00Z', evidenceUrl: url },
});
const lookup = async ({ projectId, environmentId, serviceId, deploymentId }) => {
  assert.equal(projectId, RAILWAY_RELEASE_PROJECT);
  assert.equal(environmentId, RAILWAY_RELEASE_ENVIRONMENT);
  return { id: deploymentId, serviceId, environmentId, status: 'SUCCESS',
    meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z' };
};

test('read-only authenticated lookup binds both deployments to exact service, environment and SHA', async () => {
  const result = await verifyRailwayDeployments(manifest(), { lookupDeployment: lookup });
  assert.equal(result.length, 2);
  assert.equal(result[0].sha, sha);
  assert.equal(result[1].target, 'vk-native-hosting');
});

test('missing authenticated lookup fails closed', async () => {
  await assert.rejects(verifyRailwayDeployments(manifest()), /authenticated Railway lookup/);
});

test('swapped service, wrong environment, unknown ID, wrong SHA and non-success status fail closed', async () => {
  const mutations = [
    (record) => { record.serviceId = RAILWAY_RELEASE_TARGETS['vk-native-hosting']; },
    (record) => { record.environmentId = 'staging'; },
    (record) => { record.id = 'another-deployment'; },
    (record) => { record.meta.commitHash = 'b'.repeat(40); },
    (record) => { record.status = 'SKIPPED'; },
    (record) => { record.status = 'REMOVED'; },
    (record) => { record.createdAt = '2026-11-09T14:30:00Z'; },
  ];
  for (const mutate of mutations) {
    await assert.rejects(verifyRailwayDeployments(manifest(), {
      lookupDeployment: async args => { const record = await lookup(args); mutate(record); return record; },
    }), /Railway release evidence mismatch/);
  }
  await assert.rejects(verifyRailwayDeployments(manifest(), {
    lookupDeployment: async () => null,
  }), /deployment not found/);
});
