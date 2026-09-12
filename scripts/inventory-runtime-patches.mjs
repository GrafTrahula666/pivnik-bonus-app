import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'package.json');

function splitChain(command) {
  return String(command || '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
}

function scriptPathFromCommand(command) {
  const match = /^node\s+([^\s]+\.mjs)$/.exec(command);
  return match?.[1] || null;
}

function collectTouchedFiles(source) {
  const files = new Set();
  const patterns = [
    /patchFile\(\s*['"`]([^'"`]+)['"`]/g,
    /read\(\s*['"`]([^'"`]+)['"`]/g,
    /write\(\s*['"`]([^'"`]+)['"`]/g,
    /readFile\(\s*(?:path\.join\([^,]+,\s*)?['"`]([^'"`]+)['"`]/g,
    /writeFile\(\s*(?:path\.join\([^,]+,\s*)?['"`]([^'"`]+)['"`]/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = String(match[1] || '').trim();
      if (!candidate || candidate.startsWith('.pivnik-')) continue;
      if (/\.(?:js|mjs|css|html|json|sql)$/i.test(candidate)) files.add(candidate);
    }
  }

  return [...files].sort();
}

const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const prestart = splitChain(pkg.scripts?.prestart);
const rows = [];

for (const command of prestart) {
  const scriptPath = scriptPathFromCommand(command);
  if (!scriptPath) {
    rows.push({ command, script: null, files: [], status: 'non-node-script' });
    continue;
  }

  const absolutePath = path.join(root, scriptPath);
  let source;
  try {
    source = await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    rows.push({ command, script: scriptPath, files: [], status: `unreadable: ${error.code || error.message}` });
    continue;
  }

  rows.push({
    command,
    script: scriptPath,
    files: collectTouchedFiles(source),
    status: 'ok'
  });
}

const unreadable = rows.filter((row) => row.status !== 'ok');
if (unreadable.length) {
  throw new Error(
    `Runtime patch inventory incomplete: ${unreadable.map((row) => `${row.command} (${row.status})`).join(', ')}`
  );
}

console.log('Runtime patch inventory:');
for (const [index, row] of rows.entries()) {
  const files = row.files.length ? row.files.join(', ') : 'no static file touchpoints detected';
  console.log(`${String(index + 1).padStart(2, '0')}. ${row.script}: ${files}`);
}

const touchedBy = new Map();
for (const row of rows) {
  for (const file of row.files) {
    const owners = touchedBy.get(file) || [];
    owners.push(row.script);
    touchedBy.set(file, owners);
  }
}

console.log('\nShared mutable surfaces:');
for (const [file, scripts] of [...touchedBy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (scripts.length > 1) console.log(`- ${file}: ${scripts.length} patchers`);
}
