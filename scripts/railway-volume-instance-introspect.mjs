const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();
if (!token) throw new Error('RAILWAY_API_TOKEN is required.');

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-volume-introspect/1.0'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ') || `HTTP ${response.status}`);
  }
  return payload.data;
}

const unwrap = (type) => {
  const chain = [];
  let current = type;
  while (current) {
    chain.push({ kind: current.kind, name: current.name || null });
    current = current.ofType;
  }
  return chain;
};

const data = await graphql(`
  query PublicVolumeSchema {
    queryType: __type(name: "Query") {
      fields {
        name
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
    environmentType: __type(name: "Environment") {
      fields {
        name
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
    projectType: __type(name: "Project") {
      fields {
        name
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
  }
`);

function select(type) {
  return (type?.fields || [])
    .filter((field) => /(project|environment|volume|instance)/i.test(field.name))
    .map((field) => ({
      name: field.name,
      args: (field.args || []).map((arg) => ({ name: arg.name, type: unwrap(arg.type) })),
      type: unwrap(field.type)
    }));
}

console.log(JSON.stringify({
  query: select(data.queryType),
  environment: select(data.environmentType),
  project: select(data.projectType)
}, null, 2));
