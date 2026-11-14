#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const MAX_DISPATCH_ARCHIVE_BYTES = 64 * 1024;
const MAX_DISPATCH_JSON_BYTES = 4 * 1024;

function demand(condition, reason) {
  if (!condition) throw new Error('Invalid release evidence: ' + reason);
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function date(value) {
  return typeof value === 'string' && UTC.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value.slice(0, 19));
}
function link(value) {
  if (!nonempty(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
function entries(value, field) {
  demand(Array.isArray(value) && value.length > 0, field + ' must be a nonempty array');
  return value;
}
function same(value, sha, field) {
  demand(typeof value === 'string' && value.toLowerCase() === sha, field + ' SHA mismatch');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// The dispatch artifact is deliberately tiny and contains exactly one JSON file.
// Parse only the ZIP subset emitted for this file; reject multi-file/ZIP64 archives.
function readDispatchZip(input) {
  const zip = Buffer.from(input);
  demand(zip.length >= 22 && zip.length <= MAX_DISPATCH_ARCHIVE_BYTES,
    'GitHub dispatch artifact ZIP size is outside the allowed range');
  let end = -1;
  const lowerBound = Math.max(0, zip.length - 22 - 0xffff);
  for (let offset = zip.length - 22; offset >= lowerBound; offset--) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  demand(end >= 0, 'GitHub dispatch artifact ZIP end record missing');
  const disk = zip.readUInt16LE(end + 4);
  const centralDisk = zip.readUInt16LE(end + 6);
  const diskEntries = zip.readUInt16LE(end + 8);
  const totalEntries = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  const archiveCommentLength = zip.readUInt16LE(end + 20);
  demand(disk === 0 && centralDisk === 0 && diskEntries === 1 && totalEntries === 1 &&
    end + 22 + archiveCommentLength === zip.length &&
    centralOffset + centralSize === end,
    'GitHub dispatch artifact ZIP must contain exactly one supported entry');

  demand(centralOffset + 46 <= end && zip.readUInt32LE(centralOffset) === 0x02014b50,
    'GitHub dispatch artifact ZIP central directory is invalid');
  const flags = zip.readUInt16LE(centralOffset + 8);
  const method = zip.readUInt16LE(centralOffset + 10);
  const expectedCrc = zip.readUInt32LE(centralOffset + 16);
  const compressedSize = zip.readUInt32LE(centralOffset + 20);
  const uncompressedSize = zip.readUInt32LE(centralOffset + 24);
  const nameLength = zip.readUInt16LE(centralOffset + 28);
  const extraLength = zip.readUInt16LE(centralOffset + 30);
  const entryCommentLength = zip.readUInt16LE(centralOffset + 32);
  const startDisk = zip.readUInt16LE(centralOffset + 34);
  const localOffset = zip.readUInt32LE(centralOffset + 42);
  demand(startDisk === 0 &&
    centralOffset + 46 + nameLength + extraLength + entryCommentLength === end,
    'GitHub dispatch artifact ZIP central directory has unexpected entries');
  const name = zip.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');
  demand(name === 'dispatch.json', 'GitHub dispatch artifact ZIP entry must be dispatch.json');
  demand((flags & 0x0001) === 0 && (flags & ~(0x0008 | 0x0800)) === 0 &&
    (method === 0 || method === 8),
    'GitHub dispatch artifact ZIP uses unsupported flags or compression');
  demand(compressedSize <= MAX_DISPATCH_JSON_BYTES * 2 &&
    uncompressedSize > 0 && uncompressedSize <= MAX_DISPATCH_JSON_BYTES,
    'GitHub dispatch artifact JSON exceeds the allowed size');

  demand(localOffset === 0 && localOffset + 30 <= centralOffset && zip.readUInt32LE(localOffset) === 0x04034b50,
    'GitHub dispatch artifact ZIP local header is invalid');
  const localFlags = zip.readUInt16LE(localOffset + 6);
  const localMethod = zip.readUInt16LE(localOffset + 8);
  const localCrc = zip.readUInt32LE(localOffset + 14);
  const localCompressedSize = zip.readUInt32LE(localOffset + 18);
  const localUncompressedSize = zip.readUInt32LE(localOffset + 22);
  const localNameLength = zip.readUInt16LE(localOffset + 26);
  const localExtraLength = zip.readUInt16LE(localOffset + 28);
  const localName = zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
  demand(localFlags === flags && localMethod === method &&
    ((flags & 0x0008) !== 0 ||
      (localCrc === expectedCrc && localCompressedSize === compressedSize &&
        localUncompressedSize === uncompressedSize)) &&
    localNameLength === nameLength &&
    localName === name,
    'GitHub dispatch artifact ZIP local and central headers disagree');
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  demand(dataStart <= dataEnd && dataEnd <= centralOffset &&
    ((flags & 0x0008) !== 0 || dataEnd === centralOffset),
    'GitHub dispatch artifact ZIP payload bounds are invalid');
  const compressed = zip.subarray(dataStart, dataEnd);
  let content;
  try {
    content = method === 0
      ? Buffer.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: MAX_DISPATCH_JSON_BYTES });
  } catch {
    demand(false, 'GitHub dispatch artifact ZIP payload is corrupt');
  }
  demand(content.length === uncompressedSize && crc32(content) === expectedCrc,
    'GitHub dispatch artifact ZIP CRC or uncompressed size mismatch');
  return content;
}

async function readBoundedBody(response, limit) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        demand(total <= limit, 'GitHub dispatch artifact archive exceeds the size limit');
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel(); } catch {}
      throw error;
    }
    return Buffer.concat(chunks, total);
  }
  demand(typeof response.arrayBuffer === 'function',
    'GitHub dispatch artifact download has no readable body');
  const bytes = Buffer.from(await response.arrayBuffer());
  demand(bytes.length <= limit, 'GitHub dispatch artifact archive exceeds the size limit');
  return bytes;
}

function verifyDispatchJson(bytes, run, check, releaseSha) {
  let attestation;
  try {
    attestation = JSON.parse(bytes.toString('utf8'));
  } catch {
    demand(false, 'GitHub dispatch artifact JSON is invalid');
  }
  const expected = {
    schemaVersion: 1,
    repository: 'GrafTrahula666/pivnik-bonus-app',
    event: 'workflow_dispatch',
    runId: run.id,
    runAttempt: check.runAttempt,
    sha: run.head_sha.toLowerCase(),
    ref: 'refs/heads/main',
    releaseSha: releaseSha.toLowerCase(),
    releaseConfirm: 'DEPLOY_PIVNIK_PRODUCTION',
  };
  const expectedKeys = Object.keys(expected).sort();
  demand(object(attestation) &&
    Object.keys(attestation).sort().join('|') === expectedKeys.join('|') &&
    expectedKeys.every(key => attestation[key] === expected[key]),
    'GitHub dispatch artifact content does not match exact workflow run inputs');
}

/**
 * This validates an offline evidence document only. It does not attest that
 * GitHub, Railway, VK or the approver actually produced the claimed evidence.
 * Never use this function as the sole authorization to deploy.
 */
export function validateReleaseEvidence(data) {
  demand(object(data), 'root must be an object');
  demand(data.schemaVersion === 1, 'schemaVersion must equal 1');
  demand(typeof data.releaseSha === 'string' && SHA.test(data.releaseSha), 'releaseSha must be 40 hex characters');
  const sha = data.releaseSha.toLowerCase();
  demand(date(data.createdAt), 'createdAt must be valid UTC');
  demand(object(data.approval), 'approval is required');
  demand(nonempty(data.approval.actor) && date(data.approval.at) && link(data.approval.evidenceUrl), 'approval requires actor, UTC timestamp and HTTPS evidenceUrl');
  demand(Number.isSafeInteger(data.approval.prNumber) && data.approval.prNumber > 0, 'approval requires a positive GitHub PR number');
  // An approval for a different commit must never be reused as release consent.
  same(data.approval.sha, sha, 'approval');

  demand(Date.parse(data.createdAt) >= Date.parse(data.approval.at),
    'manifest cannot be created before release approval');

  // Only the two release-critical workflows are eligible as required evidence.
  // Otherwise a green unrelated workflow could be mislabeled as mandatory.
  const mandatoryChecks = new Set(['Pivnik release gate', 'VK native hosting main parity']);
  const checkNames = new Set();
  const checkRunIds = new Set();
  let approvedGate = false;
  let gateCompletedAt = null;
  for (const check of entries(data.checks, 'checks')) {
    demand(object(check), 'check must be an object');
    demand(nonempty(check.name) && !checkNames.has(check.name), 'check names must be nonempty and unique');
    checkNames.add(check.name);
    same(check.sha, sha, 'check');
    demand(Number.isSafeInteger(check.runId) && check.runId > 0, 'check requires positive GitHub runId');
    // Different required checks cannot reuse one workflow run as independent evidence.
    demand(!checkRunIds.has(check.runId), 'check runIds must be unique');
    checkRunIds.add(check.runId);
    demand(link(check.evidenceUrl), 'check requires HTTPS evidenceUrl');
    // Prevent a manifest from citing a different run (or a generic HTTPS page).
    // This is only a structural check, not a live GitHub API attestation.
    const runUrl = new URL(check.evidenceUrl);
    demand(runUrl.hostname === 'github.com' &&
      runUrl.pathname === '/GrafTrahula666/pivnik-bonus-app/actions/runs/' + check.runId &&
      !runUrl.search && !runUrl.hash,
      'check evidenceUrl must point to its exact GitHub Actions runId');
    demand(typeof check.required === 'boolean', 'check requires explicit required flag');
    demand(!check.required || mandatoryChecks.has(check.name),
      'unknown workflow cannot be marked as a required release check');
    demand(['success', 'skipped'].includes(check.conclusion), 'check conclusion must be success or skipped');
    if (check.conclusion === 'skipped') {
      demand(!check.required && nonempty(check.skipReason), 'required checks cannot be skipped; optional skip requires reason');
    }
    if (check.name === 'VK native hosting main parity') {
      demand(check.required && check.conclusion === 'success' && check.event === 'push',
        'VK main parity must be a required successful push check');
    }
    if (check.name === 'Pivnik release gate') {
      demand(check.required && check.conclusion === 'success' && check.event === 'workflow_dispatch' &&
        check.releaseConfirm === 'DEPLOY_PIVNIK_PRODUCTION' &&
        Number.isSafeInteger(check.runAttempt) && check.runAttempt > 0,
        'common release gate must be an approved successful manual production dispatch with run attempt');
      // A green workflow_dispatch with release_confirm=CANCEL skips production
      // steps. A successful workflow conclusion alone MUST NOT approve release.
      const requiredProductionSteps = [
        'Deploy exact commit and verify both production services',
        'Probe production documents and public endpoints',
        'Verify separate Telegram and VK production accounts',
        'Verify signed Telegram and VK production sessions',
      ];
      demand(object(check.productionSteps), 'production step results are required');
      demand(Object.keys(check.productionSteps).length === requiredProductionSteps.length &&
        Object.keys(check.productionSteps).every(name => requiredProductionSteps.includes(name)),
        'productionSteps must contain exactly the mandatory release workflow steps');
      for (const stepName of requiredProductionSteps) {
        demand(check.productionSteps[stepName] === 'success',
          'mandatory production step not successful: ' + stepName);
      }
      demand(date(check.completedAt), 'common release gate requires valid UTC completedAt');
      gateCompletedAt = Date.parse(check.completedAt);
      approvedGate = true;
    }
  }
  demand(approvedGate, 'approved Pivnik release gate evidence is mandatory');
  demand(Date.parse(data.createdAt) >= gateCompletedAt,
    'manifest cannot precede completed release gate');

  const artifactNames = new Set();
  for (const artifact of entries(data.artifacts, 'artifacts')) {
    demand(object(artifact) && nonempty(artifact.name) && HASH.test(artifact.sha256 || '') &&
      link(artifact.evidenceUrl), 'each artifact needs a name, SHA-256 and HTTPS evidenceUrl');
    demand(!artifactNames.has(artifact.name), 'artifact names must be unique');
    artifactNames.add(artifact.name);
    same(artifact.sha, sha, 'artifact');
  }

  const targets = new Map();
  const deploymentIds = new Set();
  for (const deployment of entries(data.deployments, 'deployments')) {
    demand(object(deployment) && nonempty(deployment.target) && !targets.has(deployment.target),
      'deployment targets must be nonempty and unique');
    demand(['pivnik-bonus-app', 'vk-native-hosting'].includes(deployment.target),
      'unexpected production deployment target');
    same(deployment.sha, sha, 'deployment');
    demand(deployment.environment === 'production' && nonempty(deployment.deploymentId) &&
      deployment.status === 'success' && date(deployment.deployedAt) && link(deployment.evidenceUrl),
      'production deployment requires ID, success, UTC time and HTTPS evidenceUrl');
    demand(Date.parse(deployment.deployedAt) >= Date.parse(data.approval.at),
      'deployment must follow approval');
    // This workflow performs the deploy itself, so its completion follows deployment.
    demand(Date.parse(deployment.deployedAt) <= gateCompletedAt,
      'release gate cannot finish before its production deployment');
    demand(!deploymentIds.has(deployment.deploymentId), 'production deployment IDs must be unique across targets');
    deploymentIds.add(deployment.deploymentId);
    targets.set(deployment.target, deployment);
  }
  // A manifest with only an unrelated successful deployment is not evidence
  // that the actual PIVNIK production service was released.
  demand(targets.has('pivnik-bonus-app'),
    'pivnik-bonus-app production deployment is mandatory');
  // The mandatory gate step verifies BOTH Railway production services. A
  // PIVNIK-only manifest must not masquerade as complete release evidence.
  demand(targets.has('vk-native-hosting'),
    'vk-native-hosting production deployment is mandatory');
  if (targets.has('vk-native-hosting')) {
    const parity = data.checks.find(item => item.name === 'VK native hosting main parity');
    demand(parity?.required && parity?.conclusion === 'success',
      'VK Hosting publication requires successful mandatory VK parity');
  }

  const smoked = new Set();
  for (const smoke of entries(data.smoke, 'smoke')) {
    demand(object(smoke) && nonempty(smoke.target) && targets.has(smoke.target) && !smoked.has(smoke.target),
      'smoke must reference a unique deployed target');
    smoked.add(smoke.target);
    same(smoke.sha, sha, 'smoke');
    demand(smoke.result === 'passed' && date(smoke.at) && link(smoke.evidenceUrl),
      'smoke requires passed, UTC time and HTTPS evidenceUrl');
    demand(Date.parse(smoke.at) >= Date.parse(targets.get(smoke.target).deployedAt),
      'smoke must occur after deployment');
    // The mandatory smoke steps run inside the same release-gate workflow.
    demand(Date.parse(smoke.at) <= gateCompletedAt,
      'release gate cannot finish before its production smoke');
    demand(Date.parse(data.createdAt) >= Date.parse(smoke.at),
      'createdAt cannot precede smoke evidence');
  }
  demand(smoked.size === targets.size, 'every deployed target must have passing smoke evidence');

  demand(object(data.rollback), 'rollback target is mandatory');
  demand(typeof data.rollback.sha === 'string' && SHA.test(data.rollback.sha) &&
    data.rollback.sha.toLowerCase() !== sha && nonempty(data.rollback.deploymentId) &&
    date(data.rollback.verifiedAt) && link(data.rollback.evidenceUrl),
    'rollback must name a distinct known-good SHA, deployment ID, UTC verification and HTTPS evidence');
  demand(!deploymentIds.has(data.rollback.deploymentId),
    'rollback deployment ID must differ from current production deployments');
  demand(Date.parse(data.rollback.verifiedAt) <= Date.parse(data.approval.at),
    'known-good rollback must be verified before release approval');
  return { releaseSha: sha, checks: checkNames.size, targets: targets.size, artifacts: data.artifacts.length };
}

/**
 * Read-only GitHub attestation for the two declared workflow runs.
 * This is an additional check, NOT an authorization to deploy: GitHub does
 * not attest Railway deployments, independent approval, or rollback.
 * Caller supplies a trusted authenticated fetch implementation.
 */
export async function verifyGithubRuns(data, { fetchImpl, token } = {}) {
  validateReleaseEvidence(data);
  demand(typeof fetchImpl === 'function' && nonempty(token),
    'authenticated GitHub API access is required');
  // Bind approval to GitHub's live PR review state, not a self-authored JSON field.
  const api = 'https://api.github.com/repos/GrafTrahula666/pivnik-bonus-app';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  const prResponse = await fetchImpl(api + '/pulls/' + data.approval.prNumber, { headers, redirect: 'error' });
  demand(prResponse?.ok, 'GitHub approval PR lookup failed');
  const pr = await prResponse.json();
  // A reviewed PR head is normally NOT the SHA deployed from main: merge,
  // squash and rebase may create a different commit. Attest the deployed SHA
  // against GitHub's final merge_commit_sha, and the review against its head.
  demand(pr.number === data.approval.prNumber &&
    pr.base?.ref === 'main' &&
    typeof pr.merge_commit_sha === 'string' && SHA.test(pr.merge_commit_sha) &&
    pr.merge_commit_sha.toLowerCase() === data.releaseSha.toLowerCase() &&
    typeof pr.head?.sha === 'string' && SHA.test(pr.head.sha) &&
    pr.user?.login && pr.state === 'closed' && pr.merged === true &&
    date(pr.merged_at) && Date.parse(pr.merged_at) >= Date.parse(data.approval.at),
    'GitHub approval PR exact-SHA identity mismatch');
  const reviewsResponse = await fetchImpl(api + '/pulls/' + data.approval.prNumber + '/reviews?per_page=100',
    { headers, redirect: 'error' });
  demand(reviewsResponse?.ok, 'GitHub approval reviews lookup failed');
  const reviews = await reviewsResponse.json();
  demand(Array.isArray(reviews) && reviews.length < 100,
    'GitHub approval reviews incomplete; pagination required');
  const byActor = reviews.filter(review => review.user?.login === data.approval.actor)
    .sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''));
  const latest = byActor.at(-1);
  demand(data.approval.actor !== pr.user.login &&
    latest?.state === 'APPROVED' &&
    // GitHub review.commit_id is the reviewed PR HEAD, not the new merge SHA.
    latest.commit_id?.toLowerCase() === pr.head.sha.toLowerCase() &&
    date(latest.submitted_at) &&
    Date.parse(latest.submitted_at) === Date.parse(data.approval.at) &&
    Number.isSafeInteger(latest.id) && latest.id > 0 &&
    typeof latest.html_url === 'string' &&
    latest.html_url === data.approval.evidenceUrl &&
    latest.html_url === 'https://github.com/GrafTrahula666/pivnik-bonus-app/pull/' +
      data.approval.prNumber + '#pullrequestreview-' + latest.id,
    'GitHub independent exact-SHA approval missing, stale or dismissed');
  // An independent approval cannot override an outstanding change request
  // from another reviewer. Use each reviewer's latest submitted state.
  // COMMENTED does not clear an earlier CHANGES_REQUESTED review. Only a
  // subsequent APPROVED or DISMISSED review resolves that reviewer's block.
  const outstandingChangeRequests = new Set();
  for (const review of [...reviews].filter(r => r.user?.login && date(r.submitted_at))
    .sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at))) {
    if (review.state === 'CHANGES_REQUESTED') outstandingChangeRequests.add(review.user.login);
    if (review.state === 'APPROVED' || review.state === 'DISMISSED')
      outstandingChangeRequests.delete(review.user.login);
  }
  demand(outstandingChangeRequests.size === 0,
    'GitHub outstanding change request blocks independent release approval');
  for (const check of data.checks.filter(item => item.required)) {
    const url = 'https://api.github.com/repos/GrafTrahula666/pivnik-bonus-app/actions/runs/' + check.runId;
    const response = await fetchImpl(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      redirect: 'error',
    });
    demand(response?.ok, 'GitHub run API lookup failed for runId ' + check.runId);
    const run = await response.json();
    demand(run.id === check.runId && run.head_sha?.toLowerCase() === data.releaseSha.toLowerCase() &&
      run.status === 'completed' && run.conclusion === 'success' &&
      run.event === check.event &&
      run.head_branch === 'main' &&
      run.repository?.full_name === 'GrafTrahula666/pivnik-bonus-app' &&
      run.html_url === check.evidenceUrl,
      'GitHub run attestation mismatch for runId ' + check.runId);
    if (check.name === 'VK native hosting main parity') {
      // A successful unrelated workflow at this SHA is not VK parity evidence.
      // The real parity workflow is push-triggered on main.
      demand(run.path === '.github/workflows/vk-native-hosting-main-parity.yml' &&
        run.event === 'push',
        'GitHub VK parity workflow identity mismatch');
    }
    if (check.name === 'Pivnik release gate') {
      demand(run.run_attempt === check.runAttempt &&
        run.path === '.github/workflows/release-gate.yml',
        'GitHub release gate workflow identity or attempt mismatch');
      // The workflow-run REST response may omit inputs. Instead require the
      // immutable artifact uploaded by this exact trusted workflow run. Its
      // name binds the actual dispatch confirmation, release SHA and attempt.
      const artifactsResponse = await fetchImpl(url + '/artifacts?per_page=100', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
        redirect: 'error',
      });
      demand(artifactsResponse?.ok, 'GitHub dispatch artifact lookup failed for runId ' + check.runId);
      const artifactsData = await artifactsResponse.json();
      demand(Array.isArray(artifactsData.artifacts) &&
        Number.isSafeInteger(artifactsData.total_count) &&
        artifactsData.total_count === artifactsData.artifacts.length,
        'GitHub dispatch artifact listing incomplete for runId ' + check.runId);
      const expectedDispatchArtifact = 'release-dispatch-' + run.id + '-' + check.runAttempt +
        '-DEPLOY_PIVNIK_PRODUCTION-' + data.releaseSha.toLowerCase();
      const dispatchArtifacts = artifactsData.artifacts.filter(artifact =>
        artifact?.name === expectedDispatchArtifact);
      demand(dispatchArtifacts.length === 1,
        'GitHub original production dispatch attestation artifact missing or mismatched');
      const dispatchArtifact = dispatchArtifacts[0];
      demand(Number.isSafeInteger(dispatchArtifact.id) && dispatchArtifact.id > 0 &&
        dispatchArtifact.expired === false &&
        Number.isSafeInteger(dispatchArtifact.size_in_bytes) &&
        dispatchArtifact.size_in_bytes > 0 && dispatchArtifact.size_in_bytes <= MAX_DISPATCH_ARCHIVE_BYTES &&
        dispatchArtifact.workflow_run?.id === run.id &&
        dispatchArtifact.workflow_run?.repository_id === 1304466389 &&
        dispatchArtifact.workflow_run?.head_branch === 'main' &&
        dispatchArtifact.workflow_run?.head_sha?.toLowerCase() === data.releaseSha.toLowerCase() &&
        date(dispatchArtifact.created_at) && date(run.created_at) && date(run.updated_at) &&
        Date.parse(dispatchArtifact.created_at) >= Date.parse(run.created_at) &&
        Date.parse(dispatchArtifact.created_at) <= Date.parse(run.updated_at) &&
        Date.parse(dispatchArtifact.created_at) <= Date.parse(check.completedAt),
        'GitHub original production dispatch attestation artifact identity or chronology mismatch');

      // Verify the bytes and the payload, not just the artifact's caller-visible name.
      const archiveUrl = api + '/actions/artifacts/' + dispatchArtifact.id + '/zip';
      demand(dispatchArtifact.archive_download_url === archiveUrl &&
        /^sha256:[0-9a-f]{64}$/i.test(dispatchArtifact.digest || ''),
        'GitHub dispatch artifact archive URL or SHA-256 digest is missing or mismatched');
      const archiveResponse = await fetchImpl(archiveUrl, {
        headers, redirect: 'follow',
      });
      demand(archiveResponse?.ok, 'GitHub dispatch artifact download failed for artifactId ' + dispatchArtifact.id);
      const archive = await readBoundedBody(archiveResponse, MAX_DISPATCH_ARCHIVE_BYTES);
      const archiveSha = createHash('sha256').update(archive).digest('hex');
      demand(archiveSha === dispatchArtifact.digest.slice(7).toLowerCase(),
        'GitHub dispatch artifact archive SHA-256 mismatch');
      const dispatchBytes = readDispatchZip(archive);
      verifyDispatchJson(dispatchBytes, run, check, data.releaseSha);
      // A self-attested approval timestamp must not postdate the real GitHub
      // dispatch. This is only a chronology check, not independent approval.
      demand(date(run.created_at) &&
        Date.parse(run.created_at) >= Date.parse(data.approval.at) &&
        Date.parse(run.created_at) >= Date.parse(pr.merged_at) &&
        Date.parse(run.created_at) <= Date.parse(check.completedAt),
        'GitHub release gate dispatch chronology mismatch');
      // A successful workflow can still skip the production deployment jobs.
      // Bind the manifest's productionSteps to the real GitHub Jobs API.
      const jobsResponse = await fetchImpl(url + '/jobs?per_page=100', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
        redirect: 'error',
      });
      demand(jobsResponse?.ok, 'GitHub jobs API lookup failed for runId ' + check.runId);
      const jobsData = await jobsResponse.json();
      demand(Array.isArray(jobsData.jobs) &&
        Number.isSafeInteger(jobsData.total_count) &&
        jobsData.total_count === jobsData.jobs.length,
        'GitHub production jobs listing incomplete for runId ' + check.runId);
      // Do not accept a manifest that claims gate completion before GitHub's
      // actual production job completed. Missing timestamps fail closed.
      for (const job of jobsData.jobs) {
        demand(date(job.completed_at) &&
          Date.parse(job.completed_at) >= Date.parse(run.created_at) &&
          Date.parse(job.completed_at) <= Date.parse(check.completedAt),
          'GitHub production job completion chronology mismatch');
      }
      for (const stepName of Object.keys(check.productionSteps)) {
        const matching = jobsData.jobs.flatMap(job =>
          (job.steps || []).filter(step => step.name === stepName)
            .map(step => ({ job, step })));
        demand(matching.length === 1 &&
          matching[0].job.conclusion === 'success' &&
          matching[0].job.status === 'completed' &&
          matching[0].job.run_id === check.runId &&
          matching[0].job.run_attempt === check.runAttempt &&
          matching[0].step.status === 'completed' &&
          matching[0].step.conclusion === 'success',
          'GitHub mandatory production step not verified: ' + stepName);
      }
    }
  }
  return { verifiedRunIds: data.checks.filter(item => item.required).map(item => item.runId) };
}

async function main() {
  demand(process.argv.length === 3, 'usage: node scripts/validate-release-evidence.mjs <manifest.json>');
  const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const summary = validateReleaseEvidence(data);
  // A valid JSON manifest alone never proves GitHub Actions ran. Explicit
  // authenticated mode fails closed on missing token, API errors or mismatches.
  if (process.env.PIVNIK_VERIFY_GITHUB === '1') {
    await verifyGithubRuns(data, { fetchImpl: fetch, token: process.env.GITHUB_TOKEN });
    console.log('Authenticated GitHub workflow runs verified for exact release SHA.');
  }
  console.log('Release evidence format valid for ' + summary.releaseSha +
    ': ' + summary.checks + ' checks, ' + summary.artifacts +
    ' artifacts, ' + summary.targets + ' deployment targets.');
  console.log('WARNING: format validation does not verify external approval, live SHA or deployment state.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
