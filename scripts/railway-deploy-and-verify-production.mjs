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
    headers: {
      ...railwayAuthHeaders,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-deployer/1.1'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ')
      || `Railway API returned HTTP ${response.status}`);
  }
  return payload.data;
}

async function servicePublicUrl(serviceName, service) {
  if (service.verifyUrl) return service.verifyUrl;
  const data = await graphql(`
    query ProductionServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        serviceDomains { domain }
        customDomains { domain }
      }
    }
  `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: service.id });
  const domains = data?.domains;
  const domain = domains?.serviceDomains?.[0]?.domain || domains?.customDomains?.[0]?.domain;
  if (!domain) throw new Error(`${serviceName}: Railway returned no public domain.`);
  return `https://${domain}`;
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
          node { id status createdAt }
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
    if (lastStatus === 'SUCCESS') return deployment;
    if (TERMINAL_FAILURES.has(lastStatus)) {
      throw new Error(`${serviceName}: deployment ended with ${lastStatus}.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`${serviceName}: deployment timed out with status ${lastStatus}.`);
}

async function fetchReadiness(serviceName, baseUrl) {
  const response = await fetch(`${baseUrl}/api/release-readiness`, {
    headers: { accept: 'application/json', 'user-agent': 'pivnik-production-verifier/1.0' },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${serviceName}: readiness HTTP ${response.status}.`);
  return body;
}

function readinessFailures(telegram, vk) {
  const failures = [];
  for (const [name, value] of [['Telegram', telegram], ['VK', vk]]) {
    if (!value?.ok) failures.push(`${name}: readiness endpoint is not ready`);
    if (value?.environment !== 'production') failures.push(`${name}: environment is not production`);
    if (!value?.databaseFingerprint) failures.push(`${name}: database fingerprint is missing`);
    if (!value?.legalConfigured) failures.push(`${name}: legal configuration is incomplete`);
    if (!value?.identityTombstoneSecretConfigured) failures.push(`${name}: tombstone secret is missing`);
    if (value?.releaseCommit !== COMMIT_SHA) failures.push(`${name}: release commit is ${value?.releaseCommit || 'missing'}`);
    if (value?.accountMode !== 'separate') failures.push(`${name}: account mode is not separate`);
    if (value?.unifiedAccounts !== false) failures.push(`${name}: unified accounts are still enabled`);
    if (value?.linkCodes !== false) failures.push(`${name}: account link codes are still enabled`);
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
const deploymentIds = {};
for (const [name, service] of Object.entries(SERVICES)) {
  deploymentIds[name] = await deployService(name, service, schema);
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
