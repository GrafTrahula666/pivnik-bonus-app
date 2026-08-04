const endpoint = 'https://backboard.railway.com/graphql/v2';
const token = String(process.env.RAILWAY_API_TOKEN || '').trim();
const projectId = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const environmentId = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';

if (!token) {
  console.error('RAILWAY_API_TOKEN is required.');
  process.exit(1);
}

const targets = [
  {
    label: 'telegramCanonical',
    volumeId: 'a22bee3f-45f7-4463-af51-c4a3a97dddb0',
    backupName: 'pivnik-pre-unification-telegram-2026-08-04'
  },
  {
    label: 'vkLegacy',
    volumeId: 'c543dc9c-166f-4f51-8e72-a9bf45a008b6',
    backupName: 'pivnik-pre-unification-vk-2026-08-04'
  }
];

async function graphql(query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'pivnik-release-backup/1.0'
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

const workflowType = await graphql(`
  query WorkflowIdType {
    __type(name: "WorkflowId") {
      fields {
        name
        type { kind name ofType { kind name } }
      }
    }
  }
`);

const workflowFields = (workflowType.__type?.fields || [])
  .filter((field) => {
    const kind = field.type?.kind === 'NON_NULL' ? field.type?.ofType?.kind : field.type?.kind;
    return kind === 'SCALAR' || kind === 'ENUM';
  })
  .map((field) => field.name);

if (!workflowFields.length) {
  throw new Error('Railway WorkflowId type has no scalar fields available for mutation selection.');
}

async function getProductionVolumeInstances() {
  const data = await graphql(`
    query ProductionVolumeInstances($projectId: String!, $environmentId: String!) {
      environment(id: $environmentId, projectId: $projectId) {
        volumeInstances(first: 100) {
          edges {
            node {
              id
              environmentId
              serviceId
              volumeId
              state
            }
          }
        }
      }
    }
  `, { projectId, environmentId });

  return (data.environment?.volumeInstances?.edges || [])
    .map((edge) => edge?.node)
    .filter(Boolean);
}

const productionVolumeInstances = await getProductionVolumeInstances();

function getInstance(volumeId) {
  const active = productionVolumeInstances.find((item) => (
    item.volumeId === volumeId
    && item.environmentId === environmentId
    && item.state !== 'DELETED'
  ));
  if (!active) throw new Error(`No active production volume instance found for volume ${volumeId}.`);
  return active;
}

async function listBackups(volumeInstanceId) {
  const data = await graphql(`
    query Backups($volumeInstanceId: String!) {
      volumeInstanceBackupList(volumeInstanceId: $volumeInstanceId) {
        id
        name
        createdAt
        expiresAt
        usedMB
        referencedMB
        volumeInstanceSizeMB
      }
    }
  `, { volumeInstanceId });
  return data.volumeInstanceBackupList || [];
}

async function createBackup(volumeInstanceId, name) {
  const selection = workflowFields.join('\n');
  const data = await graphql(`
    mutation CreateBackup($volumeInstanceId: String!, $name: String!) {
      volumeInstanceBackupCreate(volumeInstanceId: $volumeInstanceId, name: $name) {
        ${selection}
      }
    }
  `, { volumeInstanceId, name });
  return data.volumeInstanceBackupCreate;
}

async function lockBackup(volumeInstanceId, backupId) {
  const data = await graphql(`
    mutation LockBackup($volumeInstanceId: String!, $backupId: String!) {
      volumeInstanceBackupLock(
        volumeInstanceId: $volumeInstanceId
        volumeInstanceBackupId: $backupId
      )
    }
  `, { volumeInstanceId, backupId });
  return data.volumeInstanceBackupLock === true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

for (const target of targets) {
  const instance = getInstance(target.volumeId);
  let backups = await listBackups(instance.id);
  let backup = backups.find((item) => item.name === target.backupName);
  let created = false;

  if (!backup) {
    await createBackup(instance.id, target.backupName);
    created = true;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(4_000);
      backups = await listBackups(instance.id);
      backup = backups.find((item) => item.name === target.backupName);
      if (backup) break;
    }
  }

  if (!backup) throw new Error(`Backup ${target.backupName} was not visible after creation.`);

  const locked = await lockBackup(instance.id, backup.id);
  const verified = (await listBackups(instance.id)).find((item) => item.id === backup.id);
  if (!locked || !verified) throw new Error(`Backup ${target.backupName} could not be locked or verified.`);

  results.push({
    label: target.label,
    volumeId: target.volumeId,
    volumeInstanceId: instance.id,
    backupId: backup.id,
    backupName: backup.name,
    created,
    locked,
    createdAt: backup.createdAt,
    expiresAt: verified.expiresAt,
    usedMB: verified.usedMB,
    referencedMB: verified.referencedMB,
    volumeInstanceSizeMB: verified.volumeInstanceSizeMB
  });
}

console.log(JSON.stringify({ ok: true, backups: results }, null, 2));
