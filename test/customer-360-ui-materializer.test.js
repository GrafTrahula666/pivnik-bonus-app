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

test('Customer 360 UI materializer produces valid JavaScript and is idempotent', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'pivnik-customer360-ui-'));
  try {
    cpSync(path.join(root, 'app.js'), path.join(work, 'app.js'));
    cpSync(path.join(root, 'index.html'), path.join(work, 'index.html'));
    cpSync(path.join(root, 'styles.css'), path.join(work, 'styles.css'));
    cpSync(path.join(root, 'scripts', 'apply-admin-customer360-ui.mjs'), path.join(work, 'apply-admin-customer360-ui.mjs'));

    const sourceHtml = readFileSync(path.join(work, 'index.html'), 'utf8');
    assert.match(sourceHtml, /value="new">Новые · до 7 дней/);
    assert.match(sourceHtml, /value="active">Активные · были за 30 дней/);
    assert.match(sourceHtml, /value="inactive">Давно не были · 30\+ дней/);
    assert.match(sourceHtml, /value="no_ops">Без операций/);

    execFileSync(process.execPath, ['apply-admin-customer360-ui.mjs'], { cwd: work, stdio: 'pipe' });
    execFileSync(process.execPath, ['--check', 'app.js'], { cwd: work, stdio: 'pipe' });

    const once = {
      app: readFileSync(path.join(work, 'app.js'), 'utf8'),
      html: readFileSync(path.join(work, 'index.html'), 'utf8'),
      css: readFileSync(path.join(work, 'styles.css'), 'utf8')
    };

    assert.equal(count(once.app, 'function openCustomer360(userId)'), 1);
    assert.equal(count(once.html, 'id="customer360Modal"'), 1);
    assert.equal(count(once.css, '/* CUSTOMER360_UI */'), 1);
    assert.match(once.html, /value="new">Новые · без визитов до 30 дней/);
    assert.match(once.html, /value="active">Активные · визит до 30 дней/);
    assert.match(once.html, /value="at_risk">В зоне риска · 30–60 дней/);
    assert.match(once.html, /value="sleeping">Спящие · более 60 дней/);
    assert.match(once.html, /value="no_visits">Без визитов · более 30 дней/);
    assert.doesNotMatch(once.html, /value="inactive">Давно не были/);
    assert.doesNotMatch(once.html, /value="no_ops">Без операций/);

    execFileSync(process.execPath, ['apply-admin-customer360-ui.mjs'], { cwd: work, stdio: 'pipe' });

    assert.equal(readFileSync(path.join(work, 'app.js'), 'utf8'), once.app);
    assert.equal(readFileSync(path.join(work, 'index.html'), 'utf8'), once.html);
    assert.equal(readFileSync(path.join(work, 'styles.css'), 'utf8'), once.css);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
