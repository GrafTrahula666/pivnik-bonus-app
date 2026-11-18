import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/admin-dependency-audit-split.yml', import.meta.url), 'utf8');
const match = workflow.match(/node --input-type=module - "\$RUNNER_TEMP\/admin-audit" <<'NODE'\n([\s\S]*?)\n          NODE/);
assert.ok(match, 'real inline audit validator must remain discoverable');
const validator = match[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');

function report(counts, entries = {}) {
  return { metadata: { vulnerabilities: counts }, vulnerabilities: entries };
}
const zero = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

function execute(full, production = full) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivnik-audit-'));
  try {
    fs.writeFileSync(path.join(dir, 'full.json'), JSON.stringify(full));
    fs.writeFileSync(path.join(dir, 'production.json'), JSON.stringify(production));
    return spawnSync(process.execPath, ['--input-type=module', '-', dir], {
      input: validator, encoding: 'utf8', timeout: 10000,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('accepts complete clean audit evidence for both modes', () => {
  const result = execute(report(zero));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /full:/);
  assert.match(result.stdout, /production:/);
});

test('accepts internally consistent nonzero vulnerability evidence (audit exit status remains separate)', () => {
  const counts = { ...zero, high: 1, total: 1 };
  const result = execute(report(counts, { vite: { severity: 'high' } }));
  assert.equal(result.status, 0, result.stderr);
});

test('rejects mismatched totals and entry counts', () => {
  const mismatch = { ...zero, high: 1, total: 0 };
  assert.notEqual(execute(report(mismatch)).status, 0);
  const missingEntry = { ...zero, high: 1, total: 1 };
  assert.notEqual(execute(report(missingEntry)).status, 0);
});

test('rejects absent, negative, fractional and nonnumeric counts', () => {
  assert.notEqual(execute({ vulnerabilities: {} }).status, 0);
  for (const value of [-1, 0.5, '0', null]) {
    assert.notEqual(execute(report({ ...zero, high: value })).status, 0);
  }
});

test('rejects malformed production report even when full report is valid', () => {
  const result = execute(report(zero), { metadata: { vulnerabilities: zero } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production: malformed/);
});


test('rejects severity totals that disagree with individual audit entries', () => {
  const counts = { ...zero, moderate: 1, total: 1 };
  const result = execute(report(counts, { picomatch: { severity: 'high' } }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full: vulnerability severity count mismatch/);
});

test('rejects missing or unknown individual vulnerability severity', () => {
  const counts = { ...zero, high: 1, total: 1 };
  for (const severity of [undefined, 'unknown', null]) {
    const result = execute(report(counts, { picomatch: { severity } }));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /full: invalid vulnerability severity/);
  }
});

test('rejects inconsistent production severity even when full report is valid', () => {
  const counts = { ...zero, high: 1, total: 1 };
  const result = execute(report(zero), report(counts, { vite: { severity: 'low' } }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production: vulnerability severity count mismatch/);
});
