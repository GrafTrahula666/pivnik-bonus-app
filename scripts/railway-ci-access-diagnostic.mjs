// Manual, read-only token-scope diagnostic. Never print the token or GraphQL responses.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const VARIABLE_READ = `query CheckProductionVariableAccess($projectId: String!, $environmentId: String!, $serviceId: String!) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: false)
}`;
const PROJECT_TOKEN_READ = 'query DetectProjectToken { projectToken { projectId environmentId } }';

async function queryRailway(fetchImpl, token, headerName, query, variables) {
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        [headerName]: headerName === 'Authorization' ? `Bearer ${token}` : token,
        'content-type': 'application/json',
        'user-agent': 'pivnik-ci-auth-diagnostic/1.0'
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    return { kind: 'network_error' };
  }
  if (response.status === 429) return { kind: 'rate_limited' };
  if (response.status >= 500) return { kind: 'server_unavailable' };
  if (response.status === 401 || response.status === 403) return { kind: 'not_authorized' };
  let body;
  try {
    body = await response.json();
  } catch {
    return { kind: 'invalid_response' };
  }
  if (!response.ok || !body || typeof body !== 'object') {
    return { kind: 'request_rejected' };
  }
  if (Array.isArray(body.errors) && body.errors.length) {
    // Railway sometimes uses HTTP 200 for authorization denials.
    const denied = body.errors.some(error => error?.message === 'Not Authorized');
    return { kind: denied ? 'not_authorized' : 'graphql_rejected' };
  }
  return { kind: 'ok', data: body.data };
}

export async function diagnoseRailwayCiAccess({ token, fetchImpl, production = RAILWAY_PRODUCTION }) {
  if (typeof token !== 'string' || !token.trim()) {
    return { status: 'missing_ci_token', mutations: 0 };
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const scopedToken = token.trim();
  const targets = [
    ['telegram', production.services.telegram],
    ['vk', production.services.vk]
  ];
  for (const [service, serviceId] of targets) {
    const read = await queryRailway(fetchImpl, scopedToken, 'Authorization', VARIABLE_READ, {
      projectId: production.projectId,
      environmentId: production.environmentId,
      serviceId
    });
    if (read.kind === 'rate_limited' || read.kind === 'network_error' || read.kind === 'invalid_response' || read.kind === 'server_unavailable') {
      return { status: 'transport_unavailable', stage: service, mutations: 0 };
    }
    if (read.kind === 'ok' && read.data?.variables && typeof read.data.variables === 'object' && !Array.isArray(read.data.variables)) {
      continue;
    }
    // Schema errors, HTTP 400 and malformed success bodies do not prove an auth failure.
    // Probe an alternate token header ONLY after a real Bearer authorization denial.
    if (read.kind !== 'not_authorized') {
      return { status: 'api_response_unexpected', stage: service, mutations: 0 };
    }
    // Do not print any production variables even when a previous check succeeded.
    // A project token uses a different auth header. Check only its token metadata.
    const project = await queryRailway(fetchImpl, scopedToken, 'Project-Access-Token', PROJECT_TOKEN_READ, {});
    // A transient failure of the fallback probe is not evidence of a bad token.
    if (project.kind === 'rate_limited' || project.kind === 'network_error' ||
        project.kind === 'invalid_response' || project.kind === 'server_unavailable') {
      return { status: 'transport_unavailable', stage: service, mutations: 0 };
    }
    if (project.kind === 'ok' && project.data?.projectToken?.projectId && project.data?.projectToken?.environmentId) {
      const exactScope = project.data.projectToken.projectId === production.projectId &&
        project.data.projectToken.environmentId === production.environmentId;
      return {
        status: exactScope ? 'project_token_wrong_header' : 'project_token_wrong_scope',
        stage: service,
        mutations: 0
      };
    }
    return { status: 'bearer_access_unresolved', stage: service, mutations: 0 };
  }
  return { status: 'variable_read_authorized', checkedServices: targets.map(([name]) => name), mutations: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    console.error('Only explicit --check (read-only) is supported.');
    process.exitCode = 2;
  } else {
    const result = await diagnoseRailwayCiAccess({ token: process.env.RAILWAY_API_TOKEN, fetchImpl: fetch });
    console.log(JSON.stringify(result));
    if (result.status !== 'variable_read_authorized') process.exitCode = 2;
  }
}
