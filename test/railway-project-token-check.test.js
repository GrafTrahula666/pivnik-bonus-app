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
    "  if (query.includes('projectToken')) return new Response(JSON.stringify({",
    "    data: { projectToken: {",
    "      projectId: process.env.FIXTURE_MODE === 'wrong_scope' ? 'another-project' : process.env.EXPECTED_PROJECT,",
    "      environmentId: process.env.EXPECTED_ENVIRONMENT",
    "    } }",
    "  }), { status: 200 });",
    "  if (!query.includes('unrendered: false')) throw new Error('UNRENDERED_SECRETS_PROHIBITED');",
    "  const values = { SESSION_SECRET: 's'.repeat(48), IDENTITY_TOMBSTONE_SECRET: 't'.repeat(48), NODE_ENV: 'production', ALLOW_DEMO: 'false' };",
    "  return new Response(JSON.stringify({ data: { variables: values } }), { status: 200 });",
    "};",
    "process.on('exit', () => {",
    "  const expected = process.env.FIXTURE_MODE === 'wrong_scope' ? 2 : 4;",
    "  if (requests !== expected) throw new Error('Expected ' + expected + ' safe reads, got ' + requests);",
    "});"
  ].join('\n'));
  const run = mode => execFileSync(process.execPath, [
    '--import', pathToFileURL(fixture).href,
    path.join(root, 'scripts/railway-ensure-production-secrets.mjs'), '--check'
  ], {
    encoding: 'utf8', stdio: 'pipe', timeout: 6000,
    env: {
      PATH: process.env.PATH,
      RAILWAY_API_TOKEN: 'fixture-project-token',
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
    assert.throws(() => run('wrong_scope'), error => {
      assert.match(error.stderr, /operator review required/);
      assert.doesNotMatch(error.stderr, /fixture-project-token|another-project|UNEXPECTED_MUTATION/);
      return true;
    });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
