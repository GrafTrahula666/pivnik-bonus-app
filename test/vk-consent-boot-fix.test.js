import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function materializeHotfix() {
  execFileSync(process.execPath, ['scripts/apply-vk-consent-boot-fix.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('VK consent gate is idempotent and cannot observe its own mutations forever', () => {
  materializeHotfix();
  materializeHotfix();

  const source = fs.readFileSync(path.join(root, 'vk-platform.js'), 'utf8');
  assert.match(source, /VK consent gate idempotency hotfix/);
  assert.match(source, /const alreadyOpen = modal\.classList\.contains\('open'\)/);
  assert.match(source, /modal\.getAttribute\('aria-hidden'\) !== 'false'/);
  assert.match(source, /consentObserver\?\.disconnect\(\);\s*consentObserver = null;/);
});

test('VK hotfix forces a fresh client script and fully removes the loader', () => {
  materializeHotfix();

  const server = fs.readFileSync(path.join(root, 'universal-server.js'), 'utf8');
  const loader = fs.readFileSync(path.join(root, 'loader-fix.css'), 'utf8');

  assert.match(server, /vk-platform\.js\?v=3\.2\.2-anna-consent-persistence/);
  assert.match(loader, /\.boot-screen\.hidden\s*\{[\s\S]*display: none !important;/);
});
