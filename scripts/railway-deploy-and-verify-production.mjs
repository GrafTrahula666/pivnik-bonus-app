import { writeSync, appendFileSync } from 'node:fs';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const PROJECT_TOKEN = String(process.env.RAILWAY_TOKEN || '').trim();
const API_TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const COMMIT_SHA = String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const PROJECT_ID = RAILWAY_PRODUCTION.projectId;
const ENVIRONMENT_ID = RAILWAY_PRODUCTION.environmentId;
const SERVICES = Object.freeze({
  telegram: {
    id: RAILWAY_PRODUCTION.services.telegram,
    verifyUrl: String(process.env.TELEGRAM_SERVICE_VERIFY_URL || '').trim().replace(/\/+$/, '')
  },
  vk: {
    id: RAILWAY_PRODUCTION.services.vk,
    verifyUrl: String(process.env.VK_SERVICE_VERIFY_URL || '').trim().replace(/\/+$/, '')
  }
});
const TERMINAL_FAILURES = new Set(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']);
const POLL_INTERVAL_MS = 10_000;
const DEPLOY_TIMEOUT_MS = 15 * 60_000;
const HEALTH_TIMEOUT_MS = 8 * 60_000;

if (!PROJECT_TOKEN && !API_TOKEN) {
  throw new Error('RAILWAY_TOKEN (project token) or RAILWAY_API_TOKEN is required.');
}
if (!/^[0-9a-f]{40}$/i.test(COMMIT_SHA)) throw new Error('A full 40-character RELEASE_COMMIT_SHA is required.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const railwayAuthHeaders = API_TOKEN
  ? { authorization: `Bearer ${API_TOKEN}` }
  : { 'Project-Access-Token': PROJECT_TOKEN };

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    // Never forward the project-token header or an exact-SHA mutation to a redirect target.
    redirect: 'error',
    headers: {
      ...railwayAuthHeaders,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-deployer/1.1'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  if (response.redirected) throw new Error('Railway GraphQL redirect is not allowed.');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ')
      || `Railway API returned HTTP ${response.status}`);
  }
  return payload.data;
}

// REL-01: an exact-SHA manual dispatch must not run while either source can
// also deploy on push. This is a read-only provider query, not a settings
// change or proof of a staging rehearsal. Unknown/denied schema or status
// blocks dispatch. canEnable=true excludes an unavailable GitHub source.
async function verifyAutoDeployDisabled() {
  for (const [name, service] of Object.entries(SERVICES)) {
    let status;
    try {
      const data = await graphql(`
        query ProductionAutoDeployStatus($projectId: String!, $environmentId: String!, $serviceId: String!) {
          serviceInstanceAutoDeployStatus(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
            enabled
            canEnable
          }
        }
      `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: service.id });
      status = data?.serviceInstanceAutoDeployStatus;
    } catch {
      throw new Error(name + ': Railway auto-deploy status unavailable; stop and reconcile Railway before dispatch.');
    }
    if (status?.enabled !== false || status?.canEnable !== true) {
      throw new Error(name + ': Railway auto-deploy isolation not confirmed; stop and reconcile Railway before dispatch.');
    }
  }
  console.log('Railway reports auto-deploy disabled for both scoped production services.');
}

function readinessOrigin(value, serviceName) {
  // Only a canonical HTTPS origin, never a path, query, credentials or alternate port.
  let url;
  try { url = new URL(value); } catch { throw new Error(serviceName + ': invalid readiness HTTPS origin.'); }
  if (typeof value !== 'string' || !/^https:\/\/[^/?#\\]+\/?$/i.test(value) ||
      url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.href !== url.origin + '/') {
    throw new Error(serviceName + ': invalid readiness HTTPS origin.');
  }
  return url.origin;
}

async function servicePublicUrl(serviceName, service) {
  const data = await graphql(`
    query ProductionServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains { domain }
        customDomains { domain }
      }
    }
  `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: service.id });
  const domains = data?.domains;
  if (!Array.isArray(domains?.serviceDomains) || !Array.isArray(domains?.customDomains)) {
    throw new Error(serviceName + ': Railway domain inventory is missing or malformed.');
  }
  const registered = [...domains.serviceDomains, ...domains.customDomains].map(item => {
    if (typeof item?.domain !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(item.domain)) {
      throw new Error(serviceName + ': Railway returned an invalid public domain.');
    }
    return readinessOrigin('https://' + item.domain, serviceName);
  });
  if (!registered.length) throw new Error(serviceName + ': Railway returned no public domain.');
  if (!service.verifyUrl) return registered[0];
  const requested = readinessOrigin(service.verifyUrl, serviceName);
  if (!registered.includes(requested)) {
    throw new Error(serviceName + ': readiness origin is not registered to this Railway service.');
  }
  return requested;
}

function renderType(type) {
  if (!type) throw new Error('Railway mutation argument type is missing.');
  if (type.kind === 'NON_NULL') return `${renderType(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${renderType(type.ofType)}]`;
  if (!type.name) throw new Error(`Unsupported Railway GraphQL type: ${type.kind}`);
  return type.name;
}

function namedType(type) {
  let current = type;
  while (current?.ofType) current = current.ofType;
  return current || null;
}

async function deployMutationSchema() {
  const data = await graphql(`
    query DeployMutationSchema {
      __type(name: "Mutation") {
        fields(includeDeprecated: true) {
          name
          args {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType { kind name }
                }
              }
            }
          }
          type {
            kind
            name
            ofType {
              kind
              name
              ofType { kind name }
            }
          }
        }
      }
    }
  `);
  const field = data?.__type?.fields?.find((item) => item.name === 'serviceInstanceDeployV2');
  if (!field) throw new Error('Railway serviceInstanceDeployV2 mutation is unavailable.');
  const requiredArgs = ['serviceId', 'environmentId', 'commitSha'];
  for (const name of requiredArgs) {
    if (!field.args.some((item) => item.name === name)) {
      throw new Error(`Railway serviceInstanceDeployV2 has no ${name} argument.`);
    }
  }
  return field;
}

async function deployService(serviceName, service, schema) {
  const supplied = {
    serviceId: service.id,
    environmentId: ENVIRONMENT_ID,
    commitSha: COMMIT_SHA
  };
  const args = schema.args.filter((item) => Object.hasOwn(supplied, item.name));
  const definitions = args.map((item) => `$${item.name}: ${renderType(item.type)}`).join(', ');
  const invocation = args.map((item) => `${item.name}: $${item.name}`).join(', ');
  const returnType = namedType(schema.type);
  const selection = ['OBJECT', 'INTERFACE', 'UNION'].includes(returnType?.kind) ? ' { id }' : '';
  const data = await graphql(
    `mutation DeployExactCommit(${definitions}) { serviceInstanceDeployV2(${invocation})${selection} }`,
    Object.fromEntries(args.map((item) => [item.name, supplied[item.name]]))
  );
  const result = data?.serviceInstanceDeployV2;
  const deploymentId = typeof result === 'string' ? result : result?.id;
  if (!deploymentId) throw new Error(`${serviceName}: Railway returned no deployment ID.`);
  return deploymentId;
}

async function recentDeployments(serviceId) {
  const data = await graphql(`
    query RecentDeployments($input: DeploymentListInput!) {
      deployments(input: $input, first: 20) {
        edges {
          node { id status createdAt serviceId environmentId canRollback meta }
        }
      }
    }
  `, { input: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId } });
  return data?.deployments?.edges?.map((edge) => edge.node) || [];
}

async function waitForDeployment(serviceName, serviceId, deploymentId) {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  let lastStatus = 'UNKNOWN';
  while (Date.now() < deadline) {
    const deployment = (await recentDeployments(serviceId)).find((item) => item.id === deploymentId);
    lastStatus = deployment?.status || 'NOT_LISTED';
    console.log(`${serviceName}: deployment ${deploymentId} status=${lastStatus}`);
    if (lastStatus === 'SUCCESS') {
      // A returned ID and SUCCESS status alone do not attest the dispatched SHA.
      if (deployment.serviceId !== serviceId || deployment.environmentId !== ENVIRONMENT_ID ||
          typeof deployment.meta?.commitHash !== 'string' ||
          deployment.meta.commitHash.toLowerCase() !== COMMIT_SHA.toLowerCase()) {
        throw new Error(`${serviceName}: successful deployment identity or exact commit SHA mismatch; reconcile Railway before any retry or rollback.`);
      }
      return deployment;
    }
    if (TERMINAL_FAILURES.has(lastStatus)) {
      throw new Error(`${serviceName}: deployment ended with ${lastStatus}.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${serviceName}: deployment timed out with status ${lastStatus}.`);
}

async function fetchReadiness(serviceName, baseUrl) {
  const response = await fetch(`${baseUrl}/api/release-readiness`, {
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': 'pivnik-production-verifier/1.0' },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.redirected) throw new Error(`${serviceName}: readiness redirect is not allowed.`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${serviceName}: readiness HTTP ${response.status}.`);
  return body;
}

function readinessFailures(telegram, vk) {
  const failures = [];
  for (const [name, value] of [['Telegram', telegram], ['VK', vk]]) {
    if (value?.ok !== true) failures.push(`${name}: readiness endpoint is not ready`);
    if (value?.environment !== 'production') failures.push(`${name}: environment is not production`);
    if (typeof value?.databaseFingerprint !== 'string' || !value.databaseFingerprint.trim()) failures.push(`${name}: database fingerprint is missing`);
    if (value?.legalConfigured !== true) failures.push(`${name}: legal configuration is incomplete`);
    if (value?.identityTombstoneSecretConfigured !== true) failures.push(`${name}: tombstone secret is missing`);
    if (value?.releaseCommit !== COMMIT_SHA) failures.push(`${name}: release commit is ${value?.releaseCommit || 'missing'}`);
    if (value?.accountMode !== 'separate') failures.push(`${name}: account mode is not separate`);
    if (value?.unifiedAccounts !== false) failures.push(`${name}: unified accounts are still enabled`);
    if (value?.linkCodes !== false) failures.push(`${name}: account link codes are still enabled`);
    if (typeof value?.termsVersion !== 'string' || !value.termsVersion.trim()) failures.push(`${name}: terms version is missing or invalid`);
  }
  if (telegram?.databaseFingerprint !== vk?.databaseFingerprint) failures.push('VK and Telegram use different databases');
  if (telegram?.termsVersion !== vk?.termsVersion) failures.push('VK and Telegram expose different terms versions');
  return failures;
}

async function waitForSeparatedReadiness(serviceUrls) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastFailures = ['readiness has not been checked'];
  while (Date.now() < deadline) {
    try {
      const [telegram, vk] = await Promise.all([
        fetchReadiness('Telegram', serviceUrls.telegram),
        fetchReadiness('VK', serviceUrls.vk)
      ]);
      lastFailures = readinessFailures(telegram, vk);
      if (!lastFailures.length) return { telegram, vk };
      console.log(`Readiness pending: ${lastFailures.join('; ')}`);
    } catch (error) {
      lastFailures = [error?.message || String(error)];
      console.log(`Readiness pending: ${lastFailures[0]}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Separated-account readiness timed out: ${lastFailures.join('; ')}`);
}

const schema = await deployMutationSchema();
const serviceUrls = Object.fromEntries(await Promise.all(
  Object.entries(SERVICES).map(async ([name, service]) => [name, await servicePublicUrl(name, service)])
));
if (new Set(Object.values(serviceUrls)).size !== Object.keys(SERVICES).length) {
  throw new Error('Production readiness origins must be distinct for Telegram and VK.');
}
// Recovery evidence in the CI job log and (when configured) per-attempt JSONL.
// Neither is an atomic transaction or rollback approval.
function dispatchJournal(event, fields) {
  const record = JSON.stringify({
    event, releaseCommit: COMMIT_SHA, projectId: PROJECT_ID,
    environmentId: ENVIRONMENT_ID, ...fields
  }) + '\n';
  // Persist only structured recovery records, never arbitrary API/stdout output.
  // Fail closed before further mutations if the local journal cannot be written.
  const journalPath = process.env.PIVNIK_DISPATCH_JOURNAL_PATH;
  if (journalPath) appendFileSync(journalPath, record, { encoding: 'utf8', mode: 0o600, flush: true });
  const line = 'PIVNIK_DISPATCH_JOURNAL ' + record;
  if (writeSync(1, line) !== Buffer.byteLength(line)) {
    throw new Error('Incomplete dispatch journal write; stop and reconcile in Railway.');
  }
}

// Capture provider-reported rollback eligibility BEFORE either mutation.
// A historical SUCCESS alone does not establish current eligibility. Even
// canRollback=true is only an observation, not a rehearsed/approved rollback.
const rollbackCandidates = {};
for (const [name, service] of Object.entries(SERVICES)) {
  const candidates = (await recentDeployments(service.id))
    .filter(item => item?.status === 'SUCCESS' && item.canRollback === true &&
      item.serviceId === service.id && item.environmentId === ENVIRONMENT_ID &&
      typeof item.id === 'string' && item.id.trim() &&
      typeof item.meta?.commitHash === 'string' &&
      /^[0-9a-f]{40}$/i.test(item.meta.commitHash) &&
      typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)))
    .map(item => ({ deploymentId: item.id, createdAt: item.createdAt,
      sha: item.meta.commitHash.toLowerCase(), canRollback: true }));
  dispatchJournal('rollback_candidates_unverified', {
    service: name, serviceId: service.id, candidates
  });
  if (!candidates.length) throw new Error(name + ': no scoped SUCCESS candidate with provider canRollback=true; no dispatch attempted.');
  rollbackCandidates[name] = candidates;
}
// Two individually eligible records are not a coherent rollback target.
// Require an observed shared prior SHA; never select the candidate release
// itself as its own rollback. This is eligibility only, not approval/rehearsal.
const sharedRollbackShas = new Set(rollbackCandidates.telegram
  .filter(item => item.sha !== COMMIT_SHA.toLowerCase())
  .map(item => item.sha));
if (!rollbackCandidates.vk.some(item => sharedRollbackShas.has(item.sha))) {
  throw new Error('No common prior rollback SHA for both Railway services; no dispatch attempted.');
}

const deploymentIds = {};
for (const [name, service] of Object.entries(SERVICES)) {
  // Re-read both sources immediately before each mutation. If isolation is
  // lost after the first acceptance, its journal ID remains for reconciliation.
  await verifyAutoDeployDisabled();
  const scope = { service: name, serviceId: service.id };
  dispatchJournal('dispatch_started', { ...scope, acceptedDeployments: { ...deploymentIds } });
  let deploymentId;
  try {
    deploymentId = await deployService(name, service, schema);
  } catch {
    // A timeout or failed response can hide an accepted mutation. Do not retry.
    dispatchJournal('dispatch_outcome_unknown', { ...scope, acceptedDeployments: { ...deploymentIds } });
    throw new Error(name + ': dispatch outcome unknown; reconcile Railway before any retry or rollback.');
  }
  deploymentIds[name] = deploymentId;
  dispatchJournal('dispatch_accepted', { ...scope, deploymentId, acceptedDeployments: { ...deploymentIds } });
}
for (const [name, service] of Object.entries(SERVICES)) {
  await waitForDeployment(name, service.id, deploymentIds[name]);
}
const readiness = await waitForSeparatedReadiness(serviceUrls);

console.log(JSON.stringify({
  ok: true,
  accountMode: 'separate',
  releaseCommit: COMMIT_SHA,
  deployments: deploymentIds,
  serviceUrls,
  databaseFingerprint: readiness.telegram.databaseFingerprint,
  termsVersion: readiness.telegram.termsVersion,
  telegram: {
    ok: readiness.telegram.ok,
    environment: readiness.telegram.environment,
    releaseCommit: readiness.telegram.releaseCommit,
    accountMode: readiness.telegram.accountMode
  },
  vk: {
    ok: readiness.vk.ok,
    environment: readiness.vk.environment,
    releaseCommit: readiness.vk.releaseCommit,
    accountMode: readiness.vk.accountMode
  }
}, null, 2));
