import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEffectiveRules, fetchEffectiveRules } from '../scripts/check-effective-main-rules.mjs';

const protectedMain = [
  { type: 'pull_request', parameters: { required_approving_review_count: 1 } },
  { type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [{ context: 'Syntax, tests and dependency audit' }],
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
    'Release gate job is not an effective required status check',
    'Release gate is not protected by strict up-to-date status checks',
    'No effective branch deletion protection',
  ]);
});

test('effective rules: COMMENT review does not meet required approval count', () => {
  const rules = protectedMain.map((r) => r.type === 'pull_request'
    ? { ...r, parameters: { required_approving_review_count: 0 } } : r);
  assert.equal(evaluateEffectiveRules(rules).ok, false);
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
