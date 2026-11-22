import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRailwayDeployments, createRailwayDeploymentLookup, RAILWAY_RELEASE_TARGETS,
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
    (record) => { record.createdAt = '2026-11-09T13:59:59Z'; }, // before approval
    (record) => { record.createdAt = '2026-11-09T14:30:00Z'; },
    (record) => { record.createdAt = '2026-11-09T14:10:00+00:00'; }, // not canonical UTC
    (record) => { record.createdAt = '2026-11-09T14:10:00'; }, // timezone missing
    (record) => { record.createdAt = '2026-11-09T14:10:00.000+00:00'; },
    (record) => { record.createdAt = '2026-11-09T14:10:00Zgarbage'; },
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

const railwayId = 'd17d40dc-28d0-4f90-b3c6-86d923530fc4';
const railwayScope = { projectId: RAILWAY_RELEASE_PROJECT,
  environmentId: RAILWAY_RELEASE_ENVIRONMENT,
  serviceId: RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'], deploymentId: railwayId };

test('Railway API adapter issues only scoped read-only GraphQL deployment lookup', async () => {
  let calls = 0;
  const lookupDeployment = createRailwayDeploymentLookup({
    token: 'test-token',
    fetchImpl: async (endpoint, options) => {
      calls++;
      assert.equal(endpoint, 'https://backboard.railway.com/graphql/v2');
      assert.equal(options.method, 'POST');
      // The Railway API token must not follow provider/proxy redirects.
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const request = JSON.parse(options.body);
      assert.match(request.query, /deployment\(id: \$id\)/);
      assert.equal(request.variables.id, railwayId);
      return { ok: true, json: async () => ({ data: { deployment: {
        id: railwayId, serviceId: railwayScope.serviceId,
        environmentId: railwayScope.environmentId, status: 'SUCCESS',
        meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z',
      } } }) };
    },
  });
  assert.equal((await lookupDeployment(railwayScope)).id, railwayId);
  assert.equal(calls, 1);
});

test('Railway API adapter rejects missing token, wrong scope and malformed IDs', async () => {
  assert.throws(() => createRailwayDeploymentLookup(), /token is required/);
  const lookupDeployment = createRailwayDeploymentLookup({ token: 'test-token',
    fetchImpl: async () => { throw new Error('unexpected network call'); } });
  await assert.rejects(lookupDeployment({ ...railwayScope, environmentId: 'staging' }),
    /untrusted Railway lookup scope/);
  await assert.rejects(lookupDeployment({ ...railwayScope, deploymentId: 'not-a-uuid' }),
    /invalid Railway deployment ID/);
  for (const deploymentId of [
    'd17d40dc-28d0-4f90-b3c6-86d923530fc4-extra',
    'd17d40dc28d04f90b3c686d923530fc4',
    'd17d40dc-28d0-4f90-b3c6-86d923530fc-',
    'd17d40dc-28d0-4f90-b3c6-86d923530fc4-',
  ]) {
    await assert.rejects(lookupDeployment({ ...railwayScope, deploymentId }),
      /invalid Railway deployment ID/);
  }
});

test('Railway API adapter fails closed on HTTP, GraphQL and missing record errors', async () => {
  for (const response of [
    { ok: false, status: 401 },
    { ok: true, json: async () => ({ errors: [{ message: 'unauthorized' }] }) },
    { ok: true, json: async () => ({ data: { deployment: null } }) },
  ]) {
    const lookupDeployment = createRailwayDeploymentLookup({
      token: 'test-token', fetchImpl: async () => response,
    });
    await assert.rejects(lookupDeployment(railwayScope),
      /Railway release evidence mismatch/);
  }
});

test('Railway API adapter fails closed on network rejection, invalid JSON and malformed GraphQL envelope', async () => {
  const cases = [
    async () => { throw new Error('network unavailable'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => null }),
    async () => ({ ok: true, json: async () => ({ data: null }) }),
    async () => ({ ok: true, json: async () => ({ data: { deployment: 'not-an-object' } }) }),
  ];
  for (const fetchImpl of cases) {
    const lookupDeployment = createRailwayDeploymentLookup({ token: 'test-token', fetchImpl });
    await assert.rejects(lookupDeployment(railwayScope));
  }
});

test('Railway API rejects malformed GraphQL errors and array-shaped records even with HTTP 200', async () => {
  const record = {
    id: railwayId, serviceId: railwayScope.serviceId,
    environmentId: railwayScope.environmentId, status: 'SUCCESS',
    meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z',
  };
  const malformed = [
    { errors: { message: 'access denied' }, data: { deployment: record } },
    { errors: 'access denied', data: { deployment: record } },
    { errors: null, data: { deployment: record } },
    { errors: [{ message: 'access denied' }], data: { deployment: record } },
    { data: { deployment: [] } },
    { data: [] },
  ];
  for (const envelope of malformed) {
    const lookupDeployment = createRailwayDeploymentLookup({
      token: 'test-token',
      fetchImpl: async () => ({ ok: true, json: async () => envelope }),
    });
    await assert.rejects(lookupDeployment(railwayScope),
      /Railway release evidence mismatch/);
  }
});

test('Railway GraphQL adapter and release validator reject a successful HTTP response with wrong deployment SHA', async () => {
  const release = manifest();
  release.deployments = release.deployments.map((entry, index) => ({
    ...entry,
    deploymentId: index === 0
      ? 'd17d40dc-28d0-4f90-b3c6-86d923530fc4'
      : 'b51f9fed-6be7-416b-b231-58ebf8dd03a1',
  }));
  const requested = [];
  const lookupDeployment = createRailwayDeploymentLookup({
    token: 'test-token',
    fetchImpl: async (_endpoint, options) => {
      const { variables } = JSON.parse(options.body);
      requested.push(variables.id);
      return {
        ok: true,
        json: async () => ({ data: { deployment: {
          id: variables.id,
          serviceId: RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
          environmentId: RAILWAY_RELEASE_ENVIRONMENT,
          status: 'SUCCESS',
          createdAt: '2026-11-09T14:10:00Z',
          meta: { commitHash: 'b'.repeat(40) },
        } } }),
      };
    },
  });
  await assert.rejects(
    verifyRailwayDeployments(release, { lookupDeployment }),
    /exact commit SHA/,
  );
  assert.deepEqual(requested, ['d17d40dc-28d0-4f90-b3c6-86d923530fc4']);
});

test('Railway GraphQL streaming response is accepted only within a 128 KiB byte budget', async () => {
  const record = {
    id: railwayId, serviceId: railwayScope.serviceId,
    environmentId: railwayScope.environmentId, status: 'SUCCESS',
    meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z',
  };
  const validBody = JSON.stringify({ data: { deployment: record } });
  const validLookup = createRailwayDeploymentLookup({
    token: 'test-token',
    fetchImpl: async () => new Response(validBody, {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal((await validLookup(railwayScope)).id, railwayId);

  // Without a streaming cap this would be valid JSON containing the right
  // deployment and would silently pass, despite an excessive API payload.
  const oversizedBody = JSON.stringify({
    data: { deployment: record }, padding: 'x'.repeat(160 * 1024),
  });
  const oversizedLookup = createRailwayDeploymentLookup({
    token: 'test-token',
    fetchImpl: async () => new Response(oversizedBody, {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(oversizedLookup(railwayScope),
    /Railway GraphQL response exceeds byte limit/);
});

test('CLI Railway live-lookup opt-in defaults offline and fails closed on missing token or typo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pivnik-railway-release-test-'));
  try {
    const file = join(directory, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest()));
    const command = fileURLToPath(new URL('../scripts/validate-release-evidence.mjs', import.meta.url));
    const run = (railwayFlag, githubFlag) => {
      const env = { ...process.env, GITHUB_TOKEN: '', RAILWAY_TOKEN: '' };
      delete env.PIVNIK_VERIFY_GITHUB;
      delete env.PIVNIK_VERIFY_RAILWAY;
      if (railwayFlag !== undefined) env.PIVNIK_VERIFY_RAILWAY = railwayFlag;
      if (githubFlag !== undefined) env.PIVNIK_VERIFY_GITHUB = githubFlag;
      return spawnSync(process.execPath, [command, file], {
        encoding: 'utf8', timeout: 10000, env,
      });
    };

    const offline = run();
    assert.equal(offline.status, 0, offline.stderr);
    assert.match(offline.stdout, /Release evidence format valid/);
    assert.doesNotMatch(offline.stdout, /Authenticated Railway/);

    // An explicitly present but empty flag must never silently become offline.
    const emptyRailwayFlag = run('');
    assert.equal(emptyRailwayFlag.status, 1);
    assert.match(emptyRailwayFlag.stderr, /PIVNIK_VERIFY_RAILWAY must equal 1/);
    const emptyGithubFlag = run(undefined, '');
    assert.equal(emptyGithubFlag.status, 1);
    assert.match(emptyGithubFlag.stderr, /PIVNIK_VERIFY_GITHUB must equal 1/);

    const missingToken = run('1');
    assert.equal(missingToken.status, 1);
    assert.match(missingToken.stderr, /Railway API token is required/);
    assert.doesNotMatch(missingToken.stdout, /Authenticated Railway/);

    const typo = run('true');
    assert.equal(typo.status, 1);
    assert.match(typo.stderr, /PIVNIK_VERIFY_RAILWAY must equal 1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
