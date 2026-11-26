import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RAILWAY_PRODUCTION } from '../scripts/railway-production-config.mjs';

const source = readFileSync(new URL('../scripts/railway-deploy-and-verify-production.mjs', import.meta.url), 'utf8');
const body = source.replace("import { writeSync } from 'node:fs';\n", '')
  .replace("import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';\n", '');
assert.doesNotMatch(body, /^import /m);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('RAILWAY_PRODUCTION', 'process', 'fetch', 'console', 'writeSync', 'setTimeout', 'AbortSignal', 'Buffer', body);
const sha = 'a'.repeat(40);

async function scenario({ failDispatch = 0, failSnapshot = 0, emptySnapshot = 0, failJournal = '' } = {}) {
  const events = [], calls = [];
  let snapshots = 0, dispatches = 0, polls = 0, readiness = 0;
  const services = RAILWAY_PRODUCTION.services;
  const scopeName = id => id === services.telegram ? 'telegram' : id === services.vk ? 'vk' : assert.fail('foreign service');
  const type = { kind: 'SCALAR', name: 'String' };
  const ok = data => ({ ok: true, json: async () => ({ data }) });
  const fetch = async (url, options) => {
    if (url === 'https://backboard.railway.com/graphql/v2') {
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('DeployMutationSchema')) return ok({ __type: { fields: [{
        name: 'serviceInstanceDeployV2',
        args: ['serviceId', 'environmentId', 'commitSha'].map(name => ({ name, type })),
        type
      }] } });
      if (query.includes('RecentDeployments')) {
        const name = scopeName(variables.input.serviceId);
        assert.equal(variables.input.projectId, RAILWAY_PRODUCTION.projectId);
        assert.equal(variables.input.environmentId, RAILWAY_PRODUCTION.environmentId);
        if (!dispatches) {
          snapshots++;
          calls.push('snapshot:' + name);
          if (snapshots === failSnapshot) throw Error('snapshot failure');
          const nodes = snapshots === emptySnapshot ? [] : [
            { id: 'old-' + name, status: 'SUCCESS', createdAt: '2026-11-09T00:00:00Z' }
          ];
          return ok({ deployments: { edges: nodes.map(node => ({ node })) } });
        }
        polls++;
        return ok({ deployments: { edges: [{ node: { id: 'new-' + name, status: 'SUCCESS' } }] } });
      }
      if (query.includes('mutation DeployExactCommit')) {
        dispatches++;
        const name = scopeName(variables.serviceId);
        calls.push('mutation:' + name);
        assert.equal(variables.commitSha, sha);
        assert.equal(variables.environmentId, RAILWAY_PRODUCTION.environmentId);
        if (dispatches === failDispatch) return { ok: false, status: 503, json: async () => ({}) };
        return ok({ serviceInstanceDeployV2: 'new-' + name });
      }
      assert.fail('unexpected GraphQL operation');
    }
    assert.match(url, /^https:\/\/(?:telegram|vk)\.invalid\/api\/release-readiness$/);
    readiness++;
    return { ok: true, json: async () => ({
      ok: true, environment: 'production', databaseFingerprint: 'fixture', legalConfigured: true,
      identityTombstoneSecretConfigured: true, releaseCommit: sha, accountMode: 'separate',
      unifiedAccounts: false, linkCodes: false, termsVersion: 'fixture'
    }) };
  };
  const write = (fd, line) => {
    assert.equal(fd, 1);
    assert.ok(line.startsWith('PIVNIK_DISPATCH_JOURNAL '));
    const record = JSON.parse(line.slice('PIVNIK_DISPATCH_JOURNAL '.length));
    if (record.event + ':' + record.service === failJournal) return 0;
    assert.equal(record.releaseCommit, sha);
    assert.equal(record.environmentId, RAILWAY_PRODUCTION.environmentId);
    assert.equal(record.projectId, RAILWAY_PRODUCTION.projectId);
    events.push(record);
    calls.push(record.event + ':' + record.service);
    return Buffer.byteLength(line);
  };
  let error;
  try {
    await run(RAILWAY_PRODUCTION, { env: {
      RAILWAY_TOKEN: 'fixture-only', RELEASE_COMMIT_SHA: sha,
      TELEGRAM_SERVICE_VERIFY_URL: 'https://telegram.invalid',
      VK_SERVICE_VERIFY_URL: 'https://vk.invalid'
    } }, fetch, { log() {} }, write, () => assert.fail('unexpected retry'), { timeout: () => ({}) }, Buffer);
  } catch (e) { error = e; }
  return { events, calls, dispatches, polls, readiness, error };
}

test('first and second dispatch failures record ambiguous outcome and all known accepted IDs', async () => {
  for (const failDispatch of [1, 2]) {
    const result = await scenario({ failDispatch });
    assert.match(result.error?.message, /dispatch outcome unknown/);
    assert.equal(result.dispatches, failDispatch);
    assert.equal(result.polls, 0);
    assert.equal(result.readiness, 0);
    const last = result.events.at(-1);
    assert.equal(last.event, 'dispatch_outcome_unknown');
    assert.deepEqual(last.acceptedDeployments, failDispatch === 1 ? {} : { telegram: 'new-telegram' });
    if (failDispatch === 2) {
      assert.equal(result.events.find(e => e.event === 'dispatch_accepted').deploymentId, 'new-telegram');
      assert.ok(result.calls.indexOf('dispatch_accepted:telegram') < result.calls.indexOf('mutation:vk'));
    }
  }
});

test('both rollback candidate snapshots precede dispatch and success preserves both accepted IDs', async () => {
  const result = await scenario();
  assert.equal(result.error, undefined);
  assert.equal(result.dispatches, 2);
  assert.equal(result.polls, 2);
  assert.equal(result.readiness, 2);
  assert.deepEqual(result.events.slice(0, 2).map(x => [x.event, x.candidates[0].deploymentId]), [
    ['rollback_candidates_unverified', 'old-telegram'], ['rollback_candidates_unverified', 'old-vk']
  ]);
  assert.ok(result.calls.indexOf('rollback_candidates_unverified:vk') < result.calls.indexOf('mutation:telegram'));
  assert.deepEqual(result.events.at(-1).acceptedDeployments, { telegram: 'new-telegram', vk: 'new-vk' });
});

test('missing or inaccessible rollback candidates prevent every mutation', async () => {
  for (const options of [{ failSnapshot: 2 }, { emptySnapshot: 2 }]) {
    const result = await scenario(options);
    assert.ok(result.error);
    assert.equal(result.dispatches, 0);
  }
});

test('failed journal write stops before dispatch or further mutation', async () => {
  for (const [event, count] of [['dispatch_started:telegram', 0], ['dispatch_accepted:telegram', 1], ['dispatch_started:vk', 1]]) {
    const result = await scenario({ failJournal: event });
    assert.match(result.error?.message, /Incomplete dispatch journal write/);
    assert.equal(result.dispatches, count);
  }
});
