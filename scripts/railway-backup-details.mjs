const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();

if (!token) {
  console.error('RAILWAY_API_TOKEN is required.');
  process.exit(1);
}

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-railway-backup-details/1.0'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((item) => item.message).join('; ') || `HTTP ${response.status}`);
  }
  return payload.data;
}

const typeRef = `
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
`;

const data = await graphql(`
  query BackupDetails {
    __schema {
      queryType {
        fields {
          name
          type { ${typeRef} }
        }
      }
      mutationType {
        fields {
          name
          type { ${typeRef} }
        }
      }
      types {
        kind
        name
        fields {
          name
          type { ${typeRef} }
        }
        inputFields {
          name
          type { ${typeRef} }
        }
      }
    }
  }
`);

const schema = data.__schema;
const relevantFieldNames = new Set([
  'adminVolumeInstancesForVolume',
  'volumeInstance',
  'volumeInstanceBackupList',
  'volumeInstanceBackupCreate',
  'volumeInstanceBackupLock'
]);

const simplifyType = (type) => {
  const parts = [];
  let current = type;
  while (current) {
    parts.push({ kind: current.kind, name: current.name });
    current = current.ofType;
  }
  return parts;
};

const fields = [
  ...(schema.queryType?.fields || []).map((field) => ({ root: 'query', ...field })),
  ...(schema.mutationType?.fields || []).map((field) => ({ root: 'mutation', ...field }))
]
  .filter((field) => relevantFieldNames.has(field.name))
  .map((field) => ({ root: field.root, name: field.name, type: simplifyType(field.type) }));

const types = (schema.types || [])
  .filter((type) => /VolumeInstance|Backup/i.test(type.name || ''))
  .map((type) => ({
    kind: type.kind,
    name: type.name,
    fields: (type.fields || []).map((field) => ({ name: field.name, type: simplifyType(field.type) })),
    inputFields: (type.inputFields || []).map((field) => ({ name: field.name, type: simplifyType(field.type) }))
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log(JSON.stringify({ fields, types }, null, 2));
