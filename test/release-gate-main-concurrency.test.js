import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseGate = new URL('../.github/workflows/release-gate.yml', import.meta.url);

test('main release checks remain serialized without cancelling active or pending runs', async () => {
  const workflow = await readFile(releaseGate, 'utf8');
  // Railway Wait for CI can ignore cancelled workflows when another CI passes.
  // The same workflow deploys to production, so overlapping runs must also be
  // serialized to avoid older commits racing newer deployments.
  assert.match(workflow, /group: release-gate-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /push:\s+branches:\s+- main/);
  // This static contract does not prove Wait for CI is enabled on Railway.
  assert.match(workflow,
    /- name: Deploy exact commit and verify both production services\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});
