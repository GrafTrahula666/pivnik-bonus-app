import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('owner unlimited cancellation is canonical and the legacy patcher is a byte-for-byte no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const serverPath = path.join(workspace, 'server.js');
  const patchPath = path.join(workspace, 'scripts', 'apply-owner-unlimited-cancel.mjs');
  const before = await fs.readFile(serverPath, 'utf8');

  assert.match(before, /\/\/ V21 · owner unlimited cancellation/);
  assert.match(before, /function unlimitedCancellationQuota\(\)/);
  assert.match(before, /const ownerUnlimitedCancel = actingStaff\.role === 'admin';/);
  assert.match(before, /ownerUnlimitedCancel \? unlimitedCancellationQuota\(\) : await getCancellationQuota\(actingStaff\.id\)/);
  assert.match(before, /ownerUnlimitedCancel \? \{\} : \{ staffId: actingStaff\.id, notBefore: quota\.countFrom \}/);
  assert.match(before, /actingStaff\.role === 'admin' \? unlimitedCancellationQuota\(\) : await getCancellationQuota\(actingStaff\.id\)/);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const after = await fs.readFile(serverPath, 'utf8');

  assert.equal(after, before, 'retired owner-cancellation patcher must not mutate canonical server.js');
});

test('canonical owner cancellation behavior still keeps staff quota enforcement', async () => {
  const server = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const patcher = await fs.readFile(new URL('../scripts/apply-owner-unlimited-cancel.mjs', import.meta.url), 'utf8');

  assert.match(server, /app\.post\('\/api\/staff\/transactions\/:id\/cancel'/);
  assert.match(server, /async function cancelCompletedTransaction\(/);
  assert.match(server, /if \(!ownerUnlimitedCancel && !quota\.active\)/);
  assert.match(server, /if \(!ownerUnlimitedCancel && quota\.remaining <= 0\)/);
  assert.match(patcher, /Applied unlimited cancellation for owner\/admin; staff limits remain unchanged\./);
});
