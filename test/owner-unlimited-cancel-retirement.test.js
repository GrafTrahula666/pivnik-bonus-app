import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function makeProofWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-owner-cancel-proof-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
  await Promise.all([
    fs.copyFile(new URL('../server.js', import.meta.url), path.join(workspace, 'server.js')),
    fs.copyFile(
      new URL('../scripts/apply-owner-unlimited-cancel.mjs', import.meta.url),
      path.join(workspace, 'scripts', 'apply-owner-unlimited-cancel.mjs')
    )
  ]);
  return workspace;
}

test('owner unlimited cancellation patch has a deterministic one-time effect and then becomes a no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const serverPath = path.join(workspace, 'server.js');
  const patchPath = path.join(workspace, 'scripts', 'apply-owner-unlimited-cancel.mjs');
  const before = await fs.readFile(serverPath, 'utf8');

  assert.equal(before.includes('// V21 · owner unlimited cancellation'), false);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const once = await fs.readFile(serverPath, 'utf8');

  assert.notEqual(once, before);
  assert.match(once, /\/\/ V21 · owner unlimited cancellation/);
  assert.match(once, /function unlimitedCancellationQuota\(\)/);
  assert.match(once, /const ownerUnlimitedCancel = actingStaff\.role === 'admin';/);
  assert.match(once, /ownerUnlimitedCancel \? unlimitedCancellationQuota\(\) : await getCancellationQuota\(actingStaff\.id\)/);
  assert.match(once, /ownerUnlimitedCancel \? \{\} : \{ staffId: actingStaff\.id, notBefore: quota\.countFrom \}/);
  assert.match(once, /actingStaff\.role === 'admin' \? unlimitedCancellationQuota\(\) : await getCancellationQuota\(actingStaff\.id\)/);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const twice = await fs.readFile(serverPath, 'utf8');

  assert.equal(twice, once, 'second patch execution must not change the already-patched server');
});

test('owner cancellation proof uses the current canonical server source', async () => {
  const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const patcher = await fs.readFile(new URL('../scripts/apply-owner-unlimited-cancel.mjs', import.meta.url), 'utf8');

  assert.match(server, /app\.post\('\/api\/staff\/transactions\/:id\/cancel'/);
  assert.match(server, /async function cancelCompletedTransaction\(/);
  assert.match(patcher, /Applied unlimited cancellation for owner\/admin; staff limits remain unchanged\./);
});
