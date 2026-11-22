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
    verified.push({ target: entry.target, deploymentId: live.id, sha: live.meta.commitHash.toLowerCase() });
  }
  return verified;
}

/**
 * Read-only Railway GraphQL lookup. The token must be supplied by the caller
 * from a scoped secret, never from a manifest or browser bundle.
 * A successful lookup is evidence only; this function never triggers deploys.
 */
export function createRailwayDeploymentLookup({ token, fetchImpl = globalThis.fetch } = {}) {
  requireEvidence(typeof token === 'string' && token.trim().length > 0,
    'Railway API token is required');
  requireEvidence(typeof fetchImpl === 'function', 'HTTP fetch is required');
  return async ({ projectId, environmentId, serviceId, deploymentId }) => {
    requireEvidence(projectId === RAILWAY_RELEASE_PROJECT &&
      environmentId === RAILWAY_RELEASE_ENVIRONMENT &&
      Object.values(RAILWAY_RELEASE_TARGETS).includes(serviceId),
    'untrusted Railway lookup scope');
    requireEvidence(typeof deploymentId === 'string' &&
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(deploymentId),
    'invalid Railway deployment ID');
    const response = await fetchImpl('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      // Never forward a scoped Railway token to a redirected endpoint.
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ReleaseDeployment($id: String!) { deployment(id: $id) { id serviceId environmentId status createdAt meta } }',
        variables: { id: deploymentId },
      }),
      signal: AbortSignal.timeout(10000),
    });
    requireEvidence(response?.ok === true, 'Railway API request failed');
    const body = await response.json();
    requireEvidence(!body?.errors?.length, 'Railway GraphQL errors');
    requireEvidence(body?.data?.deployment && typeof body.data.deployment === 'object',
      'deployment not found');
    return body.data.deployment;
  };
}
