import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');

const APPROVED_PRESTART_COMMANDS = Object.freeze([
  'node scripts/repair-telegram-runtime.mjs',
  'node scripts/apply-v22-runtime.mjs',
  'node scripts/apply-v22-production-polish.mjs',
  'node scripts/apply-red-cosmos-v2-shell-final.mjs',
  'node scripts/apply-red-cosmos-v2-backend-final.mjs',
  'node scripts/apply-red-cosmos-v2-client-final.mjs',
  'node scripts/apply-red-cosmos-v2-tester-claims.mjs',
  'node scripts/apply-release-candidate-fixes.mjs',
  'node scripts/apply-working-updates.mjs',
  'node scripts/apply-vk-production-hotfix-20260831.mjs',
  'node scripts/red-cosmos-v2-db-prepare.mjs',
  'node scripts/apply-icecream69a-frame.mjs',
  'node scripts/apply-frame-shop-polish.mjs'
]);

const MATERIALIZE_BOOTSTRAP_COMMAND = 'node scripts/materialize-runtime-patches.mjs';
const PRESTART_ONLY_COMMANDS = new Set([
  'node scripts/repair-telegram-runtime.mjs',
  'node scripts/red-cosmos-v2-db-prepare.mjs'
]);

function splitChain(command) {
  return String(command || '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
}

function compareOrdered(actual, expected) {
  return actual.length === expected.length
    && actual.every((command, index) => command === expected[index]);
}

const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const actual = splitChain(pkg.scripts?.prestart);

const unexpected = actual.filter((command) => !APPROVED_PRESTART_COMMANDS.includes(command));
const missing = APPROVED_PRESTART_COMMANDS.filter((command) => !actual.includes(command));
const reordered = actual.length === APPROVED_PRESTART_COMMANDS.length
  && actual.some((command, index) => command !== APPROVED_PRESTART_COMMANDS[index]);

if (unexpected.length || missing.length || reordered) {
  const details = [];
  if (unexpected.length) details.push(`unexpected: ${unexpected.join(', ')}`);
  if (missing.length) details.push(`missing: ${missing.join(', ')}`);
  if (reordered) details.push('approved commands changed order');
  throw new Error(
    `Production prestart patch chain changed without an explicit architecture review (${details.join('; ')}). `
    + 'Update scripts/audit-runtime-patch-chain.mjs only after reviewing restart, rollback and data-migration impact.'
  );
}

const databaseCommands = actual.filter((command) => /(?:db|database|migration|migrate)/i.test(command));
if (!databaseCommands.includes('node scripts/red-cosmos-v2-db-prepare.mjs')) {
  throw new Error('Expected database preparation command is not explicitly identified in the audited prestart chain.');
}

const materializeActual = splitChain(pkg.scripts?.materialize);
const materializeExpected = [
  MATERIALIZE_BOOTSTRAP_COMMAND,
  ...APPROVED_PRESTART_COMMANDS.filter((command) => !PRESTART_ONLY_COMMANDS.has(command))
];

if (!compareOrdered(materializeActual, materializeExpected)) {
  throw new Error(
    'Release materialization chain drifted from production prestart. '
    + `Expected: ${materializeExpected.join(' && ')}. Actual: ${materializeActual.join(' && ')}.`
  );
}

const materializedDatabaseCommands = materializeActual.filter((command) => /(?:db|database|migration|migrate)/i.test(command));
if (materializedDatabaseCommands.length) {
  throw new Error(
    `Release materialization must stay source-only; database command(s) found: ${materializedDatabaseCommands.join(', ')}.`
  );
}

console.log(
  `Runtime patch-chain audit passed: ${actual.length} approved prestart commands; `
  + `${materializeActual.length} source-materialization commands; ${databaseCommands.length} database-related prestart command(s).`
);
