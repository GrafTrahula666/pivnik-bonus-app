import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('CRM segment counter materializer wires API counts into lifecycle filter and is idempotent', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'pivnik-crm-segments-'));
  try {
    cpSync(path.join(root, 'app.js'), path.join(work, 'app.js'));
    cpSync(path.join(root, 'scripts', 'apply-admin-crm-segment-counts.mjs'), path.join(work, 'apply-admin-crm-segment-counts.mjs'));

    execFileSync(process.execPath, ['apply-admin-crm-segment-counts.mjs'], { cwd: work, stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', 'app.js'], { cwd: work, stdio: 'pipe' });
    const once = readFileSync(path.join(work, 'app.js'), 'utf8');

    assert.match(once, /segments: \{ new: 0, active: 0, at_risk: 0, sleeping: 0, no_visits: 0 \}/);
    assert.match(once, /new: Number\(data\.segments\?\.new \|\| 0\)/);
    assert.match(once, /at_risk: Number\(data\.segments\?\.at_risk \|\| 0\)/);
    assert.match(once, /sleeping: Number\(data\.segments\?\.sleeping \|\| 0\)/);
    assert.match(once, /no_visits: Number\(data\.segments\?\.no_visits \|\| 0\)/);
    assert.match(once, /const segmentLabels = \{ new: 'Новые', active: 'Активные', at_risk: 'В зоне риска', sleeping: 'Спящие', no_visits: 'Без визитов' \}/);
    assert.match(once, /option\.textContent = `\$\{label\} · \$\{fmt\(segments\[value\] \|\| 0\)\}`/);

    execFileSync(process.execPath, ['apply-admin-crm-segment-counts.mjs'], { cwd: work, stdio: 'pipe' });
    assert.equal(readFileSync(path.join(work, 'app.js'), 'utf8'), once);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
