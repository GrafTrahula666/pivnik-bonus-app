import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { RAILWAY_PRODUCTION } from '../scripts/railway-production-config.mjs';

const source = readFileSync(new URL('../scripts/railway-deploy-and-verify-production.mjs', import.meta.url), 'utf8');
const body = source.replace("import { writeSync, appendFileSync } from 'node:fs';\n", '')
  .replace("import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';\n", '');
assert.doesNotMatch(body, /^import /m);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('RAILWAY_PRODUCTION', 'process', 'fetch', 'console', 'writeSync', 'appendFileSync', 'setTimeout', 'AbortSignal', 'Buffer', body);
const sha = 'a'.repeat(40);

async function scenario({ failDispatch = 0, failSnapshot = 0, emptySnapshot = 0, failJournal = '', journalPath = '', failPersist = '' } = {}) {
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
  const persist = (path, line, options) => {
    assert.equal(path, journalPath);
    assert.equal(options.flush, true);
    const record = JSON.parse(line);
    if (record.event + ':' + record.service === failPersist) throw Error('fixture disk write failure');
    appendFileSync(path, line, options);
  };
  let error;
  try {
    await run(RAILWAY_PRODUCTION, { env: {
      RAILWAY_TOKEN: 'fixture-only', RELEASE_COMMIT_SHA: sha,
      PIVNIK_DISPATCH_JOURNAL_PATH: journalPath,
      TELEGRAM_SERVICE_VERIFY_URL: 'https://telegram.invalid',
      VK_SERVICE_VERIFY_URL: 'https://vk.invalid'
    } }, fetch, { log() {} }, write, persist, () => assert.fail('unexpected retry'), { timeout: () => ({}) }, Buffer);
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


test('recovery JSONL survives second dispatch failure and contains only structured records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pivnik-dispatch-journal-'));
  try {
    const journalPath = join(dir, 'journal.jsonl');
    const result = await scenario({ failDispatch: 2, journalPath });
    assert.match(result.error?.message, /dispatch outcome unknown/);
    const raw = readFileSync(journalPath, 'utf8');
    const records = raw.trimEnd().split('\n').map(JSON.parse);
    assert.deepEqual(records, result.events);
    assert.deepEqual(records.at(-1).acceptedDeployments, { telegram: 'new-telegram' });
    assert.equal(records.at(-1).event, 'dispatch_outcome_unknown');
    assert.doesNotMatch(raw, /fixture-only|authorization|Project-Access-Token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed recovery file write prevents further mutations and preserves earlier records', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pivnik-dispatch-persist-'));
  try {
    const before = await scenario({ journalPath: join(dir, 'missing', 'journal.jsonl') });
    assert.ok(before.error);
    assert.equal(before.dispatches, 0);
    const journalPath = join(dir, 'journal.jsonl');
    const after = await scenario({ journalPath, failPersist: 'dispatch_started:vk' });
    assert.match(after.error?.message, /fixture disk write failure/);
    assert.equal(after.dispatches, 1);
    const records = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(JSON.parse);
    assert.equal(records.at(-1).event, 'dispatch_accepted');
    assert.equal(records.at(-1).deploymentId, 'new-telegram');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('workflow uploads recovery JSONL on ordinary deploy failure, never on skipped or cancelled deploy', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8');
  const deploy = workflow.split('      - name: Deploy exact commit and verify both production services\n')[1].split('\n      - name: Upload production dispatch recovery journal')[0];
  assert.match(deploy, /id: production_deploy/);
  assert.match(deploy, /umask 077/);
  assert.ok(deploy.includes('(set -o noclobber; : > "$PIVNIK_DISPATCH_JOURNAL_PATH")'));
  const upload = workflow.split('      - name: Upload production dispatch recovery journal\n')[1].split('\n      - name: ')[0];
  const expression = upload.split('if: ${{ ')[1].split(' }}')[0];
  for (const outcome of ['success', 'failure', 'skipped', 'cancelled', '']) {
    for (const cancelled of [false, true]) {
      assert.equal(runInNewContext(expression, { cancelled: () => cancelled, steps: { production_deploy: { outcome } } }),
        !cancelled && ['success', 'failure'].includes(outcome));
    }
  }
  const path = '${{ runner.temp }}/pivnik-dispatch-${{ github.run_id }}-${{ github.run_attempt }}.jsonl';
  assert.ok(deploy.includes('PIVNIK_DISPATCH_JOURNAL_PATH: ' + path));
  assert.ok(upload.includes('path: ' + path));
  assert.ok(upload.includes('name: production-dispatch-journal-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.sha }}'));
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 30/);
  assert.doesNotMatch(upload, /secrets\.|continue-on-error/);
});
