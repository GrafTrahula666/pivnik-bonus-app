const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();
if (!token) throw new Error('RAILWAY_API_TOKEN is required.');

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-variable-introspect/1.0'
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

function unwrap(type) {
  const result = [];
  let current = type;
  while (current) {
    result.push({ kind: current.kind, name: current.name || null });
    current = current.ofType;
  }
  return result;
}

const data = await graphql(`
  query VariableApiSchema {
    queryType: __type(name: "Query") {
      fields {
        name
        args {
          name
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
    mutationType: __type(name: "Mutation") {
      fields {
        name
        args {
          name
          type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
        }
        type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
      }
    }
  }
`);

function relevant(type) {
  return (type?.fields || [])
    .filter((field) => /(variable|secret|environment.*config|service.*config)/i.test(field.name))
    .map((field) => ({
      name: field.name,
      args: (field.args || []).map((arg) => ({ name: arg.name, type: unwrap(arg.type) })),
      type: unwrap(field.type)
    }));
}

console.log(JSON.stringify({
  ok: true,
  queries: relevant(data.queryType),
  mutations: relevant(data.mutationType)
}, null, 2));
