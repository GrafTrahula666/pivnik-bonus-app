import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('retention campaign draft is idempotent and cannot dispatch messages', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pivnik-retention-draft-'));
  fs.mkdirSync(path.join(temp, 'scripts'));
  for (const file of ['app.js', 'index.html', 'styles.css']) fs.copyFileSync(path.join(repoRoot, file), path.join(temp, file));
  for (const script of ['apply-admin-customer360-ui.mjs', 'apply-admin-retention-preview-ui.mjs', 'apply-admin-retention-draft-ui.mjs']) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', script), path.join(temp, 'scripts', script));
  }
  execFileSync(process.execPath, ['scripts/apply-admin-customer360-ui.mjs'], { cwd: temp });
  execFileSync(process.execPath, ['scripts/apply-admin-retention-preview-ui.mjs'], { cwd: temp });
  execFileSync(process.execPath, ['scripts/apply-admin-retention-draft-ui.mjs'], { cwd: temp });
  const once = ['app.js', 'index.html', 'styles.css'].map(file => fs.readFileSync(path.join(temp, file), 'utf8'));
  execFileSync(process.execPath, ['scripts/apply-admin-retention-draft-ui.mjs'], { cwd: temp });
  const twice = ['app.js', 'index.html', 'styles.css'].map(file => fs.readFileSync(path.join(temp, file), 'utf8'));
  assert.deepEqual(twice, once);

  const [app, html] = once;
  assert.match(app, /function updateRetentionCampaignDraft\(\)/);
  assert.match(app, /\['at_risk', 'sleeping'\]/);
  assert.match(html, /id="retentionDraftChannel"/);
  assert.match(html, /id="retentionDraftMessage"/);
  assert.match(html, /maxlength="500"/);
  assert.doesNotMatch(app, /sendMessage|dispatch|broadcast|fetch\([^)]*retention/i);
  assert.doesNotMatch(html, /Отправить|Запустить кампанию/i);
  execFileSync(process.execPath, ['--check', path.join(temp, 'app.js')]);
});
