import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const PROJECT_ID = RAILWAY_PRODUCTION.projectId;
const ENVIRONMENT_ID = RAILWAY_PRODUCTION.environmentId;
const WORKSPACE_ID = 'fbffb30c-9091-432f-9e09-9c59e1440304';

const services = {
  telegram: RAILWAY_PRODUCTION.services.telegram,
  vk: RAILWAY_PRODUCTION.services.vk,
  postgres: RAILWAY_PRODUCTION.services.postgres
};

const requiredCommon = [
  'NODE_ENV',
  'ALLOW_DEMO',
  'DATABASE_URL',
  'SESSION_SECRET',
  'IDENTITY_TOMBSTONE_SECRET',
  'LEGAL_OPERATOR_NAME',
  'LEGAL_OPERATOR_ID',
  'LEGAL_CONTACT_EMAIL',
  'LEGAL_OPERATOR_ADDRESS',
  'LEGAL_DATA_RETENTION_POLICY'
];

function railway(args) {
  return execFileSync('railway', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024
  });
}

function parseVariables(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return Object.fromEntries(parsed.map((item) => [item.name ?? item.key, item.value ?? '']));
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.variables && typeof parsed.variables === 'object') return parsed.variables;
    return parsed;
  }
  return {};
}

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function safeReference(value) {
  const text = String(value ?? '');
  const match = text.match(/^\$\{\{([^}]+)\}\}$/);
  return match ? match[1] : null;
}

railway([
  'link',
  '--project', PROJECT_ID,
  '--environment', ENVIRONMENT_ID,
  '--workspace', WORKSPACE_ID,
  '--json'
]);

const variables = {};
for (const [name, serviceId] of Object.entries(services)) {
  const raw = railway([
    'variable', 'list',
    '--service', serviceId,
    '--environment', ENVIRONMENT_ID,
    '--json'
  ]);
  variables[name] = parseVariables(raw);
}

const safeServices = {};
for (const [name, vars] of Object.entries(variables)) {
  const keys = Object.keys(vars).sort();
  const references = {};
  for (const key of keys) {
    const ref = safeReference(vars[key]);
    if (ref) references[key] = ref;
  }
  safeServices[name] = {
    variableCount: keys.length,
    keys,
    references,
    missingCommon: ['telegram', 'vk'].includes(name)
      ? requiredCommon.filter((key) => !String(vars[key] ?? '').trim())
      : []
  };
}

const comparisons = {};
for (const key of requiredCommon) {
  const telegramValue = variables.telegram[key];
  const vkValue = variables.vk[key];
  comparisons[key] = {
    telegramPresent: Boolean(String(telegramValue ?? '').trim()),
    vkPresent: Boolean(String(vkValue ?? '').trim()),
    sameValue: Boolean(String(telegramValue ?? '').trim())
      && Boolean(String(vkValue ?? '').trim())
      && digest(telegramValue) === digest(vkValue),
    telegramReference: safeReference(telegramValue),
    vkReference: safeReference(vkValue)
  };
}

console.log(JSON.stringify({
  ok: true,
  projectId: PROJECT_ID,
  environmentId: ENVIRONMENT_ID,
  services: safeServices,
  comparisons
}, null, 2));
