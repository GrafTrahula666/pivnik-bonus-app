import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) {
    throw new Error(`Не найден final-fix фрагмент: ${label}`);
  }
  return source.replace(from, to);
}

let gateway = await fs.readFile(gatewayPath, 'utf8');

gateway = replaceRequired(
  gateway,
  "const TERMS_VERSION = 'beta-0.4';",
  "const TERMS_VERSION = '2026-08-04';",
  'production terms version'
);

gateway = replaceRequired(
  gateway,
  `async function serveLegalDocument(res, filePath) {`,
  `function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function serveLegalDocument(res, filePath) {`,
  'legal HTML escaping helper'
);

gateway = replaceRequired(
  gateway,
  `(result, [token, value]) => result.replaceAll(token, safeText(value, 1000, 'не настроено')),`,
  `(result, [token, value]) => result.replaceAll(
        token,
        escapeHtml(safeText(value, 1000, 'не настроено'))
      ),`,
  'escaped legal replacements'
);

for (const marker of [
  "const TERMS_VERSION = '2026-08-04';",
  'function escapeHtml(value)',
  "escapeHtml(safeText(value, 1000, 'не настроено'))"
]) {
  if (!gateway.includes(marker)) {
    throw new Error(`Final production fix verification failed: ${marker}`);
  }
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Pivnik final production fixes applied and verified.');
