import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL('../.github/workflows/vk-native-hosting-production.yml', import.meta.url);
const SHA = 'a'.repeat(40);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function readGuard() {
  const workflow = await readFile(workflowUrl, 'utf8');
  const start = workflow.indexOf('      - name: Verify the approved PIVNIK release for this SHA\n');
  assert.notEqual(start, -1, 'The production approval step must exist');
  const segment = workflow.slice(start);
  const match = segment.match(/^[ \t]*node --input-type=module <<'NODE'\r?\n([\s\S]*?)^[ \t]*NODE\s*$/m);
  assert.ok(match, 'Execute the real inline approval guard, not a copy of it');
  const code = match[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
  return { workflow, execute: new AsyncFunction('fetch', 'process', 'console', 'URLSearchParams', 'AbortSignal', code) };
}

function approvedRun(overrides = {}) {
  return {
    id: 42001, head_sha: SHA, head_branch: 'main',
    repository: { full_name: 'GrafTrahula666/pivnik-bonus-app' },
    path: '.github/workflows/release-gate.yml',
    event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    run_attempt: 3, ...overrides,
  };
}

function approvedJobs(overrides = {}) {
  return [{
    name: 'Syntax, tests and dependency audit', status: 'completed', conclusion: 'success',
    head_sha: SHA, run_id: 42001, run_attempt: 3,
    steps: [
      { number: 23, name: 'Deploy exact commit and verify both production services', status: 'completed', conclusion: 'success' },
      { number: 24, name: 'Probe production documents and public endpoints', status: 'completed', conclusion: 'success' },
      { number: 25, name: 'Verify separate Telegram and VK production accounts', status: 'completed', conclusion: 'success' },
      { number: 26, name: 'Verify signed Telegram and VK production sessions', status: 'completed', conclusion: 'success' },
    ],
    ...overrides,
  }];
}

async function evaluate({ run = approvedRun(), runs = run ? [run] : [], currentRuns = runs, jobs = approvedJobs(), totalJobs = jobs.length, rejectCall = 0, httpStatus = 403, invalidJsonCall = 0, redirectCall = 0 } = {}) {
  const { execute } = await readGuard();
  const calls = [];
  const logs = [];
  const fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers, redirect: options?.redirect });
    // Model fetch redirect:error: redirected evidence must fail before JSON parsing.
    if (calls.length === redirectCall && options?.redirect === 'error') {
      throw Error('Redirected GitHub release evidence was refused');
    }
    if (calls.length === rejectCall) return { ok: false, status: httpStatus, json: async () => ({}) };
    if (calls.length === invalidJsonCall) throw Error('Invalid JSON');
    if (calls.length === 1) return { ok: true, json: async () => ({ workflow_runs: runs }) };
    if (calls.length === 2) return { ok: true, json: async () => ({ jobs, total_count: totalJobs }) };
    if (calls.length === 3) return { ok: true, json: async () => ({ workflow_runs: currentRuns }) };
    throw Error('Unexpected fourth API call');
  };
  let error;
  try {
    await execute(fetch, { env: {
      GITHUB_API_URL: 'https://api.github.com',
      GITHUB_REPOSITORY: 'GrafTrahula666/pivnik-bonus-app',
      GH_TOKEN: 'mock-token',
      RELEASE_SHA: SHA,
    } }, { log: msg => logs.push(msg) }, URLSearchParams, AbortSignal);
  } catch (cause) {
    error = cause;
  }
  return { error, calls, logs };
}

test('VK production publishing is manual only and requires an exact SHA approval check', async () => {
  const { workflow } = await readGuard();
  assert.match(workflow, /^on:\s*\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  workflow_run:/m);
  assert.match(workflow, /^    if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(workflow, /test "\$RELEASE_CONFIRM" = "DEPLOY_VK_PRODUCTION"/);
  assert.match(workflow, /git ls-remote --heads origin main/);
  const build = workflow.indexOf('      - name: Verify bundle boundaries');
  const approval = workflow.indexOf('      - name: Verify the approved PIVNIK release for this SHA');
  const publish = workflow.indexOf('      - name: Deploy to VK Mini Apps production Hosting');
  assert.ok(build >= 0 && build < approval && approval < publish,
    'production approval check must run after bundle build and immediately before VK publication');
  assert.equal(workflow.slice(approval, publish).match(/^      - name:/gm)?.length, 1,
    'no intervening workflow step may separate approval from publication');
});

test('approved common release succeeds and verifies the exact run attempt', async () => {
  const result = await evaluate();
  assert.equal(result.error, undefined);
  assert.equal(result.calls.length, 3);
  assert.equal(result.calls[2].url, result.calls[0].url);
  const lookup = new URL(result.calls[0].url);
  assert.match(lookup.pathname, /\/actions\/workflows\/release-gate\.yml\/runs$/);
  assert.equal(lookup.searchParams.get('head_sha'), SHA);
  assert.equal(lookup.searchParams.get('event'), 'workflow_dispatch');
  assert.equal(lookup.searchParams.get('branch'), 'main');
  assert.equal(lookup.searchParams.get('per_page'), '1');
  assert.match(result.calls[1].url, /\/actions\/runs\/42001\/attempts\/3\/jobs\?per_page=100$/);
  assert.match(result.logs.join('\n'), /Verified PIVNIK release run 42001/);
});

test('no approved release and a failed or cancelled common release must deny publishing', async () => {
  for (const run of [
    null, approvedRun({ status: 'in_progress' }), approvedRun({ conclusion: 'failure' }),
    approvedRun({ conclusion: 'cancelled' }), approvedRun({ event: 'push' }),
  ]) {
    const result = await evaluate({ run });
    assert.ok(result.error instanceof Error, 'invalid release must be denied');
    assert.equal(result.calls.length, 1);
  }
});

test('missing or ambiguous workflow run evidence denies VK before requesting jobs', async () => {
  for (const runs of [null, {}, [], [approvedRun(), approvedRun({ id: 42002 })]]) {
    const result = await evaluate({ runs });
    assert.ok(result.error instanceof Error, 'ambiguous or malformed release runs must deny');
    assert.equal(result.calls.length, 1);
  }
});

test('releases from a different branch or SHA cannot authorize VK production', async () => {
  for (const run of [approvedRun({ head_sha: 'b'.repeat(40) }), approvedRun({ head_branch: 'preview' })]) {
    const result = await evaluate({ run });
    assert.ok(result.error instanceof Error);
    assert.equal(result.calls.length, 1);
  }
});

test('a successful run from a foreign repository or unrelated workflow cannot authorize VK', async () => {
  for (const run of [
    approvedRun({ repository: { full_name: 'elsewhere/pivnik-bonus-app' } }),
    approvedRun({ repository: undefined }),
    approvedRun({ path: '.github/workflows/unrelated-success.yml' }),
    approvedRun({ path: undefined }),
  ]) {
    const result = await evaluate({ run });
    assert.ok(result.error instanceof Error, 'wrong workflow provenance must deny');
    assert.match(result.error.message, /requires a successful manually approved PIVNIK release/);
    assert.equal(result.calls.length, 1, 'must reject before requesting production jobs');
  }
});

test('successful common workflow with skipped or missing deploy/signed-session steps still denies VK', async () => {
  const valid = approvedJobs()[0].steps;
  for (const jobs of [
    [], approvedJobs({ conclusion: 'failure' }),
    approvedJobs({ steps: valid.filter(s => s.name.startsWith('Deploy')) }),
    approvedJobs({ steps: valid.map((s, i) => ({ ...s, conclusion: i === 0 ? 'skipped' : 'success' })) }),
    approvedJobs({ steps: valid.map((s, i) => ({ ...s, conclusion: i === 1 ? 'failure' : 'success' })) }),
  ]) {
    const result = await evaluate({ jobs });
    assert.ok(result.error instanceof Error, 'missing release evidence must deny');
    assert.equal(result.calls.length, 2);
  }
});

test('incomplete or unbounded GitHub jobs pagination must deny VK publication', async () => {
  for (const totalJobs of [null, 0, 2, 101, '1']) {
    const result = await evaluate({ totalJobs });
    assert.ok(result.error instanceof Error, 'partial jobs evidence must deny');
    assert.equal(result.calls.length, 2);
  }
  const result = await evaluate();
  assert.equal(result.error, undefined);
  assert.match(result.calls[1].url, /\/attempts\/3\/jobs\?per_page=100$/);
});

test('duplicate canonical release jobs deny VK even if one reports success', async () => {
  const valid = approvedJobs()[0];
  for (const jobs of [
    [valid, { ...valid, conclusion: 'failure' }],
    [valid, { ...valid, run_attempt: 2 }],
  ]) {
    const result = await evaluate({ jobs });
    assert.ok(result.error instanceof Error, 'ambiguous release evidence must deny');
    assert.equal(result.calls.length, 2);
  }
});

test('a release job still running cannot authorize VK even with a reported success conclusion', async () => {
  for (const status of [undefined, null, 'queued', 'in_progress']) {
    const result = await evaluate({ jobs: approvedJobs({ status }) });
    assert.ok(result.error instanceof Error, 'unfinished or unknown job status must deny');
    assert.equal(result.calls.length, 2);
  }
});

test('all four common production checks are mandatory even if the workflow reports success', async () => {
  const valid = approvedJobs()[0].steps;
  assert.equal(valid.length, 4);
  for (const step of valid) {
    for (const steps of [
      valid.filter(item => item.name !== step.name),
      valid.map(item => item.name === step.name ? { ...item, conclusion: 'skipped' } : item),
      valid.map(item => item.name === step.name ? { ...item, conclusion: 'failure' } : item),
    ]) {
      const result = await evaluate({ jobs: approvedJobs({ steps }) });
      assert.ok(result.error instanceof Error, `must reject missing or unsuccessful: ${step.name}`);
      assert.equal(result.calls.length, 2);
    }
  }
});

test('duplicate mandatory production steps deny VK even when one succeeds', async () => {
  const valid = approvedJobs()[0].steps;
  for (const step of valid) {
    for (const duplicate of [{ ...step }, { ...step, conclusion: 'failure' }]) {
      const result = await evaluate({ jobs: approvedJobs({ steps: [...valid, duplicate] }) });
      assert.ok(result.error instanceof Error, `duplicate step must deny: ${step.name}`);
      assert.equal(result.calls.length, 2);
    }
  }
});

test('production approval denies smoke evidence recorded before deploy or with invalid step order', async () => {
  const valid = approvedJobs()[0].steps;
  const cases = [
    valid.map((step, i) => ({ ...step, number: i === 0 ? 24 : i === 1 ? 23 : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 1 ? 23 : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 2 ? 24 : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 3 ? 24 : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 0 ? undefined : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 1 ? '24' : step.number })),
    valid.map((step, i) => ({ ...step, number: i === 2 ? 0 : step.number })),
  ];
  for (const steps of cases) {
    const result = await evaluate({ jobs: approvedJobs({ steps }) });
    assert.ok(result.error instanceof Error, 'out-of-order, duplicate or missing step number must deny VK');
    assert.match(result.error.message, /deployed and verified this SHA in order/);
    assert.equal(result.calls.length, 2);
    assert.equal(result.logs.length, 0);
  }
  const approved = await evaluate();
  assert.equal(approved.error, undefined, 'correctly ordered release evidence must still pass');
});

test('unfinished mandatory production steps deny VK publication despite a success conclusion', async () => {
  const valid = approvedJobs()[0].steps;
  for (const step of valid) {
    for (const status of [undefined, null, 'queued', 'in_progress']) {
      const steps = valid.map(item => item.name === step.name ? { ...item, status } : item);
      const result = await evaluate({ jobs: approvedJobs({ steps }) });
      assert.ok(result.error instanceof Error, `unfinished mandatory step must deny: ${step.name} (${status})`);
      assert.equal(result.calls.length, 2);
    }
  }
});

test('GitHub API denial and invalid response fail closed at every lookup stage', async () => {
  for (const arg of [
    { rejectCall: 1, httpStatus: 401 }, { rejectCall: 2, httpStatus: 503 },
    { invalidJsonCall: 1 }, { invalidJsonCall: 2 },
    { rejectCall: 3, httpStatus: 503 }, { invalidJsonCall: 3 },
  ]) {
    const result = await evaluate(arg);
    assert.ok(result.error instanceof Error);
    assert.equal(result.logs.length, 0);
  }
});


test('redirected GitHub API evidence fails closed at every approval lookup', async () => {
  for (const redirectCall of [1, 2, 3]) {
    const result = await evaluate({ redirectCall });
    assert.ok(result.error instanceof Error, 'redirect must deny VK publication');
    assert.match(result.error.message, /Redirected GitHub release evidence was refused/);
    assert.equal(result.calls.length, redirectCall);
    assert.equal(result.logs.length, 0);
    assert.ok(result.calls.every(call => call.redirect === 'error'));
  }
  const valid = await evaluate();
  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.calls.map(call => call.redirect), ['error', 'error', 'error']);
});

test('release run must expose a valid positive attempt number', async () => {
  for (const attempt of [undefined, null, 0, -1, 1.5, '3']) {
    const result = await evaluate({ run: approvedRun({ run_attempt: attempt }) });
    assert.ok(result.error instanceof Error, 'invalid attempt must deny');
    assert.equal(result.calls.length, 1);
  }
});

test('production job evidence must belong to the exact release run, attempt and SHA', async () => {
  for (const override of [
    { head_sha: 'b'.repeat(40) }, { head_sha: undefined },
    { run_id: 42002 }, { run_id: undefined },
    { run_attempt: 2 }, { run_attempt: undefined },
  ]) {
    const result = await evaluate({ jobs: approvedJobs(override) });
    assert.ok(result.error instanceof Error, 'foreign job evidence must deny');
    assert.equal(result.calls.length, 2);
  }
});

test('release evidence without a positive integer workflow run ID must deny publishing', async () => {
  for (const id of [undefined, null, 0, -1, 1.5, '42001']) {
    const result = await evaluate({ run: approvedRun({ id }) });
    assert.ok(result.error instanceof Error, 'invalid run ID must deny');
    assert.equal(result.calls.length, 1, 'must reject before requesting jobs');
  }
});


test('common production release gate cannot execute deploy or smoke without exact manual confirmation', async () => {
  const gate = await readFile(new URL('../.github/workflows/release-gate.yml', import.meta.url), 'utf8');
  assert.match(gate, /workflow_dispatch:\s*\n\s*inputs:/);
  assert.match(gate, /release_confirm:\s*\n[\s\S]*?default: CANCEL/);
  for (const name of [
    'Deploy exact commit and verify both production services',
    'Probe production documents and public endpoints',
    'Verify separate Telegram and VK production accounts',
    'Verify signed Telegram and VK production sessions',
  ]) {
    const start = gate.indexOf('      - name: ' + name + '\n');
    assert.notEqual(start, -1, 'Missing production gate step: ' + name);
    const next = gate.indexOf('\n      - name: ', start + 1);
    const step = gate.slice(start, next < 0 ? undefined : next);
    const condition = step.match(/\n        if: >-\n([\s\S]*?)\n        (?:env:|run:|shell:)/);
    assert.ok(condition, 'Missing explicit conditional for ' + name);
    assert.match(condition[1], /github\.event_name == 'workflow_dispatch'/);
    assert.match(condition[1], /github\.ref == 'refs\/heads\/main'/);
    assert.match(condition[1], /inputs\.release_sha == github\.sha/);
    assert.match(condition[1], /inputs\.release_confirm == 'DEPLOY_PIVNIK_PRODUCTION'/);
    assert.doesNotMatch(step, /\n\s*continue-on-error:\s*true\b/, 'Production evidence must not be allowed to fail: ' + name);
    assert.doesNotMatch(condition[1], /\|\|/, 'Production gate must require all approval conditions: ' + name);
  }
});

test('a superseded or rerun approval cannot publish using an earlier successful job attempt', async () => {
  for (const currentRuns of [
    [], null, [approvedRun({ id: 42002 })],
    [approvedRun({ run_attempt: 4 })],
    [approvedRun({ status: 'in_progress' })],
    [approvedRun({ conclusion: 'failure' })],
    [approvedRun({ head_sha: 'b'.repeat(40) })],
    [approvedRun({ path: '.github/workflows/unrelated.yml' })],
  ]) {
    const result = await evaluate({ currentRuns });
    assert.ok(result.error instanceof Error, 'changed or unavailable latest dispatch must deny');
    assert.equal(result.calls.length, 3);
    assert.equal(result.calls[2].url, result.calls[0].url);
    assert.equal(result.logs.length, 0);
  }
  const stable = await evaluate();
  assert.equal(stable.error, undefined);
  assert.equal(stable.calls.length, 3);
});
