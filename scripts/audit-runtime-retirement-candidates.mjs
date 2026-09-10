import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

function splitChain(command) {
  return String(command || '')
    .split('&&')
    .map((part) => part.trim())
    .filter(Boolean);
}

function scriptPath(command) {
  return /^node\s+([^\s]+\.mjs)$/.exec(command)?.[1] || null;
}

function markerFromSource(source) {
  return /const\s+marker\s*=\s*(['"`])([\s\S]*?)\1\s*;/.exec(source)?.[2] || null;
}

function collectStaticTargets(source) {
  const targets = new Set();
  const pathVars = new Map();

  for (const match of source.matchAll(/const\s+(\w+Path)\s*=\s*path\.join\(root,\s*['"`]([^'"`]+)['"`]\)/g)) {
    pathVars.set(match[1], match[2]);
    targets.add(match[2]);
  }

  for (const match of source.matchAll(/(?:readFile|writeFile)\(\s*(\w+Path)\b/g)) {
    if (pathVars.has(match[1])) targets.add(pathVars.get(match[1]));
  }

  for (const match of source.matchAll(/(?:patchFile|read|write)\(\s*['"`]([^'"`]+)['"`]/g)) {
    targets.add(match[1]);
  }

  return [...targets].filter((target) => /\.(?:js|mjs|css|html|json|sql)$/i.test(target)).sort();
}

async function markerPresence(marker, targets) {
  if (!marker || !targets.length) return [];
  const presence = [];
  for (const target of targets) {
    try {
      const content = await fs.readFile(path.join(root, target), 'utf8');
      presence.push({ target, present: content.includes(marker) });
    } catch {
      presence.push({ target, present: false, unreadable: true });
    }
  }
  return presence;
}

const prestart = splitChain(pkg.scripts?.prestart);
const materialize = new Set(splitChain(pkg.scripts?.materialize));
const rows = [];

for (const command of prestart) {
  const script = scriptPath(command);
  if (!script) continue;

  const source = await fs.readFile(path.join(root, script), 'utf8');
  const marker = markerFromSource(source);
  const targets = collectStaticTargets(source);
  const presence = await markerPresence(marker, targets);
  const markerPresent = Boolean(marker) && presence.some((entry) => entry.present);
  const materializedExplicitly = materialize.has(command);
  const databaseRelated = /(?:db|database|migration|migrate)/i.test(command);

  let classification = 'needs-manual-proof';
  if (databaseRelated) classification = 'keep-database-step';
  else if (marker && !markerPresent) classification = 'still-mutates-clean-checkout';
  else if (marker && markerPresent && !materializedExplicitly) classification = 'retirement-candidate';
  else if (materializedExplicitly) classification = 'materialized-release-step';

  rows.push({
    script,
    marker,
    targets,
    presence,
    materializedExplicitly,
    classification
  });
}

console.log('Runtime patch retirement audit:');
for (const row of rows) {
  const markerSummary = row.marker
    ? row.presence.map((entry) => `${entry.target}=${entry.present ? 'marker-present' : 'marker-absent'}`).join(', ') || 'no static target'
    : 'no static marker';
  console.log(`- ${row.script}: ${row.classification}; materialize=${row.materializedExplicitly ? 'yes' : 'no'}; ${markerSummary}`);
}

const candidates = rows.filter((row) => row.classification === 'retirement-candidate');
console.log(`\nConservative retirement candidates: ${candidates.length}`);
for (const row of candidates) console.log(`- ${row.script}`);

const unsafeUnknowns = rows.filter((row) => row.classification === 'needs-manual-proof');
if (unsafeUnknowns.length) {
  console.log(`\nManual proof still required: ${unsafeUnknowns.length}`);
  for (const row of unsafeUnknowns) console.log(`- ${row.script}`);
}
