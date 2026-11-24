import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEffectiveRules, fetchEffectiveRules } from '../scripts/check-effective-main-rules.mjs';

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
  assert.equal(evaluateEffectiveRules(protectedMain.slice(0, 2)).ok, false);
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
  assert.match(requestedUrl, /\/rules\/branches\/main$/);
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
