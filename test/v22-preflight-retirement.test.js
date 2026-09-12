import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const telegramOnlyMessage = 'Колесо доступно только в Telegram.';
const multilineDiamondFrame = `  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') {\n    frames.push({ code: 'diamond', title: 'Алмазная рамка' });\n  }\n  return frames;`;
const normalizedDiamondFrame = `  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') frames.push({ code: 'diamond', title: 'Алмазная рамка' });\n  return frames;`;

function canonicalGatewayFromHead() {
  return execFileSync('git', ['show', 'HEAD:universal-server.js'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function makeProofWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-v22-preflight-proof-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(workspace, 'universal-server.js'), canonicalGatewayFromHead(), 'utf8'),
    fs.copyFile(
      new URL('../scripts/apply-v22-preflight-fixes.mjs', import.meta.url),
      path.join(workspace, 'scripts', 'apply-v22-preflight-fixes.mjs')
    )
  ]);
  return workspace;
}

test('v22 preflight behavior is canonical and the legacy patcher is a byte-for-byte no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const gatewayPath = path.join(workspace, 'universal-server.js');
  const patchPath = path.join(workspace, 'scripts', 'apply-v22-preflight-fixes.mjs');
  const before = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(before.includes(telegramOnlyMessage), false, 'canonical gateway must expose the shared VK/TG wheel routes');
  assert.equal(before.includes(multilineDiamondFrame), false, 'canonical gateway must not retain the pre-normalized diamond-frame helper');
  assert.equal(before.includes(normalizedDiamondFrame), true, 'canonical gateway must contain the normalized diamond-frame helper');

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const after = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(after, before, 'retired v22-preflight patcher must not mutate canonical universal-server.js');
});

test('legacy v22 preflight remains limited to wheel parity and frame-helper normalization', async () => {
  const patcher = await fs.readFile(new URL('../scripts/apply-v22-preflight-fixes.mjs', import.meta.url), 'utf8');

  assert.match(patcher, /removed !== 0 && removed !== 2/);
  assert.match(patcher, /Колесо доступно только в Telegram\./);
  assert.match(patcher, /normalizedDiamondFrame/);
  assert.doesNotMatch(patcher, /DATABASE_URL|from ['"]pg['"]|api\.telegram\.org|fetch\s*\(/);
});
