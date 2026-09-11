import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const marker = '// PIVNIK_V22_PRODUCTION_POLISH_20260827';
const rawPhotoUpdate = `               photo_url = $5,\n               language_code = $6,`;
const safePhotoUpdate = `               photo_url = COALESCE($5, photo_url),\n               language_code = $6,`;
const rawIdentityUpdate = `           provider_username = EXCLUDED.provider_username,\n           profile_url = EXCLUDED.profile_url,\n           updated_at = NOW()`;
const safeIdentityUpdate = `           provider_username = COALESCE(EXCLUDED.provider_username, user_identities.provider_username),\n           profile_url = COALESCE(EXCLUDED.profile_url, user_identities.profile_url),\n           updated_at = NOW()`;

function canonicalGatewayFromHead() {
  return execFileSync('git', ['show', 'HEAD:universal-server.js'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function makeProofWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-v22-polish-proof-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(workspace, 'universal-server.js'), canonicalGatewayFromHead(), 'utf8'),
    fs.copyFile(
      new URL('../scripts/apply-v22-production-polish.mjs', import.meta.url),
      path.join(workspace, 'scripts', 'apply-v22-production-polish.mjs')
    )
  ]);
  return workspace;
}

test('v22 production polish preserves profile metadata deterministically and then becomes a no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const gatewayPath = path.join(workspace, 'universal-server.js');
  const patchPath = path.join(workspace, 'scripts', 'apply-v22-production-polish.mjs');
  const before = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(before.includes(marker), false, 'raw canonical gateway must not already contain the v22 production-polish marker');
  assert.equal(before.includes(rawPhotoUpdate), true, 'raw canonical login update must still overwrite photo_url directly');
  assert.equal(before.includes(rawIdentityUpdate), true, 'raw canonical identity upsert must still overwrite nullable profile metadata directly');

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const once = await fs.readFile(gatewayPath, 'utf8');

  assert.notEqual(once, before);
  assert.equal(once.includes(rawPhotoUpdate), false);
  assert.equal(once.includes(rawIdentityUpdate), false);
  assert.equal(once.includes(safePhotoUpdate), true);
  assert.equal(once.includes(safeIdentityUpdate), true);
  assert.equal(once.includes(marker), true);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const twice = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(twice, once, 'second v22 production-polish execution must not change the already-polished gateway');
});

test('v22 production polish remains a source-only metadata-preservation patch', async () => {
  const patcher = await fs.readFile(new URL('../scripts/apply-v22-production-polish.mjs', import.meta.url), 'utf8');

  assert.match(patcher, /COALESCE\(\$5, photo_url\)/);
  assert.match(patcher, /COALESCE\(EXCLUDED\.provider_username, user_identities\.provider_username\)/);
  assert.match(patcher, /COALESCE\(EXCLUDED\.profile_url, user_identities\.profile_url\)/);
  assert.doesNotMatch(patcher, /DATABASE_URL|from ['"]pg['"]|api\.telegram\.org|fetch\s*\(/);
});
