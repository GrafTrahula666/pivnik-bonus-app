import { createHash, randomBytes } from 'node:crypto';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const PROJECT_ID = RAILWAY_PRODUCTION.projectId;
const ENVIRONMENT_ID = RAILWAY_PRODUCTION.environmentId;
const SERVICES = Object.freeze({
  telegram: RAILWAY_PRODUCTION.services.telegram,
  vk: RAILWAY_PRODUCTION.services.vk
});

if (!TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function strongSecret() {
  return randomBytes(48).toString('base64url');
}

async function graphql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-production-secret-sync/1.0'
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

async function variables(serviceId) {
  const data = await graphql(`
    query Variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(
        projectId: $projectId
        environmentId: $environmentId
        serviceId: $serviceId
        unrendered: true
      )
    }
  `, { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId });
  if (!data?.variables || typeof data.variables !== 'object' || Array.isArray(data.variables)) {
    throw new Error(`Railway returned invalid variables for ${serviceId}.`);
  }
  return data.variables;
}

async function upsert(serviceId, values) {
  const data = await graphql(`
    mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `, {
    input: {
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      serviceId,
      variables: values,
      skipDeploys: true
    }
  });
  if (data?.variableCollectionUpsert !== true) {
    throw new Error('Railway did not confirm variableCollectionUpsert.');
  }
}

const before = {
  telegram: await variables(SERVICES.telegram),
  vk: await variables(SERVICES.vk)
};

const sessionSecret = String(before.telegram.SESSION_SECRET || before.vk.SESSION_SECRET || '').trim() || strongSecret();
const tombstoneSecret = String(before.telegram.IDENTITY_TOMBSTONE_SECRET || before.vk.IDENTITY_TOMBSTONE_SECRET || '').trim() || strongSecret();
if (sessionSecret.length < 32 || tombstoneSecret.length < 32 || sessionSecret === tombstoneSecret) {
  throw new Error('Resolved production secrets are weak or identical.');
}

const common = {
  SESSION_SECRET: sessionSecret,
  IDENTITY_TOMBSTONE_SECRET: tombstoneSecret,
  NODE_ENV: 'production',
  ALLOW_DEMO: 'false'
};

await upsert(SERVICES.telegram, common);
await upsert(SERVICES.vk, common);

const after = {
  telegram: await variables(SERVICES.telegram),
  vk: await variables(SERVICES.vk)
};
for (const [key, value] of Object.entries(common)) {
  if (String(after.telegram[key] ?? '') !== String(value)
      || String(after.vk[key] ?? '') !== String(value)) {
    throw new Error(`Railway secret synchronization failed for ${key}.`);
  }
}

console.log(JSON.stringify({
  ok: true,
  generatedSessionSecret: !String(before.telegram.SESSION_SECRET || before.vk.SESSION_SECRET || '').trim(),
  generatedIdentityTombstoneSecret: !String(before.telegram.IDENTITY_TOMBSTONE_SECRET || before.vk.IDENTITY_TOMBSTONE_SECRET || '').trim(),
  sessionSecretFingerprint: digest(sessionSecret),
  identityTombstoneSecretFingerprint: digest(tombstoneSecret),
  synchronizedServices: ['telegram', 'vk'],
  deployTriggered: false
}, null, 2));
