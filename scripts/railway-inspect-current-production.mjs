import { createHash } from 'node:crypto';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();

const PROJECT_ID = RAILWAY_PRODUCTION.projectId;
const ENVIRONMENT_ID = RAILWAY_PRODUCTION.environmentId;
const SERVICES = Object.freeze({
  telegram: RAILWAY_PRODUCTION.services.telegram,
  vk: RAILWAY_PRODUCTION.services.vk
});

if (!token) throw new Error('RAILWAY_API_TOKEN is required.');

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-inspector/1.0'
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

function digest(value) {
  const text = String(value || '');
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null;
}

function publicUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.origin : '[NON_HTTPS]';
  } catch {
    return '[INVALID_URL]';
  }
}

const project = await graphql(`
  query InspectPivnikProject($projectId: String!) {
    project(id: $projectId) {
      id
      name
      services { edges { node { id name } } }
      environments { edges { node { id name } } }
    }
  }
`, { projectId: PROJECT_ID });

const report = {
  project: project?.project,
  environmentId: ENVIRONMENT_ID,
  services: {}
};

for (const [name, serviceId] of Object.entries(SERVICES)) {
  const [domainData, variableData, deploymentData] = await Promise.all([
    graphql(`
      query InspectPivnikDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          serviceDomains { id domain targetPort }
          customDomains { id domain }
        }
      }
    `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId }),
    graphql(`
      query InspectPivnikVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }
    `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId }),
    graphql(`
      query InspectPivnikDeployments($input: DeploymentListInput!) {
        deployments(input: $input, first: 5) {
          edges { node { id status createdAt } }
        }
      }
    `, { input: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId } })
  ]);

  const variables = variableData?.variables || {};
  const variableKeys = Object.keys(variables).sort();
  report.services[name] = {
    id: serviceId,
    domains: domainData?.domains || null,
    deployments: deploymentData?.deployments?.edges?.map((edge) => edge.node) || [],
    variableKeys,
    databaseFingerprint: digest(variables.DATABASE_URL),
    sessionSecretFingerprint: digest(variables.SESSION_SECRET),
    publicUrls: {
      TELEGRAM_APP_URL: publicUrl(variables.TELEGRAM_APP_URL),
      VK_APP_URL: publicUrl(variables.VK_APP_URL),
      PIVNIK_APP_URL: publicUrl(variables.PIVNIK_APP_URL),
      PIVNIK_ALLOWED_ORIGINS: String(variables.PIVNIK_ALLOWED_ORIGINS || '')
        .split(',')
        .map(publicUrl)
        .filter(Boolean)
    },
    required: {
      NODE_ENV: variables.NODE_ENV || null,
      ALLOW_DEMO: variables.ALLOW_DEMO || null,
      DATABASE_URL: Boolean(variables.DATABASE_URL),
      SESSION_SECRET: String(variables.SESSION_SECRET || '').length >= 32,
      IDENTITY_TOMBSTONE_SECRET: String(variables.IDENTITY_TOMBSTONE_SECRET || '').length >= 32,
      TELEGRAM_BOT_TOKEN: Boolean(variables.TELEGRAM_BOT_TOKEN),
      VK_APP_ID: variables.VK_APP_ID || null,
      VK_APP_SECRET: Boolean(variables.VK_APP_SECRET),
      PIVNIK_DOCUMENT_PLATFORM: variables.PIVNIK_DOCUMENT_PLATFORM || null
    }
  };
}

console.log(JSON.stringify(report, null, 2));
