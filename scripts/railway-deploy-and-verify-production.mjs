const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const COMMIT_SHA = String(process.env.RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const SERVICES = Object.freeze({
  telegram: {
    id: '4c4d5f11-e3af-4ffb-8ae9-21a8854b6c90',
    url: String(process.env.TELEGRAM_APP_URL || 'https://pivnik-bonus-app-production.up.railway.app').replace(/\/+$/, '')
  },
  vk: {
    id: '61352beb-78fe-4293-939c-c1f93294b204',
    url: String(process.env.VK_APP_URL || 'https://pivnik-vk-test-production.up.railway.app').replace(/\/+$/, '')
  }
});
const TERMINAL_FAILURES = new Set(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED']);
const POLL_INTERVAL_MS = 10_000;
const DEPLOY_TIMEOUT_MS = 15 * 60_000;
const HEALTH_TIMEOUT_MS = 8 * 60_000;

if (!TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');
if (!/^[0-9a-f]{40}$/i.test(COMMIT_SHA)) throw new Error('A full 40-character RELEASE_COMMIT_SHA is required.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-deployer/1.0'
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
  `, { input: { projectId: PROJECT_ID, serviceId } });
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
  }
  if (telegram?.databaseFingerprint !== vk?.databaseFingerprint) failures.push('VK and Telegram use different databases');
  if (telegram?.termsVersion !== vk?.termsVersion) failures.push('VK and Telegram expose different terms versions');
  return failures;
}

async function waitForUnifiedReadiness() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastFailures = ['readiness has not been checked'];
  while (Date.now() < deadline) {
    try {
      const [telegram, vk] = await Promise.all([
        fetchReadiness('Telegram', SERVICES.telegram.url),
        fetchReadiness('VK', SERVICES.vk.url)
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
  throw new Error(`Unified readiness timed out: ${lastFailures.join('; ')}`);
}

const schema = await deployMutationSchema();
const deploymentIds = {};
for (const [name, service] of Object.entries(SERVICES)) {
  deploymentIds[name] = await deployService(name, service, schema);
}
for (const [name, service] of Object.entries(SERVICES)) {
  await waitForDeployment(name, service.id, deploymentIds[name]);
}
const readiness = await waitForUnifiedReadiness();

console.log(JSON.stringify({
  ok: true,
  releaseCommit: COMMIT_SHA,
  deployments: deploymentIds,
  databaseFingerprint: readiness.telegram.databaseFingerprint,
  termsVersion: readiness.telegram.termsVersion,
  telegram: {
    ok: readiness.telegram.ok,
    environment: readiness.telegram.environment,
    releaseCommit: readiness.telegram.releaseCommit
  },
  vk: {
    ok: readiness.vk.ok,
    environment: readiness.vk.environment,
    releaseCommit: readiness.vk.releaseCommit
  }
}, null, 2));
