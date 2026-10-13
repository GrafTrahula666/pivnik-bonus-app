import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('Release secret check accepts valid config and fails mismatches without any Railway mutation', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pivnik-secret-check-'));
  const fixture = path.join(temporary, 'network-fixture.mjs');
  await fs.writeFile(fixture, `
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      const { query } = JSON.parse(options.body);
      if (/mutation/.test(query)) throw new Error('FORBIDDEN_MUTATION');
      if (!query.includes('unrendered: false')) throw new Error('Must compare resolved configuration');
      calls++;
      const values = { SESSION_SECRET: 's'.repeat(48), IDENTITY_TOMBSTONE_SECRET: 't'.repeat(48), NODE_ENV: 'production', ALLOW_DEMO: 'false' };
      if (process.env.FIXTURE === 'mismatch' && calls === 2) values.SESSION_SECRET = 'x'.repeat(48);
      if (process.env.FIXTURE === 'missing') delete values.SESSION_SECRET;
      if (process.env.FIXTURE === 'demo') values.ALLOW_DEMO = 'true';
      return new Response(JSON.stringify({ data: { variables: values } }), { status: 200 });
    };
    process.on('exit', () => { if (calls !== 2) throw new Error('Expected exactly two read-only requests'); });
  `);
  try {
    const run = (mode) => execFileSync(process.execPath,
      ['--import', fixture, path.join(root, 'scripts/railway-ensure-production-secrets.mjs'), '--check'], {
        encoding: 'utf8', stdio: 'pipe', timeout: 5000,
        env: { PATH: process.env.PATH, RAILWAY_API_TOKEN: 'fixture-token', FIXTURE: mode }
      });
    const valid = JSON.parse(run('valid'));
    assert.equal(valid.mutations, 0);
    assert.equal(valid.mode, 'check');
    for (const mode of ['mismatch', 'missing', 'demo']) {
      assert.throws(() => run(mode), (error) => {
        assert.match(error.stderr, /operator review/);
        assert.doesNotMatch(error.stderr, /FORBIDDEN_MUTATION|ssssssssssss|xxxxxxxxxxxx|fixture-token/);
        return true;
      });
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
