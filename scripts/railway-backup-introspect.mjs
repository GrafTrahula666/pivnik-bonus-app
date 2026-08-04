const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();

if (!token) {
  console.error('RAILWAY_API_TOKEN is required.');
  process.exit(1);
}

async function query(graphql, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-railway-backup-introspect/1.0'
    },
    body: JSON.stringify({ query: graphql, variables }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ') || `HTTP ${response.status}`);
  }
  return payload.data;
}

const schema = await query(`
  query BackupSchema {
    __schema {
      queryType { fields { name args { name type { kind name ofType { kind name } } } } }
      mutationType { fields { name args { name type { kind name ofType { kind name } } } } }
    }
  }
`);

function simplify(fields = []) {
  return fields
    .filter((field) => /backup|volume/i.test(field.name))
    .map((field) => ({
      name: field.name,
      args: field.args.map((arg) => ({
        name: arg.name,
        type: arg.type.name || arg.type.ofType?.name || arg.type.kind
      }))
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

console.log(JSON.stringify({
  queries: simplify(schema.__schema.queryType?.fields),
  mutations: simplify(schema.__schema.mutationType?.fields)
}, null, 2));
