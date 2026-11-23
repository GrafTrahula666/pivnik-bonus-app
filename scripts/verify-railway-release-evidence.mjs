// CI-01: read-only Railway deployment attestation. Never authorizes a release.
// The caller MUST provide an authenticated Railway API lookup. No network or
// deployment side effects occur in this module.
import { validateReleaseEvidence } from './validate-release-evidence.mjs';

export const RAILWAY_RELEASE_TARGETS = Object.freeze({
  'pivnik-bonus-app': 'd8d26f64-9ac1-4a03-9036-1a60f43c0be6',
  'vk-native-hosting': '0573c420-0f9c-43bd-8e87-e1788ce3eefd',
});
export const RAILWAY_RELEASE_PROJECT = '20a942f9-3164-484a-a6f1-565439e38705';
export const RAILWAY_RELEASE_ENVIRONMENT = 'cdd9d26c-2aab-45d9-95ed-ef487fafaa8f';

function requireEvidence(ok, message) {
  if (!ok) throw new Error('Railway release evidence mismatch: ' + message);
}

/**
 * Fail closed unless an authenticated caller independently fetches each
 * deployment ID from Railway. lookupDeployment receives {projectId,
 * environmentId, serviceId, deploymentId} and must return the provider's
 * unmodified deployment record, not a copy of the release manifest.
 *
 * This verifies recorded deployment identity only. It does NOT prove current
 * traffic serves this SHA, release approval, rollback readiness or smoke.
 */
export async function verifyRailwayDeployments(manifest, { lookupDeployment } = {}) {
  validateReleaseEvidence(manifest);
  requireEvidence(typeof lookupDeployment === 'function',
    'authenticated Railway lookup is required');
  const verified = [];
  for (const entry of manifest.deployments) {
    const serviceId = RAILWAY_RELEASE_TARGETS[entry.target];
    requireEvidence(Boolean(serviceId), 'unknown target');
    const requested = {
      projectId: RAILWAY_RELEASE_PROJECT,
      environmentId: RAILWAY_RELEASE_ENVIRONMENT,
      serviceId,
      deploymentId: entry.deploymentId,
    };
    const live = await lookupDeployment(requested);
    requireEvidence(live && typeof live === 'object', 'deployment not found');
    requireEvidence(live.id === entry.deploymentId, 'deployment ID');
    requireEvidence(live.serviceId === serviceId, 'service ID');
    requireEvidence(live.environmentId === RAILWAY_RELEASE_ENVIRONMENT, 'environment ID');
    requireEvidence(live.status === 'SUCCESS', 'deployment not successful');
    requireEvidence(typeof live.meta?.commitHash === 'string' &&
      live.meta.commitHash.toLowerCase() === manifest.releaseSha.toLowerCase(),
      'exact commit SHA');
    requireEvidence(typeof live.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(live.createdAt) &&
      Number.isFinite(Date.parse(live.createdAt)) &&
      new Date(live.createdAt).toISOString().startsWith(live.createdAt.slice(0, 19)) &&
      Date.parse(live.createdAt) >= Date.parse(manifest.approval.at) &&
      Date.parse(live.createdAt) <= Date.parse(entry.deployedAt),
      'deployment timestamp');
    verified.push({ target: entry.target, deploymentId: live.id,
      sha: live.meta.commitHash.toLowerCase(), createdAt: live.createdAt });
  }
  return verified;
}

/**
 * Read-only attestation of ONE explicitly selected rollback target.
 * An offline manifest's rollback SHA/ID is self-attested until an
 * independent Railway lookup confirms the historical provider record.
 *
 * Passing this check does NOT prove the other service can be rolled back,
 * that rollback was rehearsed, or that a historical image still exists.
 */
export async function verifyRailwayRollbackDeployment(manifest,
  { lookupDeployment, target } = {}) {
  validateReleaseEvidence(manifest);
  requireEvidence(typeof lookupDeployment === 'function',
    'authenticated rollback deployment lookup is required');
  requireEvidence(typeof target === 'string' &&
    Object.hasOwn(RAILWAY_RELEASE_TARGETS, target),
    'explicit Railway rollback service target is required');
  const serviceId = RAILWAY_RELEASE_TARGETS[target];
  const previous = await lookupDeployment({
    projectId: RAILWAY_RELEASE_PROJECT,
    environmentId: RAILWAY_RELEASE_ENVIRONMENT,
    serviceId,
    deploymentId: manifest.rollback.deploymentId,
  });
  requireEvidence(previous && typeof previous === 'object' &&
    !Array.isArray(previous) &&
    previous.id === manifest.rollback.deploymentId &&
    previous.serviceId === serviceId &&
    previous.environmentId === RAILWAY_RELEASE_ENVIRONMENT &&
    previous.status === 'SUCCESS' &&
    typeof previous.meta?.commitHash === 'string' &&
    previous.meta.commitHash.toLowerCase() === manifest.rollback.sha.toLowerCase(),
    'known-good rollback deployment identity or SHA mismatch');
  // A historical SUCCESS record alone does not prove that Railway still
  // permits rollback to that image under the current retention policy.
  requireEvidence(previous.canRollback === true,
    'rollback deployment is not currently eligible for rollback');
  requireEvidence(typeof previous.createdAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(previous.createdAt) &&
    Number.isFinite(Date.parse(previous.createdAt)) &&
    new Date(previous.createdAt).toISOString().startsWith(previous.createdAt.slice(0, 19)) &&
    Date.parse(previous.createdAt) <= Date.parse(manifest.rollback.verifiedAt) &&
    Date.parse(previous.createdAt) <= Date.parse(manifest.approval.at),
    'rollback deployment must predate its verification and approval');
  return { target, serviceId, deploymentId: previous.id,
    sha: previous.meta.commitHash.toLowerCase(), createdAt: previous.createdAt,
    canRollback: true };
}

/**
 * Attest TWO different historical rollback deployments with read-only Railway
 * provider lookups. A single rollback ID cannot stand for both services.
 * No deploy, rollback, retention or staging operation is performed here.
 */
export async function verifyBothRailwayRollbackDeployments(manifest,
  { lookupDeployment } = {}) {
  validateReleaseEvidence(manifest);
  requireEvidence(typeof lookupDeployment === 'function',
    'authenticated rollback deployment lookup is required');
  const records = manifest.rollback?.railwayTargets;
  const targets = Object.keys(RAILWAY_RELEASE_TARGETS);
  requireEvidence(records && typeof records === 'object' &&
    !Array.isArray(records) && Object.keys(records).length === targets.length &&
    Object.keys(records).every(name => targets.includes(name)),
    'separate rollback records for both Railway services are required');
  // Schema v1 also has a legacy single rollback record. In "both" mode it
  // must identify one of the two independently authenticated service records.
  // Otherwise a manifest can advertise an unrelated third "known-good" target
  // while successfully verifying two different provider deployments.
  const legacy = manifest.rollback;
  requireEvidence(targets.some(target => {
    const record = records[target];
    return record && typeof record === 'object' && !Array.isArray(record) &&
      ['sha', 'deploymentId', 'verifiedAt', 'evidenceUrl']
        .every(field => record[field] === legacy[field]);
  }), 'legacy rollback record is not bound to either verified Railway service target');
  const ids = new Set(manifest.deployments.map(entry => entry.deploymentId));
  const verified = [];
  for (const target of targets) {
    const record = records[target];
    requireEvidence(record && typeof record === 'object' &&
      !Array.isArray(record) && typeof record.deploymentId === 'string' &&
      !ids.has(record.deploymentId),
      'both rollback deployment IDs must be distinct from each other and current deployments');
    ids.add(record.deploymentId);
    verified.push(await verifyRailwayRollbackDeployment(
      { ...manifest, rollback: record }, { lookupDeployment, target }));
  }
  return verified;
}

/**
 * Stronger read-only attestation for the CURRENT active Railway deployment.
 * Historical SUCCESS alone is insufficient: Railway can replace that release.
 * This proves the provider's active ID at query time, NOT end-user traffic,
 * atomicity across services, approval, auto-deploy isolation or rollback.
 */
export async function verifyCurrentRailwayDeployments(manifest,
  { lookupDeployment, lookupActiveDeployment } = {}) {
  requireEvidence(typeof lookupActiveDeployment === 'function',
    'authenticated active Railway deployment lookup is required');
  const historical = await verifyRailwayDeployments(manifest, { lookupDeployment });
  // The two services cannot be read atomically. Read PIVNIK and VK twice:
  // if either rolls forward while the other is being queried, the second
  // sweep catches that mid-attestation drift. This is NOT an atomic snapshot
  // or a substitute for a deploy freeze and post-release smoke.
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const record of historical) {
      const active = await lookupActiveDeployment({
        projectId: RAILWAY_RELEASE_PROJECT,
        environmentId: RAILWAY_RELEASE_ENVIRONMENT,
        serviceId: RAILWAY_RELEASE_TARGETS[record.target],
      });
      requireEvidence(active && typeof active === 'object' && !Array.isArray(active) &&
        active.id === record.deploymentId && active.status === 'SUCCESS' &&
        active.serviceId === RAILWAY_RELEASE_TARGETS[record.target] &&
        active.environmentId === RAILWAY_RELEASE_ENVIRONMENT &&
        typeof active.meta?.commitHash === 'string' &&
        active.meta.commitHash.toLowerCase() === record.sha &&
        active.createdAt === record.createdAt,
      'current active Railway deployment identity does not match release manifest');
    }
  }
  return historical;
}

// Railway's GraphQL response is small for a single deployment. Never call
// Response.json() on an unbounded network body while carrying a scoped token.
const MAX_RAILWAY_GRAPHQL_BYTES = 128 * 1024;

async function readRailwayGraphqlJson(response) {
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        requireEvidence(value instanceof Uint8Array,
          'Railway GraphQL response contains invalid bytes');
        total += value.byteLength;
        requireEvidence(total <= MAX_RAILWAY_GRAPHQL_BYTES,
          'Railway GraphQL response exceeds byte limit');
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      try { await reader.cancel(); } catch {}
      throw error;
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    } catch {
      requireEvidence(false, 'Railway GraphQL response is not valid JSON');
    }
  }
  // Support explicitly injected mock transports in the isolated Node tests.
  // The production Node fetch response always exposes a readable stream.
  requireEvidence(typeof response?.json === 'function',
    'Railway GraphQL response body is unreadable');
  const parsed = await response.json();
  const encoded = JSON.stringify(parsed);
  requireEvidence(typeof encoded === 'string' &&
    Buffer.byteLength(encoded, 'utf8') <= MAX_RAILWAY_GRAPHQL_BYTES,
    'Railway GraphQL response exceeds byte limit');
  return parsed;
}

/**
 * Read-only Railway GraphQL lookup. The token must be supplied by the caller
 * from a scoped secret, never from a manifest or browser bundle.
 * A successful lookup is evidence only; this function never triggers deploys.
 */
async function queryRailwayReadOnly(fetchImpl, token, query, variables) {
  const response = await fetchImpl('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10000),
  });
  requireEvidence(response?.ok === true, 'Railway API request failed');
  const body = await readRailwayGraphqlJson(response);
  requireEvidence(body && typeof body === 'object' && !Array.isArray(body),
    'Railway GraphQL response is invalid');
  requireEvidence(!Object.hasOwn(body, 'errors') ||
    (Array.isArray(body.errors) && body.errors.length === 0),
    'Railway GraphQL errors');
  requireEvidence(body.data && typeof body.data === 'object' && !Array.isArray(body.data),
    'Railway GraphQL response data is invalid');
  return body.data;
}

export function createRailwayDeploymentLookup({ token, fetchImpl = globalThis.fetch } = {}) {
  requireEvidence(typeof token === 'string' && token.trim().length > 0,
    'Railway API token is required');
  requireEvidence(typeof fetchImpl === 'function', 'HTTP fetch is required');
  const checkScope = ({ projectId, environmentId, serviceId }) =>
    requireEvidence(projectId === RAILWAY_RELEASE_PROJECT &&
      environmentId === RAILWAY_RELEASE_ENVIRONMENT &&
      Object.values(RAILWAY_RELEASE_TARGETS).includes(serviceId),
    'untrusted Railway lookup scope');

  const lookupDeployment = async ({ projectId, environmentId, serviceId, deploymentId }) => {
    checkScope({ projectId, environmentId, serviceId });
    requireEvidence(typeof deploymentId === 'string' &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(deploymentId),
    'invalid Railway deployment ID');
    const data = await queryRailwayReadOnly(fetchImpl, token,
      'query ReleaseDeployment($id: String!) { deployment(id: $id) { id serviceId environmentId status canRollback createdAt meta } }',
      { id: deploymentId });
    requireEvidence(data.deployment && typeof data.deployment === 'object' &&
      !Array.isArray(data.deployment), 'deployment not found');
    return data.deployment;
  };

  // Official Railway Public API: "Get latest active deployment".
  // successfulOnly prevents a historical success from being mistaken for the
  // newest active release after another deployment supersedes it.
  lookupDeployment.lookupActiveDeployment = async ({ projectId, environmentId, serviceId }) => {
    checkScope({ projectId, environmentId, serviceId });
    const data = await queryRailwayReadOnly(fetchImpl, token,
      'query LatestActiveReleaseDeployment($input: DeploymentListInput!) { deployments(input: $input, first: 1) { edges { node { id serviceId environmentId status createdAt meta } } } }',
      { input: { projectId, environmentId, serviceId, status: { successfulOnly: true } } });
    requireEvidence(data.deployments && typeof data.deployments === 'object' &&
      !Array.isArray(data.deployments) && Array.isArray(data.deployments.edges) &&
      data.deployments.edges.length === 1,
    'current active Railway deployment not found');
    const active = data.deployments.edges[0]?.node;
    requireEvidence(active && typeof active === 'object' && !Array.isArray(active) &&
      typeof active.id === 'string' &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(active.id) &&
      active.status === 'SUCCESS' &&
      active.serviceId === serviceId && active.environmentId === environmentId &&
      typeof active.meta?.commitHash === 'string' &&
      /^[0-9a-f]{40}$/i.test(active.meta.commitHash) &&
      typeof active.createdAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(active.createdAt) &&
      Number.isFinite(Date.parse(active.createdAt)),
    'current active Railway deployment response invalid');
    return active;
  };
  return lookupDeployment;
}
