import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-startup-parity-'));
const read = (base, file) => fs.readFile(path.join(base, file), 'utf8');
function region(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Startup region missing: ${start}`);
  return source.slice(from, to);
}
async function snapshot(base) {
  const app = await read(base, 'app.js');
  const gateway = await read(base, 'universal-server.js');
  return {
    vk: await read(base, 'vk-platform.js'),
    accountLink: await read(base, 'account-link.js'),
    diagnostics: await read(base, 'vk-startup-diagnostics.js'),
    migrationPolicy: await read(base, 'migration-startup-policy.js'),
    migrationLoader: region(gateway, 'async function runSqlMigrations(client)', 'async function claimDataMigration('),
    storage: region(app, 'function localStorageKey(key)', 'const state = {'),
    boot: region(app, 'async function boot()', 'async function acceptTerms()'),
    auth: region(app, 'async function authenticate()', 'function renderCoreProfile()'),
    fetch: region(app, 'function timeoutError()', 'function openModal('),
    finish: region(app, 'async function finishBoot()', 'function updateNetworkBadge()'),
    retry: region(app, "$('#bootRetry')?.addEventListener", "$('#bootLite')?.addEventListener"),
    serverProfile: region(gateway, 'async function serveStartupProfile(', 'export const server ='),
    serverAssets: region(gateway, "if (req.method === 'GET' && url.pathname === '/vk-platform.js')",
      "if (req.method === 'GET' && url.pathname === '/legal/privacy')"),
    serverRoutes: region(gateway, "if (req.method === 'POST' && url.pathname === '/api/auth')",
      "if (req.method === 'GET' && url.pathname === '/api/wheel/status')")
  };
}
try {
  await fs.cp(root, temporary, { recursive: true, filter: (source) => {
    const parts = path.relative(root, source).split(path.sep);
    return !parts.some((part) => ['.git', 'node_modules', 'artifacts'].includes(part))
      && !parts.at(-1)?.startsWith('.env');
  } });
  await fs.symlink(await fs.realpath(path.join(root, 'node_modules')), path.join(temporary, 'node_modules'), 'dir');
  // No ambient application credentials: DB preparation and Telegram network repair
  // take their documented no-credentials exits. Every real prestart command runs.
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', LANG: 'C.UTF-8' };
  const pkg = JSON.parse(await read(temporary, 'package.json'));
  const canonical = await snapshot(root);
  for (const phase of ['prestart', 'prestart', 'materialize', 'prestart']) {
    for (const command of pkg.scripts[phase].split(' && ')) {
      const match = /^node (scripts\/[a-z0-9-]+\.mjs)$/.exec(command);
      assert.ok(match, `Unexpected lifecycle command: ${command}`);
      try {
        execFileSync(process.execPath, [match[1]], { cwd: temporary, env, timeout: 30_000, stdio: 'pipe' });
      } catch (error) {
        const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString('utf8') : String(error?.stdout || '');
        const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr || '');
        console.error(`VK startup parity lifecycle command failed: ${phase} -> ${command}`);
        if (stdout.trim()) console.error(`stdout:\n${stdout.trimEnd()}`);
        if (stderr.trim()) console.error(`stderr:\n${stderr.trimEnd()}`);
        throw error;
      }
    }
    assert.deepEqual(await snapshot(temporary), canonical, `${phase} changed canonical VK startup code`);
    console.log(`VK startup parity passed: ${phase}`);
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
