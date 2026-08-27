const RAILWAY_ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const RAILWAY_TOKEN = String(process.env.RAILWAY_API_TOKEN || '').trim();
const PROJECT_ID = '20a942f9-3164-484a-a6f1-565439e38705';
const ENVIRONMENT_ID = 'cdd9d26c-2aab-45d9-95ed-ef487fafaa8f';
const POSTGRES_SERVICE_ID = '4f0c39c3-cd84-4f41-a97e-c95b342653c4';

if (!RAILWAY_TOKEN) throw new Error('RAILWAY_API_TOKEN is required.');

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(RAILWAY_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${RAILWAY_TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-v22-readonly-audit/1.0'
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

const data = await railwayGraphql(`
  query ServiceVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
    variables(
      projectId: $projectId
      environmentId: $environmentId
      serviceId: $serviceId
      unrendered: false
    )
  }
`, {
  projectId: PROJECT_ID,
  environmentId: ENVIRONMENT_ID,
  serviceId: POSTGRES_SERVICE_ID
});

const variables = data?.variables;
if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
  throw new Error('Railway returned invalid Postgres variables.');
}

const publicUrl = String(variables.DATABASE_PUBLIC_URL || '').trim();
if (!publicUrl) throw new Error('DATABASE_PUBLIC_URL is unavailable for the production Postgres service.');

// Do not print the connection string. The imported script is read-only unless an
// exact repair confirmation variable is set; this workflow intentionally never sets it.
process.env.DATABASE_URL = publicUrl;
delete process.env.PIVNIK_V22_REPAIR_CONFIRM;
await import(`./v22-data-audit-and-repair.mjs?railway-readonly=${Date.now()}`);
