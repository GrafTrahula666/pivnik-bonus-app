import { execFileSync, spawnSync } from 'node:child_process';

const PROJECT_ID = '9a940d7a-b0b0-4893-a90d-1b0a8b6850d5';
const ENVIRONMENT_ID = 'aa461df9-1dbb-4000-8906-f13dd8008a6f';
const WORKSPACE_ID = 'fbffb30c-9091-432f-9e09-9c59e1440304';
const databases = {
  telegramCanonical: 'beb858e1-c412-42b8-b570-bda36ca82b59',
  vkLegacy: 'de5da1be-76c1-4976-a88c-efcce93600e6'
};

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

function sanitize(text) {
  return String(text || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(password|secret|token)(["'\s:=]+)[^\s,"'<>]+/gi, '$1$2[REDACTED]')
    .slice(0, 20_000);
}

railway([
  'link',
  '--project', PROJECT_ID,
  '--environment', ENVIRONMENT_ID,
  '--workspace', WORKSPACE_ID,
  '--json'
]);

const results = {};
for (const [name, serviceId] of Object.entries(databases)) {
  const vars = parseVariables(railway([
    'variable', 'list',
    '--service', serviceId,
    '--environment', ENVIRONMENT_ID,
    '--json'
  ]));
  const publicUrl = String(vars.DATABASE_PUBLIC_URL || '').trim();
  if (!publicUrl) {
    results[name] = { ok: false, error: 'DATABASE_PUBLIC_URL is not configured' };
    continue;
  }

  const child = spawnSync(process.execPath, ['scripts/verify-production-database.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: publicUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024
  });

  results[name] = {
    ok: child.status === 0,
    exitCode: child.status,
    stdout: sanitize(child.stdout),
    stderr: sanitize(child.stderr)
  };
}

console.log(JSON.stringify({ ok: Object.values(results).every((item) => item.ok), databases: results }, null, 2));
process.exitCode = Object.values(results).every((item) => item.ok) ? 0 : 2;
