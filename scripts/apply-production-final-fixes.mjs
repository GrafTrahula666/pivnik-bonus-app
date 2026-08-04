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

function normalizeDeletedIdentityGuards(source) {
  const functionMarker = 'function deletedIdentityHash(provider, providerUserId) {';
  const consentMarker = 'async function acceptConsent(userId, platform) {';
  const firstIndex = source.indexOf(functionMarker);
  if (firstIndex < 0) {
    throw new Error('Не найден deletedIdentityHash после материализации.');
  }

  let normalized = source;
  let duplicateIndex = normalized.indexOf(functionMarker, firstIndex + functionMarker.length);
  while (duplicateIndex >= 0) {
    const consentIndex = normalized.indexOf(consentMarker, duplicateIndex);
    if (consentIndex < 0) {
      throw new Error('Не найдена граница дублированного deletion guard.');
    }
    normalized = `${normalized.slice(0, duplicateIndex)}${normalized.slice(consentIndex)}`;
    duplicateIndex = normalized.indexOf(functionMarker, firstIndex + functionMarker.length);
  }

  const consentIndex = normalized.indexOf(consentMarker, firstIndex);
  if (consentIndex < 0) {
    throw new Error('Не найдена функция acceptConsent после deletion guard.');
  }
  const guardBlock = normalized.slice(firstIndex, consentIndex).replace(
    ".createHmac('sha256', sessionSecret)",
    ".createHmac('sha256', identityTombstoneSecret)"
  );
  normalized = `${normalized.slice(0, firstIndex)}${guardBlock}${normalized.slice(consentIndex)}`;

  const declarationCount = normalized.split(functionMarker).length - 1;
  if (declarationCount !== 1) {
    throw new Error(`Ожидалась одна deletedIdentityHash, найдено: ${declarationCount}`);
  }
  return normalized;
}

let gateway = await fs.readFile(gatewayPath, 'utf8');
gateway = normalizeDeletedIdentityGuards(gateway);

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
  "escapeHtml(safeText(value, 1000, 'не настроено'))",
  ".createHmac('sha256', identityTombstoneSecret)"
]) {
  if (!gateway.includes(marker)) {
    throw new Error(`Final production fix verification failed: ${marker}`);
  }
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Pivnik final production fixes applied and verified.');
