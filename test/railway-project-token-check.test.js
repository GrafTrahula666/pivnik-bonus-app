import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RAILWAY_PRODUCTION } from '../scripts/railway-production-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('read-only production secret gate supports exact-scoped Railway project tokens', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'railway-project-token-check-'));
  const fixture = path.join(temporary, 'fixture.mjs');
  await fs.writeFile(fixture, [
    "let requests = 0;",
    "globalThis.fetch = async (_url, options) => {",
    "  requests++;",
    "  const { query } = JSON.parse(options.body);",
    "  if (/mutation/i.test(query)) throw new Error('UNEXPECTED_MUTATION');",
    "  if (options.headers.authorization) {",
    "    if (options.headers.authorization !== 'Bearer fixture-project-token') throw new Error('BAD_BEARER');",
    "    return new Response(JSON.stringify({ errors: [{ message: 'Not Authorized' }] }), { status: 200 });",
    "  }",
    "  if (options.headers['Project-Access-Token'] !== 'fixture-project-token') throw new Error('BAD_PROJECT_HEADER');",
    "  if (query.includes('projectToken')) {",
    "    const mode = process.env.FIXTURE_MODE;",
    "    if (mode === 'network') throw new Error('PRIVATE_PROVIDER_BODY');",
    "    if (mode === 'malformed') return new Response('PRIVATE_PROVIDER_BODY', { status: 200 });",
    "    if (mode === 'graphql_denial') return new Response(JSON.stringify({ errors: [{ message: 'Not Authorized' }] }), { status: 200 });",
    "    if (mode === 'schema_error') return new Response(JSON.stringify({ errors: [{ message: 'PRIVATE_PROVIDER_BODY' }] }), { status: 200 });",
    "    if (['401', '403', '429', '503', '400'].includes(mode)) return new Response('PRIVATE_PROVIDER_BODY', { status: Number(mode) });",
    "    return new Response(JSON.stringify({",
    "    data: { projectToken: {",
    "      projectId: process.env.FIXTURE_MODE === 'wrong_scope' ? 'another-project' : process.env.EXPECTED_PROJECT,",
    "      environmentId: process.env.FIXTURE_MODE === 'wrong_environment' ? 'another-environment' : process.env.EXPECTED_ENVIRONMENT",
    "    } }",
    "  }), { status: 200 });",
    "  }",
    "  if (!query.includes('unrendered: false')) throw new Error('UNRENDERED_SECRETS_PROHIBITED');",
    "  const values = { SESSION_SECRET: 's'.repeat(48), IDENTITY_TOMBSTONE_SECRET: 't'.repeat(48), NODE_ENV: 'production', ALLOW_DEMO: 'false' };",
    "  return new Response(JSON.stringify({ data: { variables: values } }), { status: 200 });",
    "};",
    "process.on('exit', () => {",
    "  const expected = process.env.FIXTURE_MODE === 'authorized' ? 4 : 2;",
    "  if (requests !== expected) throw new Error('Expected ' + expected + ' safe reads, got ' + requests);",
    "});"
  ].join('\n'));
  const run = (mode, useDedicatedToken = true) => execFileSync(process.execPath, [
    '--import', pathToFileURL(fixture).href,
    path.join(root, 'scripts/railway-ensure-production-secrets.mjs'), '--check'
  ], {
    encoding: 'utf8', stdio: 'pipe', timeout: 6000,
    env: {
      PATH: process.env.PATH,
      RAILWAY_API_TOKEN: useDedicatedToken ? 'unusable-legacy-token' : 'fixture-project-token',
      ...(useDedicatedToken ? { RAILWAY_PRODUCTION_READ_TOKEN: 'fixture-project-token' } : {}),
      EXPECTED_PROJECT: RAILWAY_PRODUCTION.projectId,
      EXPECTED_ENVIRONMENT: RAILWAY_PRODUCTION.environmentId,
      FIXTURE_MODE: mode
    }
  });
  try {
    const output = JSON.parse(run('authorized'));
    assert.equal(output.ok, true);
    assert.equal(output.mutations, 0);
    assert.deepEqual(output.checkedServices, ['telegram', 'vk']);
    assert.equal(JSON.parse(run('authorized', false)).ok, true, 'legacy secret fallback remains supported');
    for (const [mode, code] of [
      ['wrong_scope', 'scope_mismatch'], ['wrong_environment', 'scope_mismatch'],
      ['401', 'authorization_unresolved'], ['403', 'authorization_unresolved'],
      ['graphql_denial', 'authorization_unresolved'],
      ['429', 'transport_unavailable'], ['503', 'transport_unavailable'],
      ['network', 'transport_unavailable'], ['400', 'api_response_unexpected'],
      ['malformed', 'api_response_unexpected'], ['schema_error', 'api_response_unexpected']
    ]) {
      assert.throws(() => run(mode), error => {
        assert.equal(error.status, 1, mode);
        assert.match(error.stderr, new RegExp(code), mode);
        assert.match(error.stderr, /operator review required/, mode);
        assert.doesNotMatch(error.stderr, /fixture-project-token|another-project|another-environment|UNEXPECTED_MUTATION|PRIVATE_PROVIDER_BODY|safe reads, got/, mode);
        return true;
      });
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test('read-only variable reads reject malformed and partial responses on either credential header', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'railway-variable-envelope-'));
  const fixture = path.join(temporary, 'fixture.mjs');
  await fs.writeFile(fixture, [
    "let requests = 0;",
    "const mode = process.env.FIXTURE_MODE;",
    "const project = process.env.FIXTURE_HEADER === 'project';",
    "const second = process.env.FIXTURE_STAGE === 'second';",
    "const valid = { data: { variables: { SESSION_SECRET: 's'.repeat(48), IDENTITY_TOMBSTONE_SECRET: 't'.repeat(48), NODE_ENV: 'production', ALLOW_DEMO: 'false' } } };",
    "const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });",
    "let reads = 0;",
    "globalThis.fetch = async (_url, options) => {",
    "  requests++;",
    "  const { query } = JSON.parse(options.body);",
    "  if (/mutation/i.test(query)) throw new Error('UNEXPECTED_MUTATION');",
    "  if (project && options.headers.authorization) return respond({ errors: [{ message: 'Not Authorized' }] });",
    "  if (query.includes('projectToken')) return respond({ data: { projectToken: { projectId: process.env.EXPECTED_PROJECT, environmentId: process.env.EXPECTED_ENVIRONMENT } } });",
    "  reads++;",
    "  if (mode === 'valid' || (second && reads === 1)) return respond(valid);",
    "  if (mode === 'network') throw new Error('PRIVATE_PROVIDER_BODY');",
    "  if (mode === '503') return respond({ message: 'PRIVATE_PROVIDER_BODY' }, 503);",
    "  if (mode === 'null') return respond(null);",
    "  if (mode === 'errors_object') return respond({ ...valid, errors: { message: 'PRIVATE_PROVIDER_BODY' } });",
    "  if (mode === 'errors_null') return respond({ ...valid, errors: null });",
    "  if (mode === 'partial') return respond({ ...valid, errors: [{ message: 'PRIVATE_PROVIDER_BODY' }] });",
    "  throw new Error('UNEXPECTED_MODE');",
    "};",
    "process.on('exit', () => {",
    "  const expected = (project ? 2 : 0) + ((mode === 'valid' || second) ? 2 : 1);",
    "  if (requests !== expected) throw new Error('Unexpected request count: ' + requests);",
    "});"
  ].join('\n'));
  const run = (mode, header, stage = 'first') => execFileSync(process.execPath, [
    '--import', pathToFileURL(fixture).href,
    path.join(root, 'scripts/railway-ensure-production-secrets.mjs'), '--check'
  ], {
    encoding: 'utf8', stdio: 'pipe', timeout: 6000,
    env: {
      PATH: process.env.PATH,
      RAILWAY_PRODUCTION_READ_TOKEN: 'fixture-read-token',
      EXPECTED_PROJECT: RAILWAY_PRODUCTION.projectId,
      EXPECTED_ENVIRONMENT: RAILWAY_PRODUCTION.environmentId,
      FIXTURE_MODE: mode, FIXTURE_HEADER: header, FIXTURE_STAGE: stage
    }
  });
  try {
    for (const header of ['bearer', 'project']) {
      assert.equal(JSON.parse(run('valid', header)).mutations, 0);
      for (const stage of ['first', 'second']) {
        for (const [mode, code] of [
          ['network', 'transport_unavailable'], ['503', 'transport_unavailable'],
          ['null', 'api_response_unexpected'], ['errors_object', 'api_response_unexpected'],
          ['errors_null', 'api_response_unexpected'], ['partial', 'api_response_unexpected']
        ]) {
          const scenario = [header, stage, mode].join('/');
          assert.throws(() => run(mode, header, stage), error => {
            assert.equal(error.status, 1, scenario);
            assert.match(error.stderr, new RegExp(code), scenario);
            assert.doesNotMatch(error.stderr, /PRIVATE_PROVIDER_BODY|fixture-read-token|UNEXPECTED_MUTATION|Unexpected request count|UNEXPECTED_MODE/, scenario);
            return true;
          });
        }
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
