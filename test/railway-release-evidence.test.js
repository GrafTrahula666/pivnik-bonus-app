import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRailwayDeployments, verifyRailwayRollbackDeployment, verifyBothRailwayRollbackDeployments, verifyCurrentRailwayDeployments, createRailwayDeploymentLookup, RAILWAY_RELEASE_TARGETS,
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

test('historical rollback evidence requires an authenticated exact-SHA Railway record for one explicit service', async () => {
  const release = manifest();
  const observed = [];
  const rollbackLookup = async args => {
    observed.push(args);
    return { id: release.rollback.deploymentId, serviceId: args.serviceId,
      environmentId: args.environmentId, status: 'SUCCESS', canRollback: true,
      meta: { commitHash: release.rollback.sha },
      createdAt: '2026-11-09T13:30:00Z' };
  };
  const result = await verifyRailwayRollbackDeployment(release, {
    lookupDeployment: rollbackLookup, target: 'pivnik-bonus-app',
  });
  assert.equal(result.sha, release.rollback.sha);
  assert.equal(result.canRollback, true);
  assert.equal(result.target, 'pivnik-bonus-app');
  assert.deepEqual(observed, [{
    projectId: RAILWAY_RELEASE_PROJECT,
    environmentId: RAILWAY_RELEASE_ENVIRONMENT,
    serviceId: RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
    deploymentId: 'known-good',
  }]);
});

test('rollback attestation fails closed on absent scope, foreign service, wrong SHA, failed or late deployment', async () => {
  const release = manifest();
  const good = async args => ({
    id: release.rollback.deploymentId, serviceId: args.serviceId,
    environmentId: args.environmentId, status: 'SUCCESS', canRollback: true,
    meta: { commitHash: release.rollback.sha },
    createdAt: '2026-11-09T13:30:00Z',
  });
  await assert.rejects(verifyRailwayRollbackDeployment(release, {
    target: 'pivnik-bonus-app',
  }), /authenticated rollback deployment lookup/);
  for (const target of [undefined, '', 'another-service', '__proto__']) {
    await assert.rejects(verifyRailwayRollbackDeployment(release, {
      lookupDeployment: good, target,
    }), /explicit Railway rollback service target/);
  }
  const faults = [
    { id: 'wrong-id' },
    { serviceId: RAILWAY_RELEASE_TARGETS['vk-native-hosting'] },
    { environmentId: 'staging' },
    { status: 'FAILED' },
    { status: 'REMOVED' },
    { canRollback: false },
    { canRollback: null },
    { canRollback: undefined },
    { canRollback: 'true' },
    { meta: { commitHash: sha } },
    { createdAt: '2026-11-09T13:55:00Z' },
    { createdAt: '2026-11-09T14:01:00Z' },
    { createdAt: '2026-11-09T13:30:00+00:00' },
    { createdAt: '2026-02-30T13:30:00Z' },
  ];
  for (const fault of faults) {
    await assert.rejects(verifyRailwayRollbackDeployment(release, {
      target: 'pivnik-bonus-app',
      lookupDeployment: async args => ({ ...(await good(args)), ...fault }),
    }), /Railway release evidence mismatch/);
  }
  await assert.rejects(verifyRailwayRollbackDeployment(release, {
    target: 'pivnik-bonus-app', lookupDeployment: async () => null,
  }), /known-good rollback deployment/);
});

test('two-service rollback records attest distinct historical identities for one known-good SHA', async () => {
  const release = manifest();
  // The legacy single-target field must name a genuine member of the
  // separate two-service rollback map, not an unrelated third deployment.
  release.rollback.deploymentId = 'rollback-pivnik';
  release.rollback.railwayTargets = {
    'pivnik-bonus-app': { sha: 'b'.repeat(40), deploymentId: 'rollback-pivnik',
      verifiedAt: '2026-11-09T13:50:00Z', evidenceUrl: url },
    'vk-native-hosting': { sha: 'b'.repeat(40), deploymentId: 'rollback-vk',
      verifiedAt: '2026-11-09T13:51:00Z', evidenceUrl: url },
  };
  const observed = [];
  const good = async args => {
    observed.push(args);
    const name = Object.keys(RAILWAY_RELEASE_TARGETS)
      .find(key => RAILWAY_RELEASE_TARGETS[key] === args.serviceId);
    return { id: args.deploymentId, serviceId: args.serviceId,
      environmentId: args.environmentId, status: 'SUCCESS', canRollback: true,
      meta: { commitHash: release.rollback.railwayTargets[name].sha },
      createdAt: '2026-11-09T13:30:00Z' };
  };
  const verified = await verifyBothRailwayRollbackDeployments(release, { lookupDeployment: good });
  assert.deepEqual(verified.map(x => x.target), ['pivnik-bonus-app', 'vk-native-hosting']);
  assert.deepEqual(observed.map(x => x.serviceId), Object.values(RAILWAY_RELEASE_TARGETS));
  assert.deepEqual(observed.map(x => x.deploymentId), ['rollback-pivnik', 'rollback-vk']);
  assert.deepEqual(verified.map(x => x.sha), [release.rollback.sha, release.rollback.sha]);
  const mixed = structuredClone(release);
  mixed.rollback.railwayTargets['vk-native-hosting'].sha = 'c'.repeat(40);
  let mixedLookups = 0;
  await assert.rejects(verifyBothRailwayRollbackDeployments(mixed, {
    lookupDeployment: async args => {
      mixedLookups++;
      const record = await good(args);
      return { ...record, meta: { commitHash: args.serviceId === RAILWAY_RELEASE_TARGETS['vk-native-hosting']
        ? mixed.rollback.railwayTargets['vk-native-hosting'].sha : mixed.rollback.sha } };
    },
  }), /same known-good SHA/);
  assert.equal(mixedLookups, 0, 'reject incoherent rollback before any provider lookup');
  const upper = structuredClone(release);
  upper.rollback.railwayTargets['vk-native-hosting'].sha = release.rollback.sha.toUpperCase();
  assert.deepEqual((await verifyBothRailwayRollbackDeployments(upper, { lookupDeployment: good }))
    .map(x => x.sha), [release.rollback.sha, release.rollback.sha]);
  await assert.rejects(verifyBothRailwayRollbackDeployments(manifest(), {
    lookupDeployment: good,
  }), /separate rollback records/);
  await assert.rejects(verifyBothRailwayRollbackDeployments(release),
    /authenticated rollback deployment lookup/);
  for (const mutate of [
    data => { delete data.rollback.railwayTargets['vk-native-hosting']; },
    data => { data.rollback.railwayTargets['extra-service'] =
      data.rollback.railwayTargets['vk-native-hosting']; },
    data => { data.rollback.railwayTargets['vk-native-hosting'].deploymentId = 'rollback-pivnik'; },
    data => { data.rollback.railwayTargets['vk-native-hosting'].deploymentId = 'deployment-2'; },
    data => { data.rollback.railwayTargets['vk-native-hosting'].sha = sha; },
    data => { data.rollback.railwayTargets['vk-native-hosting'].verifiedAt = '2026-11-09T14:02:00Z'; },
    data => { data.rollback.deploymentId = 'unverified-third-rollback'; },
    data => { data.rollback.sha = 'd'.repeat(40); },
    data => { data.rollback.verifiedAt = '2026-11-09T13:45:00Z'; },
    data => { data.rollback.evidenceUrl = 'https://example.com/unrelated-rollback'; },
    data => { data.rollback.railwayTargets['pivnik-bonus-app'].deploymentId = 'another-pivnik-rollback'; },
  ]) {
    const bad = structuredClone(release);
    mutate(bad);
    await assert.rejects(verifyBothRailwayRollbackDeployments(bad, {
      lookupDeployment: good,
    }), /Railway release evidence mismatch|Invalid release evidence/);
  }
  for (const defect of [
    { serviceId: RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'] },
    { environmentId: 'staging' },
    { status: 'FAILED' },
    { canRollback: false },
    { canRollback: undefined },
    { meta: { commitHash: sha } },
    { createdAt: '2026-11-09T14:05:00Z' },
  ]) {
    await assert.rejects(verifyBothRailwayRollbackDeployments(release, {
      lookupDeployment: async args => {
        const record = await good(args);
        return args.serviceId === RAILWAY_RELEASE_TARGETS['vk-native-hosting']
          ? { ...record, ...defect } : record;
      },
    }), /Railway release evidence mismatch/);
  }
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
      assert.match(request.query, /canRollback/);
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

test('active Railway attestation matches BOTH current production deployment IDs', async () => {
  const release = manifest();
  const ids = ['d17d40dc-28d0-4f90-b3c6-86d923530fc4',
    'b51f9fed-6be7-416b-b231-58ebf8dd03a1'];
  release.deployments.forEach((item, index) => { item.deploymentId = ids[index]; });
  const calls = [];
  const lookupDeployment = createRailwayDeploymentLookup({
    token: 'test-token',
    fetchImpl: async (endpoint, options) => {
      assert.equal(endpoint, 'https://backboard.railway.com/graphql/v2');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const request = JSON.parse(options.body);
      calls.push(request);
      if (request.variables.id) {
        const index = ids.indexOf(request.variables.id);
        assert.notEqual(index, -1);
        return { ok: true, json: async () => ({ data: { deployment: {
          id: ids[index], serviceId: Object.values(RAILWAY_RELEASE_TARGETS)[index],
          environmentId: RAILWAY_RELEASE_ENVIRONMENT, status: 'SUCCESS',
          meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z',
        } } }) };
      }
      assert.match(request.query, /deployments\(input: \$input, first: 1\)/);
      assert.equal(request.variables.input.projectId, RAILWAY_RELEASE_PROJECT);
      assert.equal(request.variables.input.environmentId, RAILWAY_RELEASE_ENVIRONMENT);
      assert.deepEqual(request.variables.input.status, { successfulOnly: true });
      const index = Object.values(RAILWAY_RELEASE_TARGETS)
        .indexOf(request.variables.input.serviceId);
      assert.notEqual(index, -1);
      return { ok: true, json: async () => ({ data: { deployments: {
        edges: [{ node: { id: ids[index], status: 'SUCCESS',
          serviceId: Object.values(RAILWAY_RELEASE_TARGETS)[index],
          environmentId: RAILWAY_RELEASE_ENVIRONMENT,
          meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z' } }],
      } } }) };
    },
  });
  const result = await verifyCurrentRailwayDeployments(release, {
    lookupDeployment, lookupActiveDeployment: lookupDeployment.lookupActiveDeployment,
  });
  assert.equal(result.length, 2);
  assert.equal(calls.length, 6);
  assert.equal(calls.filter(c => c.variables.input).length, 4);
  assert.ok(calls.filter(c => c.variables.input).every(c =>
    /node \{ id serviceId environmentId status createdAt meta \}/.test(c.query)));
});

test('historical SUCCESS cannot pass current active deployment attestation', async () => {
  const release = manifest();
  await assert.rejects(verifyCurrentRailwayDeployments(release,
    { lookupDeployment: lookup }), /active Railway deployment lookup is required/);
  let activeCalls = 0;
  const historical = async args => lookup(args);
  const replacement = async () => {
    activeCalls++;
    return { id: 'replacement-deployment', status: 'SUCCESS' };
  };
  await assert.rejects(verifyCurrentRailwayDeployments(release, {
    lookupDeployment: historical, lookupActiveDeployment: replacement,
  }), /current active Railway deployment identity/);
  assert.equal(activeCalls, 1);

  for (const invalid of [null, { id: 'deployment-1', status: 'REMOVED' },
    { id: 'deployment-1', status: 'FAILED' }, []]) {
    await assert.rejects(verifyCurrentRailwayDeployments(release, {
      lookupDeployment: historical, lookupActiveDeployment: async () => invalid,
    }), /current active Railway deployment identity/);
  }
});

test('active deployment GraphQL lookup rejects empty, malformed and ambiguous results', async () => {
  const shapes = [
    { deployments: { edges: [] } },
    { deployments: { edges: [{ node: { id: railwayId, status: 'SUCCESS' } },
      { node: { id: railwayId, status: 'SUCCESS' } }] } },
    { deployments: { edges: [{ node: null }] } },
    { deployments: { edges: [{ node: { id: railwayId, status: 'REMOVED' } }] } },
    { deployments: null },
  ];
  for (const data of shapes) {
    const lookupDeployment = createRailwayDeploymentLookup({
      token: 'test-token',
      fetchImpl: async () => ({ ok: true, json: async () => ({ data }) }),
    });
    await assert.rejects(lookupDeployment.lookupActiveDeployment(railwayScope),
      /Railway release evidence mismatch/);
  }
  const lookupDeployment = createRailwayDeploymentLookup({ token: 'test-token',
    fetchImpl: async () => { throw new Error('unexpected network request'); } });
  await assert.rejects(lookupDeployment.lookupActiveDeployment(
    { ...railwayScope, serviceId: 'untrusted-service' }),
  /untrusted Railway lookup scope/);
});

test('current deployment attestation rejects mismatched service, environment, SHA and creation time', async () => {
  const valid = { id: 'deployment-1', status: 'SUCCESS',
    serviceId: RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
    environmentId: RAILWAY_RELEASE_ENVIRONMENT,
    meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z' };
  const faults = [
    { serviceId: RAILWAY_RELEASE_TARGETS['vk-native-hosting'] },
    { environmentId: 'staging' },
    { meta: { commitHash: 'b'.repeat(40) } },
    { createdAt: '2026-11-09T14:11:00Z' },
    { meta: null },
  ];
  for (const fault of faults) {
    let calls = 0;
    await assert.rejects(verifyCurrentRailwayDeployments(manifest(), {
      lookupDeployment: lookup,
      lookupActiveDeployment: async ({ serviceId }) => {
        calls++;
        return { ...valid, serviceId, ...fault };
      },
    }), /current active Railway deployment identity/);
    assert.equal(calls, 1);
  }
});

test('active Railway GraphQL read rejects a matching ID with foreign or malformed identity fields', async () => {
  const base = { id: railwayId, status: 'SUCCESS',
    serviceId: railwayScope.serviceId,
    environmentId: railwayScope.environmentId,
    meta: { commitHash: sha }, createdAt: '2026-11-09T14:10:00Z' };
  for (const override of [
    { serviceId: 'foreign-service' }, { environmentId: 'foreign-env' },
    { meta: { commitHash: 'not-a-sha' } }, { meta: null },
    { createdAt: 'not-a-date' },
  ]) {
    const lookupDeployment = createRailwayDeploymentLookup({
      token: 'test-token',
      fetchImpl: async () => ({ ok: true, json: async () => ({
        data: { deployments: { edges: [{ node: { ...base, ...override } }] } },
      }) }),
    });
    await assert.rejects(lookupDeployment.lookupActiveDeployment(railwayScope),
      /current active Railway deployment response invalid/);
  }
});

test('CLI Railway live-lookup opt-in defaults offline and fails closed on missing token or typo', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pivnik-railway-release-test-'));
  try {
    const file = join(directory, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest()));
    const command = fileURLToPath(new URL('../scripts/validate-release-evidence.mjs', import.meta.url));
    const run = (railwayFlag, githubFlag, rollbackTarget) => {
      const env = { ...process.env, GITHUB_TOKEN: '', RAILWAY_TOKEN: '' };
      delete env.PIVNIK_VERIFY_GITHUB;
      delete env.PIVNIK_VERIFY_RAILWAY;
      delete env.PIVNIK_VERIFY_RAILWAY_ROLLBACK_TARGET;
      if (railwayFlag !== undefined) env.PIVNIK_VERIFY_RAILWAY = railwayFlag;
      if (githubFlag !== undefined) env.PIVNIK_VERIFY_GITHUB = githubFlag;
      if (rollbackTarget !== undefined)
        env.PIVNIK_VERIFY_RAILWAY_ROLLBACK_TARGET = rollbackTarget;
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

    // An optional rollback target must not bypass provider attestation,
    // choose a foreign service, or silently downgrade to offline mode.
    for (const [railwayFlag, target] of [
      [undefined, 'pivnik-bonus-app'],
      ['1', 'untrusted-service'],
      ['1', ''],
    ]) {
      const invalid = run(railwayFlag, undefined, target);
      assert.equal(invalid.status, 1, invalid.stderr);
      assert.match(invalid.stderr,
        /PIVNIK_VERIFY_RAILWAY_ROLLBACK_TARGET requires PIVNIK_VERIFY_RAILWAY=1/);
      assert.doesNotMatch(invalid.stdout, /Authenticated Railway historical rollback/);
    }
    for (const target of ['pivnik-bonus-app', 'vk-native-hosting', 'both']) {
      const noToken = run('1', undefined, target);
      assert.equal(noToken.status, 1, noToken.stderr);
      assert.match(noToken.stderr, /Railway API token is required/);
      assert.doesNotMatch(noToken.stdout, /Authenticated Railway historical rollback/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('current active VK deployment replacement is rejected after PIVNIK succeeds', async () => {
  const observedServices = [];
  const release = manifest();
  const activeLookup = async ({ projectId, environmentId, serviceId }) => {
    assert.equal(projectId, RAILWAY_RELEASE_PROJECT);
    assert.equal(environmentId, RAILWAY_RELEASE_ENVIRONMENT);
    observedServices.push(serviceId);
    if (serviceId === RAILWAY_RELEASE_TARGETS['pivnik-bonus-app']) {
      return { id: 'deployment-1', status: 'SUCCESS',
        serviceId, environmentId, meta: { commitHash: sha },
        createdAt: '2026-11-09T14:10:00Z' };
    }
    assert.equal(serviceId, RAILWAY_RELEASE_TARGETS['vk-native-hosting']);
    // The first service is still correct, but a subsequent VK release is live.
    // A PIVNIK-only active check must not accidentally accept the manifest.
    return { id: 'replacement-vk-deployment', status: 'SUCCESS' };
  };
  await assert.rejects(verifyCurrentRailwayDeployments(release, {
    lookupDeployment: lookup,
    lookupActiveDeployment: activeLookup,
  }), /current active Railway deployment identity does not match release manifest/);
  assert.deepEqual(observedServices, [
    RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
    RAILWAY_RELEASE_TARGETS['vk-native-hosting'],
  ]);
});

test('two-pass active readback rejects Railway deployment drift between service queries', async () => {
  const expected = [
    RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
    RAILWAY_RELEASE_TARGETS['vk-native-hosting'],
    RAILWAY_RELEASE_TARGETS['pivnik-bonus-app'],
    RAILWAY_RELEASE_TARGETS['vk-native-hosting'],
  ];
  for (const changedService of Object.values(RAILWAY_RELEASE_TARGETS)) {
    const observed = [];
    const activeLookup = async ({ projectId, environmentId, serviceId }) => {
      assert.equal(projectId, RAILWAY_RELEASE_PROJECT);
      assert.equal(environmentId, RAILWAY_RELEASE_ENVIRONMENT);
      observed.push(serviceId);
      const matchId = serviceId === RAILWAY_RELEASE_TARGETS['pivnik-bonus-app']
        ? 'deployment-1' : 'deployment-2';
      const secondSweep = observed.filter(id => id === serviceId).length === 2;
      return { id: secondSweep && serviceId === changedService
        ? 'replacement-during-attestation' : matchId, status: 'SUCCESS',
        serviceId, environmentId, meta: { commitHash: sha },
        createdAt: '2026-11-09T14:10:00Z' };
    };
    await assert.rejects(verifyCurrentRailwayDeployments(manifest(), {
      lookupDeployment: lookup, lookupActiveDeployment: activeLookup,
    }), /current active Railway deployment identity does not match release manifest/);
    assert.deepEqual(observed, expected.slice(0, changedService === expected[2] ? 3 : 4));
  }
});
