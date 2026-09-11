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

test('v22 preflight has one deterministic canonicalization effect and then becomes a no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const gatewayPath = path.join(workspace, 'universal-server.js');
  const patchPath = path.join(workspace, 'scripts', 'apply-v22-preflight-fixes.mjs');
  const before = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(before.split(telegramOnlyMessage).length - 1, 2, 'raw canonical gateway must contain exactly two legacy Telegram-only wheel guards');
  assert.equal(before.includes(multilineDiamondFrame), true, 'raw canonical gateway must contain the pre-normalized diamond-frame helper');

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const once = await fs.readFile(gatewayPath, 'utf8');

  assert.notEqual(once, before);
  assert.equal(once.includes(telegramOnlyMessage), false, 'shared VK/TG wheel routes must not retain Telegram-only gateway guards');
  assert.equal(once.includes(multilineDiamondFrame), false);
  assert.equal(once.includes(normalizedDiamondFrame), true);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const twice = await fs.readFile(gatewayPath, 'utf8');

  assert.equal(twice, once, 'second v22-preflight execution must not change the already-normalized gateway');
});

test('v22 preflight intent is explicitly limited to wheel parity and frame-helper normalization', async () => {
  const patcher = await fs.readFile(new URL('../scripts/apply-v22-preflight-fixes.mjs', import.meta.url), 'utf8');

  assert.match(patcher, /removed !== 0 && removed !== 2/);
  assert.match(patcher, /Колесо доступно только в Telegram\./);
  assert.match(patcher, /normalizedDiamondFrame/);
  assert.doesNotMatch(patcher, /DATABASE_URL|from ['"]pg['"]|api\.telegram\.org|fetch\s*\(/);
});
