import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseRailwayCiAccess } from '../scripts/railway-ci-access-diagnostic.mjs';

const production = {
  projectId: 'expected-project',
  environmentId: 'expected-environment',
  services: { telegram: 'telegram-service', vk: 'vk-service' }
};
const secret = 'not-a-real-token-sensitive-fixture';
const result = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
const authorized = () => result({ data: { variables: { SESSION_SECRET: 'private-value-not-for-logs' } } });
const denied = () => result({ errors: [{ message: 'Not Authorized', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });

function recorder(responses) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options });
    if (!responses.length) throw new Error('Unexpected request');
    return responses.shift();
  };
  return { fetchImpl, requests };
}

test('reads both authorized production services; never returns secret values', async () => {
  const { fetchImpl, requests } = recorder([authorized(), authorized()]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.deepEqual(output, { status: 'variable_read_authorized', checkedServices: ['telegram', 'vk'], mutations: 0 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, `Bearer ${secret}`);
  assert.equal(requests[1].headers.Authorization, `Bearer ${secret}`);
  assert.deepEqual(requests.map(x => JSON.parse(x.body).variables.serviceId), ['telegram-service', 'vk-service']);
  assert.ok(requests.every(x => x.method === 'POST' && !/mutation/i.test(JSON.parse(x.body).query)));
  assert.ok(!JSON.stringify(output).includes(secret));
  assert.ok(!JSON.stringify(output).includes('private-value-not-for-logs'));
});

test('recognizes the wrong header when a correctly scoped project token is detected', async () => {
  const { fetchImpl, requests } = recorder([
    denied(),
    result({ data: { projectToken: { projectId: 'expected-project', environmentId: 'expected-environment' } } })
  ]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.deepEqual(output, { status: 'project_token_wrong_header', stage: 'telegram', mutations: 0 });
  assert.equal(requests[1].headers['Project-Access-Token'], secret);
  assert.ok(!('Authorization' in requests[1].headers));
});

test('rejects a valid project token for another environment without outputting identifiers', async () => {
  const { fetchImpl } = recorder([
    denied(),
    result({ data: { projectToken: { projectId: 'expected-project', environmentId: 'foreign' } } })
  ]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.equal(output.status, 'project_token_wrong_scope');
  assert.ok(!JSON.stringify(output).includes('foreign'));
});

test('leaves revoked, wrong-workspace or insufficient-scope account tokens unresolved', async () => {
  const { fetchImpl } = recorder([denied(), denied()]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.deepEqual(output, { status: 'bearer_access_unresolved', stage: 'telegram', mutations: 0 });
});

test('rejects HTTP failures and malformed responses without reflecting server-supplied messages', async () => {
  const { fetchImpl } = recorder([result({ errors: [{ message: secret }] }, 403), denied()]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.equal(output.status, 'bearer_access_unresolved');
  assert.ok(!JSON.stringify(output).includes(secret));
});

test('does not probe another auth header after rate limit or transport error', async () => {
  for (const response of [result({}, 429), { status: 500, ok: false, json: async () => { throw new Error('bad json'); } }]) {
    const { fetchImpl, requests } = recorder([response]);
    const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
    assert.equal(output.status, 'transport_unavailable');
    assert.equal(requests.length, 1);
  }
});

test('does not send a request when secret is missing', async () => {
  const { fetchImpl, requests } = recorder([]);
  const output = await diagnoseRailwayCiAccess({ token: '', fetchImpl, production });
  assert.deepEqual(output, { status: 'missing_ci_token', mutations: 0 });
  assert.equal(requests.length, 0);
});

test('detects second-service denial after first successful check', async () => {
  const { fetchImpl, requests } = recorder([authorized(), denied(), denied()]);
  const output = await diagnoseRailwayCiAccess({ token: secret, fetchImpl, production });
  assert.equal(output.status, 'bearer_access_unresolved');
  assert.equal(output.stage, 'vk');
  assert.equal(requests.length, 3);
});


test('operator diagnosis is manual, main-only and read-only before discovery', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../.github/workflows/railway-operator.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /default: diagnose/);
  assert.match(workflow, /options:\s+- diagnose\s+- discover/);
  assert.match(workflow, /- name: Diagnose CI Railway token scope without printing secrets\s+if: inputs\.mode == 'diagnose'/);
  assert.match(workflow, /- name: Discover Pivnik Railway services \(prints resource metadata\)\s+if: inputs\.mode == 'discover'/);
  assert.match(workflow, /run: node scripts\/railway-ci-access-diagnostic\.mjs --check/);
  assert.match(workflow, /run: node scripts\/railway-discover\.mjs/);
  assert.doesNotMatch(workflow, /railway-deploy-and-verify-production|variableCollectionUpsert/);
});
