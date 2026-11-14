import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { validateReleaseEvidence, verifyGithubRuns } from '../scripts/validate-release-evidence.mjs';

const SHA = 'a'.repeat(40);
// GitHub PR reviews bind to the pre-merge head; production runs on the merge commit.
const REVIEWED_HEAD_SHA = 'd'.repeat(40);
const ROLLBACK_SHA = 'b'.repeat(40);
const REF = 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/12345';
const REVIEW_URL = 'https://github.com/GrafTrahula666/pivnik-bonus-app/pull/123#pullrequestreview-456';

function dispatchArtifactName({ runId = 12345, runAttempt = 1, releaseConfirm = 'DEPLOY_PIVNIK_PRODUCTION', releaseSha = SHA } = {}) {
  return `release-dispatch-${runId}-${runAttempt}-${releaseConfirm}-${releaseSha}`;
}

function dispatchPayload(overrides = {}) {
  return {
    schemaVersion: 1,
    repository: 'GrafTrahula666/pivnik-bonus-app',
    event: 'workflow_dispatch',
    runId: 12345,
    runAttempt: 1,
    sha: SHA,
    ref: 'refs/heads/main',
    releaseSha: SHA,
    releaseConfirm: 'DEPLOY_PIVNIK_PRODUCTION',
    ...overrides,
  };
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDispatchFile(content, filename = 'dispatch.json', method = 8) {
  const name = Buffer.from(filename, 'utf8');
  const compressed = method === 8 ? deflateRawSync(content) : Buffer.from(content);
  const crc = testCrc32(content);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

function dispatchArtifact(overrides = {}) {
  const {
    payload: payloadOverrides = {},
    archiveBytes: archiveOverride,
    zipName = 'dispatch.json',
    zipMethod = 8,
    ...metadataOverrides
  } = overrides;
  const payload = dispatchPayload(payloadOverrides);
  const content = Buffer.from(JSON.stringify(payload) + String.fromCharCode(10));
  const archive = archiveOverride ?? zipDispatchFile(content, zipName, zipMethod);
  const artifact = {
    id: 9001,
    name: dispatchArtifactName({
      runId: payload.runId,
      runAttempt: payload.runAttempt,
      releaseConfirm: payload.releaseConfirm,
      releaseSha: payload.releaseSha,
    }),
    size_in_bytes: archive.length,
    digest: 'sha256:' + createHash('sha256').update(archive).digest('hex'),
    archive_download_url: 'https://api.github.com/repos/GrafTrahula666/pivnik-bonus-app/actions/artifacts/9001/zip',
    expired: false,
    created_at: '2026-11-09T14:05:30Z',
    updated_at: '2026-11-09T14:05:30Z',
    workflow_run: {
      id: payload.runId, repository_id: 1304466389,
      head_branch: 'main', head_sha: payload.sha,
    },
    ...metadataOverrides,
  };
  Object.defineProperty(artifact, 'archiveBytes', { value: archive });
  return artifact;
}

function valid() {
  return {
    schemaVersion: 1,
    releaseSha: SHA,
    createdAt: '2026-11-09T15:00:00Z',
    approval: { actor: 'independent-release-reviewer', prNumber: 123, sha: SHA, at: '2026-11-09T14:00:00Z', evidenceUrl: REVIEW_URL },
    checks: [
      { name: 'Pivnik release gate', sha: SHA, runId: 12345, required: true,
        conclusion: 'success', event: 'workflow_dispatch', evidenceUrl: REF,
        releaseConfirm: 'DEPLOY_PIVNIK_PRODUCTION', runAttempt: 1,
        completedAt: '2026-11-09T14:50:00Z',
        productionSteps: {
          'Deploy exact commit and verify both production services': 'success',
          'Probe production documents and public endpoints': 'success',
          'Verify separate Telegram and VK production accounts': 'success',
          'Verify signed Telegram and VK production sessions': 'success',
        } },
      { name: 'VK native hosting main parity', sha: SHA, runId: 12346, required: true,
        conclusion: 'success', event: 'push', evidenceUrl: REF.replace('/12345', '/12346') },
    ],
    artifacts: [{ name: 'release-bundle', sha: SHA, sha256: 'c'.repeat(64), evidenceUrl: REF }],
    deployments: [
      { target: 'pivnik-bonus-app', sha: SHA, environment: 'production',
        deploymentId: 'deployment-1', deployedAt: '2026-11-09T14:15:00Z',
        status: 'success', evidenceUrl: REF },
      { target: 'vk-native-hosting', sha: SHA, environment: 'production',
        deploymentId: 'deployment-2', deployedAt: '2026-11-09T14:20:00Z',
        status: 'success', evidenceUrl: REF },
    ],
    smoke: [
      { target: 'pivnik-bonus-app', sha: SHA, at: '2026-11-09T14:40:00Z',
        result: 'passed', evidenceUrl: REF },
      { target: 'vk-native-hosting', sha: SHA, at: '2026-11-09T14:42:00Z',
        result: 'passed', evidenceUrl: REF },
    ],
    rollback: { sha: ROLLBACK_SHA, deploymentId: 'known-good-previous',
      verifiedAt: '2026-11-09T13:50:00Z', evidenceUrl: REF },
  };
}

const deny = (data, reason) => assert.throws(() => validateReleaseEvidence(data), reason);

test('full exact-SHA manifest format is accepted without accessing external systems', () => {
  assert.deepEqual(validateReleaseEvidence(valid()),
    { releaseSha: SHA, checks: 2, targets: 2, artifacts: 1 });
});

test('missing, malformed or stale SHA evidence is rejected', () => {
  for (const field of ['releaseSha', 'checks', 'artifacts', 'deployments', 'smoke']) {
    const data = valid();
    if (field === 'releaseSha') data.releaseSha = 'main';
    if (field === 'checks') data.checks[0].sha = ROLLBACK_SHA;
    if (field === 'artifacts') data.artifacts[0].sha = ROLLBACK_SHA;
    if (field === 'deployments') data.deployments[0].sha = ROLLBACK_SHA;
    if (field === 'smoke') data.smoke[0].sha = ROLLBACK_SHA;
    deny(data);
  }
});

test('approval must explicitly name the same exact commit SHA', () => {
  const otherCommit = valid();
  otherCommit.approval.sha = ROLLBACK_SHA;
  deny(otherCommit, /approval SHA mismatch/);

  const noCommit = valid();
  delete noCommit.approval.sha;
  deny(noCommit, /approval SHA mismatch/);

  const branchName = valid();
  branchName.approval.sha = 'main';
  deny(branchName, /approval SHA mismatch/);

  const upperCase = valid();
  upperCase.approval.sha = SHA.toUpperCase();
  assert.equal(validateReleaseEvidence(upperCase).releaseSha, SHA);
});

test('common release gate must be approved and successful on manual dispatch', () => {
  for (const change of [
    check => { check.event = 'push'; },
    check => { check.required = false; },
    check => { check.conclusion = 'skipped'; },
    check => { check.name = 'Some other workflow'; },
    check => { check.conclusion = 'failure'; },
    check => { check.runId = 0; },
    check => { check.evidenceUrl = 'http://not-https.example'; },
  ]) {
    const data = valid(); change(data.checks[0]); deny(data);
  }
});

test('check evidence URL must reference the exact GitHub Actions run, not another run or website', () => {
  for (const url of [
    REF.replace('/12345', '/99999'),
    'https://example.com/actions/runs/12345',
    'https://github.com/Other/Repository/actions/runs/12345',
    REF + '?unverified=true',
    REF + '#wrong-attempt',
  ]) {
    const data = valid();
    data.checks[0].evidenceUrl = url;
    deny(data, /check evidenceUrl must point to its exact GitHub Actions runId/);
  }
  assert.equal(validateReleaseEvidence(valid()).checks, 2);
});

test('unrelated workflow cannot be smuggled in as a mandatory successful check', () => {
  const fake = valid();
  fake.checks.push({ name: 'Unrelated green workflow', sha: SHA, runId: 98765,
    required: true, conclusion: 'success', event: 'push',
    evidenceUrl: REF.replace('/12345', '/98765') });
  deny(fake, /unknown workflow cannot be marked as a required release check/);
  fake.checks[2].required = false;
  assert.equal(validateReleaseEvidence(fake).checks, 3);
});

test('distinct required checks cannot claim the same GitHub workflow run as independent evidence', () => {
  const reused = valid();
  reused.checks[1].runId = reused.checks[0].runId;
  reused.checks[1].evidenceUrl = reused.checks[0].evidenceUrl;
  deny(reused, /check runIds must be unique/);

  const distinct = valid();
  assert.equal(validateReleaseEvidence(distinct).checks, 2);
});

test('green CANCEL dispatch or skipped production steps cannot authorize release', () => {
  for (const mutate of [
    gate => { delete gate.releaseConfirm; },
    gate => { gate.releaseConfirm = 'CANCEL'; },
    gate => { gate.runAttempt = 0; },
    gate => { delete gate.productionSteps; },
    gate => { gate.productionSteps['Deploy exact commit and verify both production services'] = 'skipped'; },
    gate => { gate.productionSteps['Probe production documents and public endpoints'] = 'skipped'; },
    gate => { gate.productionSteps['Verify separate Telegram and VK production accounts'] = 'failure'; },
    gate => { gate.productionSteps['Verify signed Telegram and VK production sessions'] = 'skipped'; },
  ]) {
    const data = valid();
    mutate(data.checks[0]);
    deny(data);
  }
});

test('production step evidence cannot contain substituted or extra step names', () => {
  const extra = valid();
  extra.checks[0].productionSteps['Unrelated successful step'] = 'success';
  deny(extra, /productionSteps must contain exactly the mandatory release workflow steps/);

  const substituted = valid();
  delete substituted.checks[0].productionSteps['Verify signed Telegram and VK production sessions'];
  substituted.checks[0].productionSteps['Unrelated successful step'] = 'success';
  deny(substituted, /productionSteps must contain exactly the mandatory release workflow steps/);

  assert.equal(validateReleaseEvidence(valid()).releaseSha, SHA);
});

test('in-workflow production deployment must precede completed gate and manifest', () => {
  const missing = valid();
  delete missing.checks[0].completedAt;
  deny(missing, /common release gate requires valid UTC completedAt/);

  const prematureGate = valid();
  prematureGate.checks[0].completedAt = '2026-11-09T14:10:00Z';
  deny(prematureGate, /release gate cannot finish before its production deployment/);

  const prematureManifest = valid();
  prematureManifest.createdAt = '2026-11-09T14:45:00Z';
  deny(prematureManifest, /manifest cannot precede completed release gate/);

  const smokeAfterGate = valid();
  smokeAfterGate.smoke[0].at = '2026-11-09T14:55:00Z';
  deny(smokeAfterGate, /release gate cannot finish before its production smoke/);

  const boundary = valid();
  boundary.checks[0].completedAt = boundary.createdAt;
  assert.equal(validateReleaseEvidence(boundary).releaseSha, SHA);
});

test('optional skips require explicit reason; required checks can never skip', () => {
  const ok = valid();
  ok.checks.push({ name: 'Optional UI check', sha: SHA, runId: 456,
    required: false, conclusion: 'skipped', skipReason: 'Out of scope', evidenceUrl: REF.replace('/12345', '/456') });
  assert.equal(validateReleaseEvidence(ok).checks, 3);
  const missingReason = structuredClone(ok);
  delete missingReason.checks[2].skipReason;
  deny(missingReason);
  const requiredSkip = structuredClone(ok);
  requiredSkip.checks[2].required = true;
  deny(requiredSkip);
});

test('VK production hosting requires same-SHA successful VK parity evidence', () => {
  const data = valid(); data.checks.splice(1, 1); deny(data);
  const failed = valid(); failed.checks[1].conclusion = 'skipped'; deny(failed);
});

test('VK parity must be a required successful main push check even in offline manifests', () => {
  for (const mutate of [
    check => { check.event = 'pull_request'; },
    check => { check.event = 'workflow_dispatch'; },
    check => { delete check.event; },
    check => { check.required = false; },
    check => { check.conclusion = 'skipped'; check.skipReason = 'not run'; },
  ]) {
    const data = valid();
    mutate(data.checks[1]);
    deny(data, /VK main parity must be a required successful push check|required checks cannot be skipped/);
  }
  assert.equal(validateReleaseEvidence(valid()).checks, 2);
});

test('artifact hashes and approval evidence are mandatory', () => {
  const missingArtifact = valid(); missingArtifact.artifacts = []; deny(missingArtifact);
  const weakHash = valid(); weakHash.artifacts[0].sha256 = 'sha256:missing'; deny(weakHash);
  const approval = valid(); approval.approval.actor = ''; deny(approval);
  const timestamp = valid(); timestamp.approval.at = 'tomorrow'; deny(timestamp);
  const duplicateCheck = valid(); duplicateCheck.checks[1].name = duplicateCheck.checks[0].name; deny(duplicateCheck);
});

test('duplicate artifact names are rejected even with distinct hashes', () => {
  const duplicated = valid();
  duplicated.artifacts.push({
    name: 'release-bundle', sha: SHA, sha256: 'd'.repeat(64), evidenceUrl: REF,
  });
  deny(duplicated, /artifact names must be unique/);

  const distinct = valid();
  distinct.artifacts.push({
    name: 'vk-bundle', sha: SHA, sha256: 'd'.repeat(64), evidenceUrl: REF,
  });
  assert.equal(validateReleaseEvidence(distinct).artifacts, 2);
});

test('unrelated deployments cannot substitute for the mandatory PIVNIK production service', () => {
  const renamed = valid();
  renamed.deployments[0].target = 'unrelated-service';
  renamed.smoke[0].target = 'unrelated-service';
  deny(renamed, /unexpected production deployment target/);

  const onlyVk = valid();
  onlyVk.deployments.shift();
  onlyVk.smoke.shift();
  deny(onlyVk, /pivnik-bonus-app production deployment is mandatory/);

  assert.equal(validateReleaseEvidence(valid()).targets, 2);
});

test('common gate requires both PIVNIK and VK production targets with smoke', () => {
  const missingVk = valid();
  missingVk.deployments.pop();
  missingVk.smoke.pop();
  deny(missingVk, /vk-native-hosting production deployment is mandatory/);

  const renamedVk = valid();
  renamedVk.deployments[1].target = 'unrelated-service';
  renamedVk.smoke[1].target = 'unrelated-service';
  deny(renamedVk, /unexpected production deployment target/);

  assert.equal(validateReleaseEvidence(valid()).targets, 2);
});

test('unrelated third production target cannot be smuggled into approved release evidence', () => {
  const data = valid();
  data.deployments.push({
    target: 'unrelated-production-service', sha: SHA, environment: 'production',
    deploymentId: 'deployment-3', deployedAt: '2026-11-09T14:25:00Z',
    status: 'success', evidenceUrl: REF,
  });
  data.smoke.push({
    target: 'unrelated-production-service', sha: SHA, at: '2026-11-09T14:43:00Z',
    result: 'passed', evidenceUrl: REF,
  });
  deny(data, /unexpected production deployment target/);
});

test('distinct production targets cannot reuse the same deployment ID', () => {
  const reused = valid();
  reused.deployments[1].deploymentId = reused.deployments[0].deploymentId;
  deny(reused, /production deployment IDs must be unique across targets/);

  const distinct = valid();
  assert.equal(validateReleaseEvidence(distinct).targets, 2);
});

test('each successful deployment must be matched by subsequent passing smoke', () => {
  const missingSmoke = valid(); missingSmoke.smoke.pop(); deny(missingSmoke);
  const wrongTarget = valid(); wrongTarget.smoke[0].target = 'admin'; deny(wrongTarget);
  const failed = valid(); failed.smoke[1].result = 'skipped'; deny(failed);
  const early = valid(); early.smoke[1].at = '2026-11-09T13:00:00Z'; deny(early);
  const earlyApproval = valid(); earlyApproval.deployments[0].deployedAt = '2026-11-09T12:00:00Z'; deny(earlyApproval);
  const staleManifest = valid(); staleManifest.createdAt = '2026-11-09T14:00:00Z'; deny(staleManifest);
  const dup = valid(); dup.deployments[1].target = dup.deployments[0].target; deny(dup);
});

test('rollback deployment ID cannot alias a current production deployment', () => {
  for (const deployment of valid().deployments) {
    const reused = valid();
    reused.rollback.deploymentId = deployment.deploymentId;
    deny(reused, /rollback deployment ID must differ from current production deployments/);
  }
  assert.equal(validateReleaseEvidence(valid()).targets, 2);
});

test('rollback must reference distinct known-good SHA and review evidence', () => {
  const same = valid(); same.rollback.sha = SHA; deny(same);
  const missing = valid(); delete missing.rollback.deploymentId; deny(missing);
  const unknown = valid(); unknown.rollback.evidenceUrl = ''; deny(unknown);
  const noRollback = valid(); delete noRollback.rollback; deny(noRollback);
});

test('release manifest cannot predate approval and rollback must be ready before approval', () => {
  const premature = valid();
  premature.createdAt = '2026-11-09T13:59:59Z';
  deny(premature, /manifest cannot be created before release approval/);

  const lateRollback = valid();
  lateRollback.rollback.verifiedAt = '2026-11-09T14:01:00Z';
  deny(lateRollback, /known-good rollback must be verified before release approval/);

  const boundary = valid();
  boundary.rollback.verifiedAt = boundary.approval.at;
  assert.equal(validateReleaseEvidence(boundary).releaseSha, SHA);
});

test('CLI fails closed for invalid JSON and invalid evidence, and accepts formatted evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pivnik-release-evidence-'));
  const file = join(dir, 'manifest.json');
  const script = fileURLToPath(new URL('../scripts/validate-release-evidence.mjs', import.meta.url));
  try {
    await writeFile(file, JSON.stringify(valid()));
    const output = execFileSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.match(output, /Release evidence format valid/);
    assert.match(output, /does not verify external approval/);

    // Opt-in authenticated mode must not silently downgrade to offline checks.
    const authenticated = spawnSync(process.execPath, [script, file], {
      env: { ...process.env, PIVNIK_VERIFY_GITHUB: '1', GITHUB_TOKEN: '' },
      encoding: 'utf8',
    });
    assert.notEqual(authenticated.status, 0);
    assert.match(authenticated.stderr, /authenticated GitHub API access is required/);

    const wrong = valid(); wrong.deployments[0].sha = ROLLBACK_SHA;
    await writeFile(file, JSON.stringify(wrong));
    assert.notEqual(spawnSync(process.execPath, [script, file]).status, 0);
    await writeFile(file, '{not-json');
    assert.notEqual(spawnSync(process.execPath, [script, file]).status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('authenticated GitHub read verifies required exact-SHA runs and rejects stale or failed runs', async () => {
  const calls = [];
  const artifact = dispatchArtifact();
  const responseFor = (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/actions/artifacts/9001/zip')) return {
      ok: true, arrayBuffer: async () => artifact.archiveBytes,
    };
    if (url.endsWith('/pulls/123')) return { ok: true, json: async () => ({
      number: 123, base: { ref: 'main' }, head: { sha: REVIEWED_HEAD_SHA }, merge_commit_sha: SHA,
      merged_at: '2026-11-09T14:02:00Z',
      user: { login: 'author' }, state: 'closed', merged: true,
    }) };
    if (url.endsWith('/collaborators/independent-release-reviewer/permission'))
      return { ok: true, json: async () => ({ permission: 'write', user: { login: 'independent-release-reviewer' } }) };
    if (url.endsWith('/pulls/123/reviews?per_page=100')) return { ok: true, json: async () => [
      { user: { login: 'independent-release-reviewer' }, state: 'APPROVED',
        id: 456, html_url: REVIEW_URL,
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:00:00Z' },
    ] };
    if (url.endsWith('/12345/artifacts?per_page=100')) {
      return { ok: true, json: async () => ({ total_count: 1, artifacts: [artifact] }) };
    }
    if (url.endsWith('/12345/jobs?per_page=100')) {
      return { ok: true, json: async () => ({
        total_count: 1,
        jobs: [{ run_id: 12345, run_attempt: 1, status: 'completed', conclusion: 'success',
          completed_at: '2026-11-09T14:45:00Z', steps: Object.keys(valid().checks[0].productionSteps).map(name =>
            ({ name, status: 'completed', conclusion: 'success' })) }],
      }) };
    }
    const id = Number(url.split('/').at(-1));
    return { ok: true, json: async () => ({
      id, head_sha: SHA, head_branch: 'main', status: 'completed', conclusion: 'success',
      event: id === 12345 ? 'workflow_dispatch' : 'push',
      created_at: '2026-11-09T14:05:00Z', updated_at: '2026-11-09T14:50:00Z',
      run_attempt: 1, path: id === 12345 ? '.github/workflows/release-gate.yml' : '.github/workflows/vk-native-hosting-main-parity.yml',
      html_url: 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/' + id,
      repository: { full_name: 'GrafTrahula666/pivnik-bonus-app' },
    }) };
  };
  const options = { token: 'test-token', fetchImpl: async (...args) => responseFor(...args) };
  assert.deepEqual(await verifyGithubRuns(valid(), options), { verifiedRunIds: [12345, 12346] });
  const unrelatedVkFetch = async (url, opts) => {
    const result = responseFor(url, opts);
    if (!url.endsWith('/actions/runs/12346')) return result;
    const original = result.json;
    return { ...result, json: async () => ({
      ...await original(), path: '.github/workflows/unrelated-success.yml',
    }) };
  };
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: unrelatedVkFetch,
  }), /GitHub VK parity workflow identity mismatch/);
  assert.equal(calls.length, 16); // two full passes include reviewer permission and authenticated ZIP verification
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  const archiveCall = calls.find(call => call.url.endsWith('/actions/artifacts/9001/zip'));
  assert.equal(archiveCall.options.redirect, 'follow');

  // The run endpoint may omit inputs. The exact run-scoped artifact is the
  // trusted workflow's durable record of confirmation, SHA and attempt.
  const artifactCases = [
    { label: 'missing', total: 0, artifacts: [] },
    { label: 'CANCEL', artifacts: [dispatchArtifact({ name: dispatchArtifactName({ releaseConfirm: 'CANCEL' }) })] },
    { label: 'wrong SHA', artifacts: [dispatchArtifact({ name: dispatchArtifactName({ releaseSha: ROLLBACK_SHA }) })] },
    { label: 'wrong attempt', artifacts: [dispatchArtifact({ name: dispatchArtifactName({ runAttempt: 2 }) })] },
    { label: 'wrong run', artifacts: [dispatchArtifact({ workflow_run: { ...dispatchArtifact().workflow_run, id: 99999 } })] },
    { label: 'wrong repository', artifacts: [dispatchArtifact({ workflow_run: { ...dispatchArtifact().workflow_run, repository_id: 999 } })] },
    { label: 'wrong branch', artifacts: [dispatchArtifact({ workflow_run: { ...dispatchArtifact().workflow_run, head_branch: 'release' } })] },
    { label: 'wrong SHA metadata', artifacts: [dispatchArtifact({ workflow_run: { ...dispatchArtifact().workflow_run, head_sha: ROLLBACK_SHA } })] },
    { label: 'expired', artifacts: [dispatchArtifact({ expired: true })] },
    { label: 'empty artifact', artifacts: [dispatchArtifact({ size_in_bytes: 0 })] },
    { label: 'incomplete listing', total: 2, artifacts: [dispatchArtifact()] },
    { label: 'artifact predates run', artifacts: [dispatchArtifact({ created_at: '2026-11-09T14:04:59Z' })] },
  ];
  for (const scenario of artifactCases) {
    const untrustedDispatch = async (url, opts) => {
      const result = responseFor(url, opts);
      if (!url.endsWith('/12345/artifacts?per_page=100')) return result;
      return { ...result, json: async () => ({
        total_count: scenario.total ?? scenario.artifacts.length, artifacts: scenario.artifacts,
      }) };
    };
    await assert.rejects(
      verifyGithubRuns(valid(), { token: 'test-token', fetchImpl: untrustedDispatch }),
      /GitHub (dispatch artifact listing incomplete|original production dispatch attestation artifact (missing or mismatched|identity or chronology mismatch))/,
      scenario.label,
    );
  }
  const failedArtifactLookup = async (url, opts) => {
    if (url.endsWith('/12345/artifacts?per_page=100')) return { ok: false, status: 403 };
    return responseFor(url, opts);
  };
  await assert.rejects(verifyGithubRuns(valid(), { token: 'test-token', fetchImpl: failedArtifactLookup }),
    /GitHub dispatch artifact lookup failed/);

  const storedArtifact = dispatchArtifact({ zipMethod: 0 });
  const storedFetch = async (url, opts) => {
    const result = responseFor(url, opts);
    if (url.endsWith('/12345/artifacts?per_page=100'))
      return { ...result, json: async () => ({ total_count: 1, artifacts: [storedArtifact] }) };
    if (url.endsWith('/actions/artifacts/9001/zip'))
      return { ok: true, arrayBuffer: async () => storedArtifact.archiveBytes };
    return result;
  };
  assert.deepEqual(await verifyGithubRuns(valid(), { token: 'test-token', fetchImpl: storedFetch }),
    { verifiedRunIds: [12345, 12346] }, 'stored ZIP compression remains supported');

  // Local ZIP metadata must agree with the central directory when the
  // data-descriptor flag is absent. The archive digest is recalculated, so
  // this tests ZIP validation rather than merely detecting a bad hash.
  const mismatchedLocalHeader = (offset, value) => {
    const bytes = Buffer.from(dispatchArtifact().archiveBytes);
    bytes.writeUInt32LE(value, offset);
    return dispatchArtifact({ archiveBytes: bytes });
  };
  // Even with a freshly recomputed artifact digest, a ZIP must not hide
  // bytes before its local header or between its payload and central directory.
  const paddedZip = (prefix) => {
    const original = Buffer.from(dispatchArtifact().archiveBytes);
    const end = original.length - 22;
    const centralStart = original.readUInt32LE(end + 16);
    const padding = Buffer.from([0x50, 0x41, 0x44]);
    const bytes = prefix
      ? Buffer.concat([padding, original])
      : Buffer.concat([original.subarray(0, centralStart), padding, original.subarray(centralStart)]);
    const shiftedCentral = centralStart + padding.length;
    const shiftedEnd = end + padding.length;
    bytes.writeUInt32LE(shiftedCentral, shiftedEnd + 16);
    if (prefix) bytes.writeUInt32LE(padding.length, shiftedCentral + 42);
    return dispatchArtifact({ archiveBytes: bytes });
  };
  const forgedArtifacts = [
    ['prefixed ZIP data', paddedZip(true), /dispatch artifact ZIP local header is invalid/],
    ['unaccounted ZIP payload gap', paddedZip(false), /dispatch artifact ZIP payload bounds are invalid/],
    ['local CRC disagrees with central directory', mismatchedLocalHeader(14, 0),
      /dispatch artifact ZIP local and central headers disagree/],
    ['local compressed size disagrees with central directory', mismatchedLocalHeader(18, 0),
      /dispatch artifact ZIP local and central headers disagree/],
    ['local uncompressed size disagrees with central directory', mismatchedLocalHeader(22, 0),
      /dispatch artifact ZIP local and central headers disagree/],
    ['forged confirmation', dispatchArtifact({
      payload: { releaseConfirm: 'CANCEL' }, name: dispatchArtifactName(),
    }), /dispatch artifact content does not match/],
    ['wrong ref', dispatchArtifact({
      payload: { ref: 'refs/heads/release' }, name: dispatchArtifactName(),
    }), /dispatch artifact content does not match/],
    ['digest mismatch', dispatchArtifact({ digest: 'sha256:' + '0'.repeat(64) }),
      /dispatch artifact archive SHA-256 mismatch/],
    ['unsafe entry path', dispatchArtifact({ zipName: '../dispatch.json' }),
      /dispatch artifact ZIP entry must be dispatch.json/],
    ['corrupt ZIP', dispatchArtifact({ archiveBytes: Buffer.alloc(32, 0) }),
      /dispatch artifact ZIP end record missing/],
  ];
  for (const [label, forgedArtifact, expectedError] of forgedArtifacts) {
    const forgedFetch = async (url, opts) => {
      const result = responseFor(url, opts);
      if (url.endsWith('/12345/artifacts?per_page=100'))
        return { ...result, json: async () => ({ total_count: 1, artifacts: [forgedArtifact] }) };
      if (url.endsWith('/actions/artifacts/9001/zip'))
        return { ok: true, arrayBuffer: async () => forgedArtifact.archiveBytes };
      return result;
    };
    await assert.rejects(
      verifyGithubRuns(valid(), { token: 'test-token', fetchImpl: forgedFetch }),
      expectedError, label,
    );
  }

  // A non-binding review by an outsider must not authorize production release.
  for (const [permission, allowed] of [
    ['read', false], ['triage', false], ['none', false],
    ['write', true], ['maintain', true], ['admin', true],
  ]) {
    const permissionFetch = async (url, opts) => {
      const result = responseFor(url, opts);
      if (!url.endsWith('/collaborators/independent-release-reviewer/permission')) return result;
      return { ...result, json: async () => ({ permission, user: { login: 'independent-release-reviewer' } }) };
    };
    if (allowed) assert.deepEqual(await verifyGithubRuns(valid(), {
      token: 'test-token', fetchImpl: permissionFetch,
    }), { verifiedRunIds: [12345, 12346] });
    else await assert.rejects(verifyGithubRuns(valid(), {
      token: 'test-token', fetchImpl: permissionFetch,
    }), /GitHub independent reviewer lacks verified write permission/);
  }
  for (const failedPermission of [
    { ok: false, status: 403 },
    { ok: false, status: 404 },
  ]) {
    const failPermissionFetch = async (url, opts) =>
      url.endsWith('/collaborators/independent-release-reviewer/permission')
        ? failedPermission : responseFor(url, opts);
    await assert.rejects(verifyGithubRuns(valid(), {
      token: 'test-token', fetchImpl: failPermissionFetch,
    }), /GitHub independent reviewer permission lookup failed/);
  }
  const mismatchedReviewer = async (url, opts) =>
    url.endsWith('/collaborators/independent-release-reviewer/permission')
      ? { ok: true, json: async () => ({ permission: 'admin', user: { login: 'outsider' } }) }
      : responseFor(url, opts);
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: mismatchedReviewer,
  }), /GitHub independent reviewer lacks verified write permission/);

  // A PR merged after dispatch cannot authorize that earlier production run.
  const lateMergeFetch = async (url, opts) => {
    const result = responseFor(url, opts);
    if (!url.endsWith('/pulls/123')) return result;
    const original = result.json;
    return { ...result, json: async () => ({
      ...await original(), merged_at: '2026-11-09T14:06:00Z',
    }) };
  };
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: lateMergeFetch,
  }), /GitHub release gate dispatch chronology mismatch/);
  // A dismissed approval must never be accepted as independent authorization.
  const dismissedApprovalFetch = async (url, opts) => {
    const result = responseFor(url, opts);
    if (!url.endsWith('/pulls/123/reviews?per_page=100')) return result;
    const original = result.json;
    return { ...result, json: async () => (await original()).map(review => ({
      ...review, state: 'DISMISSED',
    })) };
  };
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: dismissedApprovalFetch,
  }), /GitHub independent exact-SHA approval missing, stale or dismissed/);
  // A second reviewer with an unresolved change request must block release.
  const blockingReviewFetch = async (url, opts) => {
    const result = responseFor(url, opts);
    if (!url.endsWith('/pulls/123/reviews?per_page=100')) return result;
    const original = result.json;
    return { ...result, json: async () => [...await original(),
      { user: { login: 'security-reviewer' }, state: 'CHANGES_REQUESTED',
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:01:00Z' }] };
  };
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: blockingReviewFetch,
  }), /GitHub outstanding change request/);
  // A COMMENTED review is not a dismissal of a previous change request.
  const commentedAfterBlock = async (url, opts) => {
    const result = await blockingReviewFetch(url, opts);
    if (!url.endsWith('/pulls/123/reviews?per_page=100')) return result;
    const original = result.json;
    return { ...result, json: async () => [...await original(),
      { user: { login: 'security-reviewer' }, state: 'COMMENTED',
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:03:00Z' }] };
  };
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: commentedAfterBlock,
  }), /GitHub outstanding change request/);
  // A later approval by that same reviewer resolves their earlier objection.
  const resolvedReviewFetch = async (url, opts) => {
    const result = await blockingReviewFetch(url, opts);
    if (!url.endsWith('/pulls/123/reviews?per_page=100')) return result;
    const original = result.json;
    return { ...result, json: async () => [...await original(),
      { user: { login: 'security-reviewer' }, state: 'APPROVED',
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:03:00Z' }] };
  };
  assert.deepEqual(await verifyGithubRuns(valid(), {
    token: 'test-token', fetchImpl: resolvedReviewFetch,
  }), { verifiedRunIds: [12345, 12346] });
  await assert.rejects(verifyGithubRuns(valid()), /authenticated GitHub API access is required/);
  for (const patch of [
    { head_sha: ROLLBACK_SHA },
    { head_branch: 'unreviewed-feature-branch' },
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { run_attempt: 2 },
    { created_at: '2026-11-09T13:59:59Z' },
    { created_at: '2026-11-09T14:51:00Z' },
    { created_at: null },
    { path: '.github/workflows/unrelated.yml' },
    { repository: { full_name: 'someone/else' } },
    { html_url: 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/99999' },
  ]) {
    const badFetch = async (url, opts) => {
      const result = responseFor(url, opts);
      if (!url.endsWith('/actions/runs/12345')) return result;
      const original = result.json;
      return { ...result, json: async () => ({ ...await original(), ...patch }) };
    };
    await assert.rejects(verifyGithubRuns(valid(), { token: 'test-token', fetchImpl: badFetch }),
      /GitHub (.* mismatch|original production dispatch confirmation unavailable or mismatched)/);
  }
  await assert.rejects(verifyGithubRuns(valid(), {
    token: 'test-token',
    fetchImpl: async (url, opts) => url.includes('/actions/runs/')
      ? { ok: false } : responseFor(url, opts),
  }), /GitHub run API lookup failed/);
});

test('GitHub Jobs API must prove all mandatory production steps completed successfully', async () => {
  const makeFetch = ({ stepConclusion = 'success', jobConclusion = 'success',
    totalCount = 1, omitStep = false, failJobs = false, duplicateStep = false, jobAttempt = 1,
    jobStatus = 'completed', stepStatus = 'completed', jobRunId = 12345,
    jobCompletedAt = '2026-11-09T14:45:00Z', artifacts = [dispatchArtifact()],
    artifactTotalCount = artifacts.length, failArtifacts = false } = {}) => async url => {
    if (url.endsWith('/pulls/123')) return { ok: true, json: async () => ({
      number: 123, base: { ref: 'main' }, head: { sha: REVIEWED_HEAD_SHA }, merge_commit_sha: SHA,
      merged_at: '2026-11-09T14:02:00Z',
      user: { login: 'author' }, state: 'closed', merged: true,
    }) };
    if (url.endsWith('/collaborators/independent-release-reviewer/permission'))
      return { ok: true, json: async () => ({ permission: 'write', user: { login: 'independent-release-reviewer' } }) };
    if (url.endsWith('/pulls/123/reviews?per_page=100')) return { ok: true, json: async () => [
      { user: { login: 'independent-release-reviewer' }, state: 'APPROVED',
        id: 456, html_url: REVIEW_URL,
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:00:00Z' },
    ] };
    if (url.endsWith('/12345/artifacts?per_page=100')) {
      if (failArtifacts) return { ok: false, status: 403 };
      return { ok: true, json: async () => ({ total_count: artifactTotalCount, artifacts }) };
    }
    if (url.endsWith('/actions/artifacts/9001/zip')) return {
      ok: true, arrayBuffer: async () => artifacts[0]?.archiveBytes,
    };
    if (url.includes('/jobs?')) {
      if (failJobs) return { ok: false };
      const names = Object.keys(valid().checks[0].productionSteps);
      return { ok: true, json: async () => ({
        total_count: totalCount,
        jobs: [{ run_id: jobRunId, run_attempt: jobAttempt, status: jobStatus,
          conclusion: jobConclusion, completed_at: jobCompletedAt, steps: [...names.slice(omitStep ? 1 : 0).map((name, i) => ({
            name, status: stepStatus, conclusion: i === 0 ? stepConclusion : 'success',
          })), ...(duplicateStep ? [{ name: names[0], status: 'completed', conclusion: 'success' }] : [])] }],
      }) };
    }
    const id = Number(url.split('/').at(-1));
    return { ok: true, json: async () => ({
      id, head_sha: SHA, head_branch: 'main', status: 'completed', conclusion: 'success',
      event: id === 12345 ? 'workflow_dispatch' : 'push',
      created_at: '2026-11-09T14:05:00Z', updated_at: '2026-11-09T14:50:00Z',
      run_attempt: 1, path: id === 12345 ? '.github/workflows/release-gate.yml' : '.github/workflows/vk-native-hosting-main-parity.yml',
      html_url: 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/' + id,
      repository: { full_name: 'GrafTrahula666/pivnik-bonus-app' },
    }) };
  };
  const opts = fetchImpl => ({ fetchImpl, token: 'test-token' });
  assert.deepEqual(await verifyGithubRuns(valid(), opts(makeFetch())),
    { verifiedRunIds: [12345, 12346] });
  for (const changed of [
    { stepConclusion: 'skipped' }, { stepConclusion: 'failure' },
    { jobConclusion: 'failure' }, { jobStatus: 'in_progress' },
    { stepStatus: 'in_progress' }, { omitStep: true }, { totalCount: 2 },
    { jobAttempt: null }, { jobAttempt: 2 }, { jobRunId: 12346 },
    { duplicateStep: true },
    { jobCompletedAt: null },
    { jobCompletedAt: '2026-11-09T14:55:00Z' },
    { jobCompletedAt: '2026-11-09T14:04:00Z' },
  ]) {
    await assert.rejects(verifyGithubRuns(valid(), opts(makeFetch(changed))),
      /GitHub (mandatory production step not verified|production jobs listing incomplete|production job completion chronology mismatch)/);
  }
  // Both the manifest and workflow run attest attempt 2, but the Jobs API
  // returns successful steps from attempt 1. A rerun must not inherit them.
  const rerunManifest = valid();
  rerunManifest.checks[0].runAttempt = 2;
  const attemptTwoArtifact = dispatchArtifact({ payload: { runAttempt: 2 } });
  const rerunFetch = async url => {
    if (url.endsWith('/12345/artifacts?per_page=100')) {
      return { ok: true, json: async () => ({ total_count: 1, artifacts: [attemptTwoArtifact] }) };
    }
    if (url.endsWith('/actions/artifacts/9001/zip'))
      return { ok: true, arrayBuffer: async () => attemptTwoArtifact.archiveBytes };
    const result = await makeFetch({ jobAttempt: 1 })(url);
    if (!url.endsWith('/actions/runs/12345')) return result;
    const original = result.json;
    return { ...result, json: async () => ({ ...await original(), run_attempt: 2 }) };
  };
  await assert.rejects(verifyGithubRuns(rerunManifest, opts(rerunFetch)),
    /GitHub mandatory production step not verified/);

  await assert.rejects(verifyGithubRuns(valid(), opts(makeFetch({ failJobs: true }))),
    /GitHub jobs API lookup failed/);
});

test('live GitHub approval is independent, current, exact-SHA and fail-closed', async () => {
  const approvedReview = {
    user: { login: 'independent-release-reviewer' }, state: 'APPROVED',
    id: 456, html_url: REVIEW_URL,
        commit_id: REVIEWED_HEAD_SHA, submitted_at: '2026-11-09T14:00:00Z',
  };
  const originalPr = {
    number: 123, base: { ref: 'main' }, head: { sha: REVIEWED_HEAD_SHA }, merge_commit_sha: SHA,
      merged_at: '2026-11-09T14:02:00Z',
    user: { login: 'author' }, state: 'closed', merged: true,
  };
  const makeFetch = ({ pr = originalPr, reviews = [approvedReview],
    failPr = false, failReviews = false } = {}) => async url => {
    if (url.endsWith('/pulls/123')) {
      return failPr ? { ok: false } : { ok: true, json: async () => pr };
    }
    if (url.endsWith('/pulls/123/reviews?per_page=100')) {
      return failReviews ? { ok: false } : { ok: true, json: async () => reviews };
    }
    if (url.endsWith('/12345/artifacts?per_page=100')) {
      return { ok: true, json: async () => ({ total_count: 1, artifacts: [dispatchArtifact()] }) };
    }
    if (url.endsWith('/actions/artifacts/9001/zip')) {
      const artifact = dispatchArtifact();
      return { ok: true, arrayBuffer: async () => artifact.archiveBytes };
    }
    if (url.endsWith('/12345/jobs?per_page=100')) {
      return { ok: true, json: async () => ({
        total_count: 1,
        jobs: [{
          run_id: 12345, run_attempt: 1, status: 'completed', conclusion: 'success',
          completed_at: '2026-11-09T14:45:00Z', steps: Object.keys(valid().checks[0].productionSteps).map(name =>
            ({ name, status: 'completed', conclusion: 'success' })),
        }],
      }) };
    }
    const id = Number(url.split('/').at(-1));
    return { ok: true, json: async () => ({
      id, head_sha: SHA, head_branch: 'main', status: 'completed',
      conclusion: 'success', event: id === 12345 ? 'workflow_dispatch' : 'push',
      created_at: '2026-11-09T14:05:00Z', updated_at: '2026-11-09T14:50:00Z', run_attempt: 1,
      path: id === 12345 ? '.github/workflows/release-gate.yml' : '.github/workflows/vk-native-hosting-main-parity.yml',
      html_url: 'https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/' + id,
      repository: { full_name: 'GrafTrahula666/pivnik-bonus-app' },
    }) };
  };
  const verify = (changes, manifest = valid()) =>
    verifyGithubRuns(manifest, { fetchImpl: makeFetch(changes), token: 'test-token' });

  assert.deepEqual(await verify({}), { verifiedRunIds: [12345, 12346] });

  const substitutedEvidence = valid();
  substitutedEvidence.approval.evidenceUrl = REF;
  await assert.rejects(verify({}, substitutedEvidence),
    /GitHub independent exact-SHA approval missing/,
    'unrelated HTTPS URL cannot masquerade as the live approval review');
  await assert.rejects(verify({ reviews: [{ ...approvedReview, id: 999 }] }),
    /GitHub independent exact-SHA approval missing/,
    'review ID must match the GitHub review URL');
  await assert.rejects(verify({ reviews: [{ ...approvedReview, html_url: REVIEW_URL + '-forged' }] }),
    /GitHub independent exact-SHA approval missing/,
    'GitHub review URL must be canonical');

  const forgedApprovalTime = valid();
  forgedApprovalTime.approval.at = '2026-11-09T14:00:30Z';
  await assert.rejects(verify({}, forgedApprovalTime),
    /GitHub independent exact-SHA approval missing/,
    'manifest cannot postdate the actual GitHub review and claim a later approval');

  const invalidPr = valid();
  invalidPr.approval.prNumber = 0;
  assert.throws(() => validateReleaseEvidence(invalidPr), /positive GitHub PR number/);

  for (const [reason, changes] of [
    ['self-approval', { pr: { ...originalPr, user: { login: approvedReview.user.login } } }],
    ['foreign PR head', { pr: { ...originalPr, head: { sha: ROLLBACK_SHA } } }],
    ['foreign merge SHA', { pr: { ...originalPr, merge_commit_sha: ROLLBACK_SHA } }],
    ['missing merge SHA', { pr: { ...originalPr, merge_commit_sha: null } }],
    ['merge before approval', { pr: { ...originalPr, merged_at: '2026-11-09T13:59:59Z' } }],
    ['unmerged PR', { pr: { ...originalPr, state: 'open', merged: false } }],
    ['non-main PR', { pr: { ...originalPr, base: { ref: 'dev' } } }],
    ['COMMENT instead of APPROVED', { reviews: [{ ...approvedReview, state: 'COMMENTED' }] }],
    ['approval of earlier SHA', { reviews: [{ ...approvedReview, commit_id: ROLLBACK_SHA }] }],
    ['withdrawn approval', { reviews: [approvedReview, {
      ...approvedReview, state: 'DISMISSED', submitted_at: '2026-11-09T14:01:00Z',
    }] }],
    ['stale earlier approval', { reviews: [{ ...approvedReview,
      submitted_at: '2026-11-09T14:01:00Z' }] }],
  ]) {
    await assert.rejects(verify(changes), /GitHub (independent exact-SHA approval missing|approval PR exact-SHA identity mismatch)/,
      reason);
  }
  await assert.rejects(verify({ failPr: true }), /GitHub approval PR lookup failed/);
  await assert.rejects(verify({ failReviews: true }), /GitHub approval reviews lookup failed/);
  await assert.rejects(verify({ reviews: Array.from({ length: 100 }, () => approvedReview) }),
    /GitHub approval reviews incomplete/);
});


test('workflow dispatch attestation records exact inputs and rejects forged or missing values', async () => {
  const workflow = await import('node:fs/promises').then(fs =>
    fs.readFile(fileURLToPath(new URL('../.github/workflows/release-gate.yml', import.meta.url)), 'utf8'));
  assert.ok(workflow.includes('name: release-dispatch-${{ github.run_id }}-${{ github.run_attempt }}-${{ inputs.release_confirm }}-${{ inputs.release_sha }}'),
    'artifact metadata must bind the exact run, attempt, confirmation and release SHA');
  const match = workflow.match(/      - name: Record manual dispatch inputs for release evidence\n[\s\S]*?        run: \|\n          node --input-type=module -e '\n([\s\S]*?)\n          '\n/);
  assert.ok(match, 'attestation must be generated by the real release workflow');
  const script = match[1].split('\n').map(line => line.replace(/^            /, '')).join('\n');
  const dir = await mkdtemp(join(tmpdir(), 'pivnik-dispatch-attestation-'));
  const env = {
    ...process.env,
    ATTEST_RUN_ID: '12345',
    ATTEST_RUN_ATTEMPT: '2',
    ATTEST_SHA: SHA,
    ATTEST_REF: 'refs/heads/main',
    ATTEST_RELEASE_SHA: SHA,
    ATTEST_RELEASE_CONFIRM: 'DEPLOY_PIVNIK_PRODUCTION',
  };
  const execute = overrides => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8',
  });
  try {
    const success = execute({});
    assert.equal(success.status, 0, success.stderr);
    const { readFile } = await import('node:fs/promises');
    const attestation = JSON.parse(await readFile(join(dir, 'artifacts/release-dispatch/dispatch.json'), 'utf8'));
    assert.deepEqual(attestation, {
      schemaVersion: 1,
      repository: 'GrafTrahula666/pivnik-bonus-app',
      event: 'workflow_dispatch',
      runId: 12345,
      runAttempt: 2,
      sha: SHA,
      ref: 'refs/heads/main',
      releaseSha: SHA,
      releaseConfirm: 'DEPLOY_PIVNIK_PRODUCTION',
    });
    for (const changes of [
      { ATTEST_RUN_ID: '0' },
      { ATTEST_RUN_ID: 'other-run' },
      { ATTEST_RUN_ATTEMPT: '0' },
      { ATTEST_RUN_ATTEMPT: 'not-an-attempt' },
      { ATTEST_SHA: 'main' },
      { ATTEST_RELEASE_SHA: 'main' },
      { ATTEST_RELEASE_CONFIRM: 'FORGED_APPROVAL' },
      { ATTEST_RELEASE_CONFIRM: '' },
    ]) {
      assert.notEqual(execute(changes).status, 0, JSON.stringify(changes));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
