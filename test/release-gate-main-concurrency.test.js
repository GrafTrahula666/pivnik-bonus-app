import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const releaseGate = new URL('../.github/workflows/release-gate.yml', import.meta.url);

test('main release verification is never cancelled or replaced by a newer push', async () => {
  const workflow = await readFile(releaseGate, 'utf8');
  // A cancelled GitHub check suite can be ignored by Railway Wait for CI when
  // another suite succeeds. Prevent both running and queued main cancellations.
  assert.match(workflow,
    /group: release-gate-\$\{\{ github\.ref == 'refs\/heads\/main' && github\.run_id \|\| github\.ref \}\}/);
  assert.match(workflow,
    /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/);
  assert.match(workflow, /push:\s+branches:\s+- main/);
  // The deployment gate remains restricted to main pushes. This is a static
  // contract test, not proof that Railway Wait for CI is enabled in production.
  assert.match(workflow,
    /- name: Deploy exact commit and verify both production services\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});
