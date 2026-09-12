import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(root, 'migrations', '009_spaceverse_tenant_attribution.sql');

async function readMigration() {
  return fs.readFile(migrationPath, 'utf8');
}

test('SPACEVERSE attribution migration is additive and contains no data backfill', async () => {
  const sql = await readMigration();

  assert.match(sql, /ALTER\s+TABLE\s+transactions/i);
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+tenant_id\s+TEXT/i);
  assert.match(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+location_id\s+TEXT/i);

  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|SCHEMA|DATABASE)\b/i);
});

test('SPACEVERSE attribution columns remain nullable with no guessed defaults', async () => {
  const sql = await readMigration();
  const ddl = sql
    .replace(/--.*$/gm, '')
    .replace(/COMMENT\s+ON\s+COLUMN[\s\S]*?;/gi, '');

  assert.doesNotMatch(ddl, /\bNOT\s+NULL\b/i);
  assert.doesNotMatch(ddl, /\bDEFAULT\b/i);
  assert.match(sql, /NULL means attribution is unknown\/unapproved/i);
  assert.match(sql, /never infer or backfill without an authoritative mapping/i);
});

test('production DB prepare does not auto-run SPACEVERSE attribution migration', async () => {
  const prepare = await fs.readFile(path.join(root, 'scripts', 'red-cosmos-v2-db-prepare.mjs'), 'utf8');

  assert.match(prepare, /007_red_cosmos_v2\.sql/);
  assert.doesNotMatch(prepare, /009_spaceverse_tenant_attribution\.sql/);
});
