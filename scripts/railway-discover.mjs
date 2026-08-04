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
const safeProjects = projects.map((project) => ({
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

const candidates = safeProjects.filter((project) => {
  const haystack = [
    project.projectName,
    ...project.services.map((service) => service.name)
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes('pivnik') || haystack.includes('пивник');
});

console.log(JSON.stringify({
  ok: candidates.length > 0,
  matchedProjects: candidates,
  allAccessibleProjects: safeProjects
}, null, 2));

if (!candidates.length) {
  console.error('No accessible Railway project or service name contains "pivnik". The token is valid but is likely scoped to the wrong workspace.');
  process.exit(2);
}
