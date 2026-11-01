import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseGate = new URL('../.github/workflows/release-gate.yml', import.meta.url);

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, end === -1 ? undefined : end);
}

test('release checks are serialized, never cancelled, and include main push validation', async () => {
  const workflow = await readFile(releaseGate, 'utf8');
  assert.match(workflow, /group: release-gate-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /push:\s+branches:\s+- main/);
});

test('production release requires an explicit manual dispatch on exact main SHA', async () => {
  const workflow = await readFile(releaseGate, 'utf8');
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+release_sha:/);
  assert.match(workflow, /release_confirm:[\s\S]*?DEPLOY_PIVNIK_PRODUCTION[\s\S]*?default: CANCEL/);

  const deploySteps = [
    'Deploy exact commit and verify both production services',
    'Probe production documents and public endpoints',
    'Verify separate Telegram and VK production accounts',
    'Verify signed Telegram and VK production sessions'
  ];
  const required = [
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    'inputs.release_sha == github.sha',
    "inputs.release_confirm == 'DEPLOY_PIVNIK_PRODUCTION'"
  ];
  for (const name of deploySteps) {
    const step = workflowStep(workflow, name);
    for (const clause of required) assert.ok(step.includes(clause), `${name}: missing ${clause}`);
    assert.ok(!step.includes("if: github.event_name == 'push'"), `${name}: push auto-deploy not allowed`);
  }
  const productionSecrets = workflowStep(workflow, 'Verify existing production secrets without changing them');
  for (const clause of required) assert.ok(productionSecrets.includes(clause), `secret check: missing ${clause}`);
  // These source checks do not prove Railway's own GitHub autodeploy is disabled.
});
