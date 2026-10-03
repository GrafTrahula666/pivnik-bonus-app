import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { rootTestFiles } from '../scripts/run-root-tests.mjs';

const runner = fileURLToPath(new URL('../scripts/run-root-tests.mjs', import.meta.url));

function execute(root) {
  const env = { ...process.env };
  // This fixture launches a new runner, rather than another child of this suite.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8', env });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivnik-test-runner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, body) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, body);
    return filename;
  };
  return { root, write };
}

test('root runner discovers nested Node tests without loading Business or helpers', t => {
  const { root, write } = fixture(t);
  const first = write('test/pass.test.cjs', "require('node:test')('root fixture',()=>{});");
  const nested = write('test/nested/pass.test.mjs', "import test from 'node:test'; test('nested fixture',()=>{});");
  write('test/helper.js', "throw Error('not a test');");
  write('admin-platform/src/tests/business.test.ts', "throw Error('requires Vitest');");
  assert.deepEqual(rootTestFiles(root), [nested, first].sort());
  const result = execute(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /root fixture/);
  assert.match(result.stdout, /nested fixture/);
  assert.doesNotMatch(result.stdout + result.stderr, /requires Vitest/);
});

test('root runner propagates failing tests instead of reporting success', t => {
  const { root, write } = fixture(t);
  write('test/fail.test.cjs', "require('node:test')('failure fixture',()=>{throw Error('expected failure');});");
  const result = execute(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /expected failure/);
});

test('root runner rejects empty and missing suites', t => {
  const { root } = fixture(t);
  assert.throws(() => rootTestFiles(root), /ENOENT/);
  fs.mkdirSync(path.join(root, 'test'));
  assert.throws(() => rootTestFiles(root), /No root Node tests/);
  const result = execute(root);
  assert.notEqual(result.status, 0);
});
