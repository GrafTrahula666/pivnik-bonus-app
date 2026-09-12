import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { isStartupMigration } from '../startup-migrations.js';

test('startup only selects the eight approved historical migrations, never 009/010/future SQL',async()=>{
  const files=await readdir(new URL('../migrations',import.meta.url));
  const selected=files.filter(isStartupMigration);
  assert.equal(selected.length,8);
  for(const file of ['009_spaceverse_tenant_attribution.sql','010_spaceverse_customer_360.sql','011_future.sql','999_surprise.sql'])
    assert.equal(isStartupMigration(file),false);
  const source=await readFile(new URL('../universal-server.js',import.meta.url),'utf8');
  assert.match(source,/const migrationFiles = \(await fs\.readdir\(migrationDirectory\)\)\s*\.filter\(isStartupMigration\)/);
});
