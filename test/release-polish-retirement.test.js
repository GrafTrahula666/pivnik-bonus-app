import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function makeProofWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-release-polish-proof-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  await fs.mkdir(path.join(workspace, 'scripts'), { recursive: true });
  await Promise.all([
    fs.copyFile(new URL('../styles.css', import.meta.url), path.join(workspace, 'styles.css')),
    fs.copyFile(
      new URL('../scripts/apply-release-polish.mjs', import.meta.url),
      path.join(workspace, 'scripts', 'apply-release-polish.mjs')
    )
  ]);
  return workspace;
}

test('release polish is canonical and the legacy patcher is a byte-for-byte no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const stylesPath = path.join(workspace, 'styles.css');
  const patchPath = path.join(workspace, 'scripts', 'apply-release-polish.mjs');
  const before = await fs.readFile(stylesPath, 'utf8');

  assert.match(before, /\/\* V19\.3 · release polish \*\//);
  assert.match(before, /\.wheel-back::after\s*\{[\s\S]*content: 'Назад';/);
  assert.match(before, /\.screen\[data-screen='admin'\] \.admin-quick-grid/);
  assert.match(before, /\.screen\[data-screen='admin'\] \.metric-grid/);
  assert.match(before, /@media \(max-width: 355px\)/);
  assert.equal(before.endsWith('\n\n'), false, 'canonical stylesheet must not end with an extra blank line');

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const after = await fs.readFile(stylesPath, 'utf8');

  assert.equal(after, before, 'retired release-polish patcher must not mutate canonical styles.css');
});

test('legacy release-polish patcher remains guarded by its canonical marker', async () => {
  const styles = await fs.readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const patcher = await fs.readFile(new URL('../scripts/apply-release-polish.mjs', import.meta.url), 'utf8');

  assert.match(styles, /\/\* V19\.3 · release polish \*\//);
  assert.match(patcher, /const marker = '\/\* V19\.3 · release polish \*\/';/);
  assert.match(patcher, /if \(!styles\.includes\(marker\)\)/);
  assert.match(patcher, /styles = `\$\{styles\.trimEnd\(\)\}\$\{polishCss\.trimEnd\(\)\}\\n`;/);
});
