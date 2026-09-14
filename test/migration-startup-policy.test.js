import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

test('Actual gateway migration loader skips 009 and unknown future files before reading or executing SQL', async () => {
  const source = await fs.readFile(new URL('../universal-server.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function runSqlMigrations(client)');
  const end = source.indexOf('async function claimDataMigration(', start);
  assert.ok(start >= 0 && end > start);
  const read = [];
  const context = vm.createContext({
    isAutomaticStartupMigration, __dirname: '/fixture',
    path: { join: (...parts) => parts.join('/') },
    fs: {
      readdir: async () => ['009_spaceverse_tenant_attribution.sql', '010_unapproved.sql'],
      readFile: async (name) => { read.push(name); throw Error('Gated SQL was read'); }
    }
  });
  vm.runInContext(source.slice(start, end), context);
  const queries = [];
  await context.runSqlMigrations({ query: async (sql) => { queries.push(sql); return { rows: [], rowCount: 0 }; } });
  assert.deepEqual(read, []);
  assert.equal(queries.length, 3, 'only migration bookkeeping and advisory lock/unlock are allowed');
  assert.equal(isAutomaticStartupMigration('008_tester_recipient_aliases.sql'), true);
});
