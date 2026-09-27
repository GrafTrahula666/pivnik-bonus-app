import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const count = (source, needle) => source.split(needle).length - 1;

test('retention preview UI is read-only, valid, isolated and idempotent', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'pivnik-retention-preview-ui-'));
  try {
    mkdirSync(path.join(work, 'scripts'));
    for (const file of ['app.js', 'index.html', 'styles.css']) cpSync(path.join(root, file), path.join(work, file));
    for (const script of ['apply-admin-customer360-ui.mjs', 'apply-admin-retention-preview-ui.mjs']) {
      cpSync(path.join(root, 'scripts', script), path.join(work, 'scripts', script));
    }

    execFileSync(process.execPath, ['scripts/apply-admin-customer360-ui.mjs'], { cwd: work, stdio: 'pipe' });
    execFileSync(process.execPath, ['scripts/apply-admin-retention-preview-ui.mjs'], { cwd: work, stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', 'app.js'], { cwd: work, stdio: 'pipe' });

    const once = {
      app: readFileSync(path.join(work, 'app.js'), 'utf8'),
      html: readFileSync(path.join(work, 'index.html'), 'utf8'),
      css: readFileSync(path.join(work, 'styles.css'), 'utf8')
    };
    assert.equal(count(once.app, 'async function refreshRetentionAudiencePreview()'), 1);
    assert.equal(count(once.html, 'id="retentionAudiencePreview"'), 1);
    assert.equal(count(once.css, '/* ADMIN_RETENTION_PREVIEW_UI */'), 1);
    assert.equal(count(once.app, 'function updateRetentionCampaignDraft()'), 0);
    assert.equal(count(once.html, 'id="retentionCampaignDraft"'), 0);
    assert.match(once.app, /\/api\/admin\/retention\/audience-preview\?segment=/);
    assert.match(once.app, /\['at_risk', 'sleeping'\]\.includes\(segment\)/);
    assert.match(once.app, /refreshRetentionAudiencePreview\(\);/);
    assert.doesNotMatch(once.app, /retention\/audience-preview[^\n]*(?:POST|PUT|PATCH|DELETE)/);
    assert.match(once.app, /Предпросмотр не отправляет сообщения/);

    execFileSync(process.execPath, ['scripts/apply-admin-retention-preview-ui.mjs'], { cwd: work, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(work, 'app.js'), 'utf8'), once.app);
    assert.equal(readFileSync(path.join(work, 'index.html'), 'utf8'), once.html);
    assert.equal(readFileSync(path.join(work, 'styles.css'), 'utf8'), once.css);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
