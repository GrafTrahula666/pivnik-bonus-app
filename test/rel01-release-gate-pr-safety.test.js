import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8');

test('REL-01: pull_request release gate does not invoke legacy production mutation scripts', () => {
  // These legacy jobs previously ran on PRs selected by branch name.
  // Keep this regression independent of the runtime scripts themselves.
  for (const script of [
    'scripts/merge-vk-databases',
    'scripts/restore-anna-consents',
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
