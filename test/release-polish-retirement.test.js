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

test('release polish patch has a deterministic one-time CSS effect and then becomes a no-op', async (t) => {
  const workspace = await makeProofWorkspace(t);
  const stylesPath = path.join(workspace, 'styles.css');
  const patchPath = path.join(workspace, 'scripts', 'apply-release-polish.mjs');
  const before = await fs.readFile(stylesPath, 'utf8');

  assert.equal(before.includes('/* V19.3 · release polish */'), false);

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const once = await fs.readFile(stylesPath, 'utf8');

  assert.notEqual(once, before);
  assert.match(once, /\/\* V19\.3 · release polish \*\//);
  assert.match(once, /\.wheel-back::after\s*\{[\s\S]*content: 'Назад';/);
  assert.match(once, /\.screen\[data-screen='admin'\] \.admin-quick-grid/);
  assert.match(once, /\.screen\[data-screen='admin'\] \.metric-grid/);
  assert.match(once, /@media \(max-width: 355px\)/);
  assert.equal(once.endsWith('\n\n'), false, 'release-polish output must not add a blank line at EOF');

  execFileSync(process.execPath, [patchPath], { cwd: workspace, stdio: 'pipe' });
  const twice = await fs.readFile(stylesPath, 'utf8');

  assert.equal(twice, once, 'second release-polish execution must not change already-patched CSS');
});

test('release polish proof uses the current canonical stylesheet', async () => {
  const styles = await fs.readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const patcher = await fs.readFile(new URL('../scripts/apply-release-polish.mjs', import.meta.url), 'utf8');

  assert.equal(styles.includes('/* V19.3 · release polish */'), false);
  assert.match(patcher, /const marker = '\/\* V19\.3 · release polish \*\/';/);
  assert.match(patcher, /styles = `\$\{styles\.trimEnd\(\)\}\$\{polishCss\.trimEnd\(\)\}\\n`;/);
});
