import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEffectiveRules, fetchEffectiveRules, verifyRulesetBypasses } from '../scripts/check-effective-main-rules.mjs';

const protectedMain = [
  { type: 'pull_request', parameters: {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
  } },
  { type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [{ context: 'Syntax, tests and dependency audit', integration_id: 15368 }],
  } },
  { type: 'deletion' },
  { type: 'non_fast_forward' },
];

test('effective rules: accepts actual review, release job and deletion protections', () => {
  assert.equal(evaluateEffectiveRules(protectedMain).ok, true);
});

test('effective rules: empty ruleset includes cannot masquerade as branch protection', () => {
  const result = evaluateEffectiveRules([]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, [
    'No effective rule requiring an approving review',
    'No effective approving-review rule dismisses stale approvals on push',
    'Release gate job is not an effective required status check',
    'Release gate required check is not bound to GitHub Actions integration 15368',
    'Release gate is not protected by strict up-to-date status checks',
    'No effective branch deletion protection',
    'No effective non-fast-forward (force-push) protection',
  ]);
});

test('effective rules: COMMENT review does not meet required approval count', () => {
  const rules = protectedMain.map((r) => r.type === 'pull_request'
    ? { ...r, parameters: { required_approving_review_count: 0 } } : r);
  assert.equal(evaluateEffectiveRules(rules).ok, false);
});

test('effective rules: stale approval dismissal explicitly disabled fails closed', () => {
  const rules = protectedMain.map((rule) => rule.type === 'pull_request'
    ? { ...rule, parameters: { ...rule.parameters, dismiss_stale_reviews_on_push: false } }
    : rule);
  const result = evaluateEffectiveRules(rules);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /dismisses stale approvals/);
});

test('effective rules: missing or non-boolean stale dismissal fails closed', () => {
  for (const value of [undefined, null, 'true', 1]) {
    const rules = protectedMain.map((rule) => rule.type === 'pull_request'
      ? { ...rule, parameters: { ...rule.parameters, dismiss_stale_reviews_on_push: value } }
      : rule);
    assert.equal(evaluateEffectiveRules(rules).ok, false);
  }
});

test('effective rules: dismissal on a zero-approval rule does not prove review freshness', () => {
  const rules = protectedMain.map((rule) => rule.type === 'pull_request'
    ? { ...rule, parameters: { ...rule.parameters, dismiss_stale_reviews_on_push: false } }
    : rule);
  rules.push({ type: 'pull_request', parameters: {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: true,
  } });
  assert.equal(evaluateEffectiveRules(rules).ok, false);
});

test('effective rules: malformed approving review count cannot establish freshness', () => {
  const rules = protectedMain.map((rule) => rule.type === 'pull_request'
    ? { ...rule, parameters: { ...rule.parameters, required_approving_review_count: '1' } }
    : rule);
  assert.equal(evaluateEffectiveRules(rules).ok, false);
});

test('effective rules: valid freshness policy remains sufficient with unrelated review rules', () => {
  const rules = [...protectedMain, { type: 'pull_request', parameters: {
    required_approving_review_count: 0,
    dismiss_stale_reviews_on_push: false,
  } }];
  assert.equal(evaluateEffectiveRules(rules).ok, true);
});

test('effective rules: unrelated successful status is not a required release gate', () => {
  const rules = protectedMain.map((r) => r.type === 'required_status_checks'
    ? { ...r, parameters: { required_status_checks: [{ context: 'Other CI' }] } } : r);
  assert.match(evaluateEffectiveRules(rules).reasons.join(' '), /Release gate/);
});

test('effective rules: a green release check on a stale branch is insufficient', () => {
  const rules = protectedMain.map((rule) => rule.type === 'required_status_checks'
    ? { ...rule, parameters: { ...rule.parameters, strict_required_status_checks_policy: false } }
    : rule);
  const result = evaluateEffectiveRules(rules);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /strict up-to-date/);
});

test('effective rules: strict policy on an unrelated check does not protect release gate', () => {
  const rules = protectedMain.map((rule) => rule.type === 'required_status_checks'
    ? { ...rule, parameters: { ...rule.parameters, strict_required_status_checks_policy: false } }
    : rule);
  rules.push({ type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [{ context: 'Other CI' }],
  } });
  assert.equal(evaluateEffectiveRules(rules).ok, false);
});

test('effective rules: missing deletion protection fails closed', () => {
  const result = evaluateEffectiveRules(protectedMain.filter((rule) => rule.type !== 'deletion'));
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['No effective branch deletion protection']);
});

test('effective rules: malformed API response fails closed', () => {
  assert.equal(evaluateEffectiveRules({ rules: protectedMain }).ok, false);
});

test('live request: missing token never calls network', async () => {
  await assert.rejects(fetchEffectiveRules('', () => { throw Error('unexpected fetch'); }), /GITHUB_TOKEN required/);
});

test('live request: API 403 fails closed without printing token', async () => {
  await assert.rejects(fetchEffectiveRules('private-token', async () => ({ ok: false, status: 403 })), /HTTP 403/);
});

test('live request: uses branch effective rules endpoint', async () => {
  let requestedUrl;
  const rules = await fetchEffectiveRules('private-token', async (url, options) => {
    requestedUrl = url;
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return { ok: true, json: async () => protectedMain };
  });
  assert.match(requestedUrl, /\/rules\/branches\/main\?per_page=100&page=1$/);
  assert.equal(evaluateEffectiveRules(rules).ok, true);
});

const withStatusChecks = (checks, strict = true) => protectedMain.map((rule) =>
  rule.type === 'required_status_checks' ? { ...rule, parameters: {
    strict_required_status_checks_policy: strict, required_status_checks: checks,
  } } : rule);

test('effective rules: matching name from another integration fails closed', () => {
  const result = evaluateEffectiveRules(withStatusChecks([
    { context: 'Syntax, tests and dependency audit', integration_id: 99999 },
  ]));
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /not bound to GitHub Actions/);
});

test('effective rules: missing, unrestricted or malformed integration ID fails closed', () => {
  for (const integration_id of [undefined, null, -1, 0, '15368', true, 15368.5]) {
    assert.equal(evaluateEffectiveRules(withStatusChecks([
      { context: 'Syntax, tests and dependency audit', integration_id },
    ])).ok, false);
  }
});

test('effective rules: trusted integration on an unrelated context cannot prove release check', () => {
  assert.equal(evaluateEffectiveRules(withStatusChecks([
    { context: 'Other CI', integration_id: 15368 },
    { context: 'Syntax, tests and dependency audit', integration_id: 99999 },
  ])).ok, false);
});

test('effective rules: strict policy must belong to the trusted release check', () => {
  const rules = withStatusChecks([
    { context: 'Syntax, tests and dependency audit', integration_id: 15368 },
  ], false);
  rules.push({ type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [{ context: 'Syntax, tests and dependency audit', integration_id: 99999 }],
  } });
  const result = evaluateEffectiveRules(rules);
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /strict up-to-date/);
});

test('effective rules: malformed strict check list fails closed without throwing', () => {
  for (const checks of [null, {}, 'Syntax, tests and dependency audit']) {
    assert.equal(evaluateEffectiveRules(withStatusChecks(checks)).ok, false);
  }
});

test('effective rules: missing force-push protection fails closed independently of deletion', () => {
  const result = evaluateEffectiveRules(protectedMain.filter((rule) => rule.type !== 'non_fast_forward'));
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['No effective non-fast-forward (force-push) protection']);
});

test('effective rules: unrelated or malformed rules cannot substitute for force-push protection', () => {
  const rules = protectedMain.filter((rule) => rule.type !== 'non_fast_forward');
  for (const replacement of [null, {}, { type: 'non_fast_forward_disabled' },
    { type: 'deletion', parameters: { type: 'non_fast_forward' } }, { type: 'NON_FAST_FORWARD' }]) {
    const result = evaluateEffectiveRules([...rules, replacement]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons, ['No effective non-fast-forward (force-push) protection']);
  }
});

const provenance = (id, source = 'GrafTrahula666/pivnik-bonus-app', type = 'Repository') =>
  ({ ruleset_id: id, ruleset_source: source, ruleset_source_type: type });
const detailFor = (rule, bypass_actors = []) => ({
  id: rule.ruleset_id, source: rule.ruleset_source, source_type: rule.ruleset_source_type,
  target: 'branch', enforcement: 'active', bypass_actors,
});
const response = (body) => ({ ok: true, json: async () => body });

test('live bypass: verifies every distinct contributing ruleset including inherited ones', async () => {
  const a = provenance(42);
  const b = provenance(73, 'example-org', 'Organization');
  const calls = [];
  const ids = await verifyRulesetBypasses([a, a, b], 'fixture-token', async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    return response(detailFor(url.includes('/42?') ? a : b));
  });
  assert.deepEqual(ids, [42, 73]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.endsWith('?includes_parents=true')));
});

test('live bypass: every bypass mode, even on a second ruleset, fails closed', async () => {
  const a = provenance(42);
  const b = provenance(73, 'example-org', 'Organization');
  for (const bypass_mode of ['always', 'pull_request', 'exempt']) {
    await assert.rejects(verifyRulesetBypasses([a, b], 'fixture-token', async url =>
      response(url.includes('/42?') ? detailFor(a) :
        detailFor(b, [{ actor_id: 7, actor_type: 'Team', bypass_mode }]))), /Ruleset 73.*bypass/);
  }
});

test('live bypass: omitted, null or malformed bypass list never means empty', async () => {
  const a = provenance(42);
  for (const invalid of [undefined, null, {}, '', false]) {
    await assert.rejects(verifyRulesetBypasses([a], 'fixture-token', async () =>
      response({ ...detailFor(a), bypass_actors: invalid })), /absence is not verifiable/);
  }
});

test('live bypass: missing, foreign or conflicting provenance rejects before network', async () => {
  const a = provenance(42);
  for (const rules of [[], [{}], [provenance('42')], [provenance(0)],
    [provenance(42, 'other/repo')], [a, provenance(42, 'org', 'Organization')]]) {
    await assert.rejects(verifyRulesetBypasses(rules, 'fixture-token',
      () => { throw Error('unexpected network'); }), /provenance/);
  }
});

test('live bypass: wrong identity, source, target, inactive policy or HTTP denial blocks', async () => {
  const a = provenance(42);
  for (const override of [{ id: 43 }, { source: 'other/repo' }, { source_type: 'Organization' },
    { target: 'tag' }, { enforcement: 'evaluate' }, { enforcement: 'disabled' }]) {
    await assert.rejects(verifyRulesetBypasses([a], 'fixture-token', async () =>
      response({ ...detailFor(a), ...override })), /identity or active/);
  }
  await assert.rejects(verifyRulesetBypasses([a], 'fixture-token', async () =>
    ({ ok: false, status: 403 })), /HTTP 403/);
});

test('live rules: pagination includes rulesets beyond the first 100 rules', async () => {
  const a = { type: 'deletion', ...provenance(42) };
  const b = { type: 'non_fast_forward', ...provenance(73) };
  const rules = await fetchEffectiveRules('fixture-token', async url =>
    response(url.endsWith('page=1') ? Array(100).fill(a) : [b]));
  assert.equal(rules.length, 101);
  assert.deepEqual(rules.at(-1), b);
});

test('live rules: malformed or endless pagination fails closed', async () => {
  await assert.rejects(fetchEffectiveRules('fixture-token', async () => response({})), /Malformed/);
  await assert.rejects(fetchEffectiveRules('fixture-token', async () =>
    response(Array(100).fill(provenance(42)))), /pagination exceeded/);
});
