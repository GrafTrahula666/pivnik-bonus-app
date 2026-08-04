const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();

if (!token) {
  console.error('RAILWAY_API_TOKEN is required.');
  process.exit(1);
}

async function railwayGraphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-railway-operator/1.0'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((item) => item.message).join('; ')
      || `Railway API returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload.data;
}

const data = await railwayGraphql(`
  query PivnikProjects {
    projects {
      edges {
        node {
          id
          name
          services {
            edges {
              node {
                id
                name
              }
            }
          }
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`);

const projects = data?.projects?.edges?.map((edge) => edge.node) || [];
const candidates = projects.filter((project) => {
  const names = new Set((project.services?.edges || []).map((edge) => edge.node?.name));
  return names.has('pivnik-bonus-app') || names.has('pivnik-vk-test');
});

if (!candidates.length) {
  console.error('Pivnik Railway project was not found for this account token.');
  process.exit(2);
}

const safeOutput = candidates.map((project) => ({
  projectId: project.id,
  projectName: project.name,
  environments: (project.environments?.edges || []).map((edge) => ({
    id: edge.node?.id,
    name: edge.node?.name
  })),
  services: (project.services?.edges || []).map((edge) => ({
    id: edge.node?.id,
    name: edge.node?.name
  }))
}));

console.log(JSON.stringify({ ok: true, projects: safeOutput }, null, 2));
