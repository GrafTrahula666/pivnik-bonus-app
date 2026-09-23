import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function count(source, needle) {
  return source.split(needle).length - 1;
}

test('retention audience preview API materializes once with role gate and no recipient data', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'pivnik-retention-api-'));
  try {
    cpSync(path.join(root, 'universal-server.js'), path.join(work, 'universal-server.js'));
    cpSync(path.join(root, 'scripts', 'apply-admin-customer360-api.mjs'), path.join(work, 'apply-admin-customer360-api.mjs'));

    execFileSync(process.execPath, ['apply-admin-customer360-api.mjs'], { cwd: work, stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', 'universal-server.js'], { cwd: work, stdio: 'pipe' });

    const once = readFileSync(path.join(work, 'universal-server.js'), 'utf8');
    assert.equal(count(once, "import { queryRetentionAudiencePreview } from './retention-audience-preview.js';"), 1);
    assert.equal(count(once, "url.pathname === '/api/admin/retention/audience-preview'"), 1);
    assert.match(once, /!\['viewer', 'admin'\]\.includes\(profile\.role\)/);
    assert.match(once, /queryRetentionAudiencePreview\(pool, url\.searchParams\.get\('segment'\)\)/);
    assert.match(once, /error instanceof TypeError/);
    assert.doesNotMatch(once, /\/api\/admin\/retention\/audience-preview[\s\S]{0,1200}(telegram_id|vk_id|username|display_name)/);

    execFileSync(process.execPath, ['apply-admin-customer360-api.mjs'], { cwd: work, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(work, 'universal-server.js'), 'utf8'), once);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
