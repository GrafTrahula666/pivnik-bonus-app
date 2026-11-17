import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8');

test('REL-01: pull_request release gate does not invoke legacy production mutation scripts', () => {
  // Match the exact production-mutating commands removed from the historical workflow diff.
  // Keep this regression independent of the runtime scripts themselves.
  for (const script of [
    'scripts/railway-unify-production-databases.mjs',
    'scripts/railway-repair-anna-frame-and-consent.mjs',
  ]) {
    assert.equal(workflow.includes(script), false, `legacy production mutation in PR gate: ${script}`);
  }
});

test('REL-01: production deploy and smoke remain restricted to explicit main workflow_dispatch', () => {
  const steps = [
    'Deploy exact commit and verify both production services',
    'Probe production documents and public endpoints',
    'Verify separate Telegram and VK production accounts',
    'Verify signed Telegram and VK production sessions',
  ];
  for (const name of steps) {
    const start = workflow.indexOf(`      - name: ${name}\n`);
    assert.notEqual(start, -1, `missing release step: ${name}`);
    const tail = workflow.slice(start + 1);
    const end = tail.search(/\n      - name: /);
    const section = end === -1 ? tail : tail.slice(0, end);
    assert.match(section, /github\.event_name == 'workflow_dispatch'/);
    assert.match(section, /github\.ref == 'refs\/heads\/main'/);
    assert.match(section, /inputs\.release_sha == github\.sha/);
    assert.match(section, /inputs\.release_confirm == 'DEPLOY_PIVNIK_PRODUCTION'/);
  }
});


test('REL-01: production secret verification never runs on pull_request', () => {
  const name = 'Verify existing production secrets without changing them';
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, 'missing production secret verification');
  const tail = workflow.slice(start + 1);
  const end = tail.search(/\n      - name: /);
  const section = end === -1 ? tail : tail.slice(0, end);
  assert.match(section, /github\.event_name == 'push'/);
  assert.match(section, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(section, /github\.event_name == 'pull_request'/);
  assert.match(section, /inputs\.release_confirm == 'DEPLOY_PIVNIK_PRODUCTION'/);
});

import { runInNewContext } from 'node:vm';

// Evaluate the actual workflow step expression, not a hand-copied policy.
// The expression subset here is JavaScript-compatible GitHub context comparisons.
// Unknown functions/syntax must fail the test rather than silently pass.
function releaseStepCondition(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(new RegExp('^      - name: ' + escaped + '\\n        if: >-\\n((?:          [^\\n]*\\n)+)', 'm'));
  assert.ok(match, 'missing multiline condition for ' + name);
  const expression = match[1].trim().replace(/\n\s*/g, ' ');
  assert.doesNotMatch(expression, /\$\{\{/);
  return expression;
}

function conditionResult(expression, eventName, ref, sha, releaseSha, confirm) {
  const github = Object.freeze({ event_name: eventName, ref, sha });
  const inputs = Object.freeze({ release_sha: releaseSha, release_confirm: confirm });
  const result = runInNewContext(expression, { github, inputs }, { timeout: 500 });
  assert.equal(typeof result, 'boolean', 'condition must evaluate to a boolean');
  return result;
}

test('REL-01: execute production step guards against negative GitHub event contexts', () => {
  const sha = 'a'.repeat(40);
  const wrongSha = 'b'.repeat(40);
  const productionSteps = [
    'Verify existing production secrets without changing them',
    'Deploy exact commit and verify both production services',
    'Probe production documents and public endpoints',
    'Verify separate Telegram and VK production accounts',
    'Verify signed Telegram and VK production sessions',
  ];
  for (const name of productionSteps) {
    const expression = releaseStepCondition(name);
    for (const [eventName, ref, releaseSha, confirm] of [
      ['pull_request', 'refs/pull/495/merge', sha, 'DEPLOY_PIVNIK_PRODUCTION'],
      ['push', 'refs/heads/audit/test-release', sha, 'DEPLOY_PIVNIK_PRODUCTION'],
      ['workflow_dispatch', 'refs/heads/main', sha, 'CANCEL'],
      ['workflow_dispatch', 'refs/heads/main', wrongSha, 'DEPLOY_PIVNIK_PRODUCTION'],
      ['workflow_dispatch', 'refs/heads/feature/unsafe', sha, 'DEPLOY_PIVNIK_PRODUCTION'],
    ]) {
      assert.equal(conditionResult(expression, eventName, ref, sha, releaseSha, confirm), false,
        name + ' unexpectedly enabled for ' + eventName + '/' + ref + '/' + confirm);
    }
    assert.equal(conditionResult(expression, 'workflow_dispatch', 'refs/heads/main', sha, sha,
      'DEPLOY_PIVNIK_PRODUCTION'), true, name + ' should allow exact approved dispatch');
  }
  const secretCheck = releaseStepCondition(productionSteps[0]);
  assert.equal(conditionResult(secretCheck, 'push', 'refs/heads/main', sha, '', ''), true,
    'existing main push read-only secret check must remain enabled');
  for (const name of productionSteps.slice(1)) {
    assert.equal(conditionResult(releaseStepCondition(name), 'push', 'refs/heads/main', sha, '', ''), false,
      'push must not deploy: ' + name);
  }
});

test('REL-01: materialize idempotence snapshot includes untracked release files', () => {
  const start = workflow.indexOf('      - name: Verify release materialization is idempotent\n');
  assert.notEqual(start, -1);
  const tail = workflow.slice(start);
  const end = tail.indexOf('\n      - name: ', 1);
  const step = end < 0 ? tail : tail.slice(0, end);
  assert.match(step, /git diff --binary/);
  assert.match(step, /git diff --cached --binary/);
  assert.match(step, /git ls-files --others --exclude-standard -z/);
  assert.match(step, /xargs -0 -r sha256sum/);
  assert.match(step, /before=.*release_snapshot/);
  assert.match(step, /after=.*release_snapshot/);
});

test('REL-01: actual snapshot rejects a changed untracked file on second materialization', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');

  const stepStart = workflow.indexOf('      - name: Verify release materialization is idempotent\n');
  assert.notEqual(stepStart, -1);
  const stepTail = workflow.slice(stepStart);
  const stepEnd = stepTail.indexOf('\n      - name: ', 1);
  const step = stepEnd < 0 ? stepTail : stepTail.slice(0, stepEnd);
  const match = step.match(/          release_snapshot\(\) \{\n([\s\S]*?)\n          \}/);
  assert.ok(match, 'missing actual release_snapshot shell function');
  const functionBody = 'release_snapshot() {\n' + match[1].split('\n').map(line => line.slice(10)).join('\n') + '\n}\n';

  const dir = mkdtempSync(join(tmpdir(), 'pivnik-rel01-snapshot-'));
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    writeFileSync(join(dir, 'new-release-source.txt'), 'first version\n');
    const script = functionBody + [
      'before="$(release_snapshot)"',
      'printf "second version\\n" > new-release-source.txt',
      'after="$(release_snapshot)"',
      'test "$before" != "$after"',
      'rm new-release-source.txt',
      'deleted="$(release_snapshot)"',
      'test "$after" != "$deleted"',
      'printf "new generated source\\n" > added-release-source.txt',
      'added="$(release_snapshot)"',
      'test "$deleted" != "$added"',
      'git config user.email test@example.invalid',
      'git config user.name SnapshotTest',
      'git add added-release-source.txt',
      'git commit -qm baseline',
      'baseline="$(release_snapshot)"',
      'printf "staged tracked mutation\\n" > added-release-source.txt',
      'git add added-release-source.txt',
      'staged="$(release_snapshot)"',
      'test "$baseline" != "$staged"',
    ].join('\n');
    const run = spawnSync('bash', ['-e', '-c', script], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, 'snapshot failed to detect untracked mutation: ' + run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REL-01: snapshot fails closed when Git fails inside checksum pipeline', async () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const start = workflow.indexOf('      - name: Verify release materialization is idempotent\n');
  assert.notEqual(start, -1);
  const tail = workflow.slice(start);
  const end = tail.indexOf('\n      - name: ', 1);
  const step = end < 0 ? tail : tail.slice(0, end);
  assert.match(step, /set -euo pipefail/, 'snapshot step must propagate pipeline failures');
  const match = step.match(/          release_snapshot\(\) \{\n([\s\S]*?)\n          \}/);
  assert.ok(match);
  const functionBody = 'release_snapshot() {\n' +
    match[1].split('\n').map(line => line.slice(10)).join('\n') + '\n}\n';
  const dir = mkdtempSync(join(tmpdir(), 'pivnik-rel01-git-failure-'));
  try {
    const git = join(dir, 'git');
    writeFileSync(git, '#!/bin/sh\nexit 42\n');
    chmodSync(git, 0o755);
    const run = spawnSync('bash', ['-c', 'set -euo pipefail\n' + functionBody + 'release_snapshot >/dev/null'], {
      cwd: dir, env: { ...process.env, PATH: dir + ':' + process.env.PATH }, encoding: 'utf8',
    });
    assert.notEqual(run.status, 0, 'Git failure must not be hidden by sha256sum or cut');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
