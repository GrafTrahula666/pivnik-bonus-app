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

function normalizeLegalRenderer(source) {
  const escapeMarker = 'function escapeHtml(value) {';
  const rendererMarker = 'async function serveLegalDocument(res, filePath) {';
  const nextFunctionMarker = "function platformFromRequest(req, fallback = 'unknown') {";

  const escapeIndex = source.indexOf(escapeMarker);
  const rendererIndex = source.indexOf(rendererMarker);
  const starts = [escapeIndex, rendererIndex].filter((index) => index >= 0);
  if (!starts.length) {
    throw new Error('Не найден legal renderer после materialization.');
  }
  const regionStart = Math.min(...starts);
  const regionEnd = source.indexOf(nextFunctionMarker, regionStart);
  if (regionEnd < 0) {
    throw new Error('Не найдена граница platformFromRequest после legal renderer.');
  }

  const canonical = `function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function serveLegalDocument(res, filePath) {
  try {
    const template = await fs.readFile(filePath, 'utf8');
    const replacements = {
      '{{LEGAL_OPERATOR_NAME}}': legalOperatorName || 'Оператор не настроен',
      '{{LEGAL_OPERATOR_ID}}': legalOperatorId || 'не настроено',
      '{{LEGAL_CONTACT_EMAIL}}': legalContactEmail || 'не настроено',
      '{{LEGAL_OPERATOR_ADDRESS}}': legalOperatorAddress || BAR_ADDRESS,
      '{{LEGAL_DATA_RETENTION_POLICY}}': legalDataRetentionPolicy || 'не настроено'
    };
    const html = Object.entries(replacements).reduce(
      (result, [token, value]) => result.replaceAll(
        token,
        escapeHtml(safeText(value, 1000, 'не настроено'))
      ),
      template
    );
    const body = Buffer.from(html);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Документ не найден.' });
  }
}

`;

  const normalized = `${source.slice(0, regionStart)}${canonical}${source.slice(regionEnd)}`;
  const rendererCount = normalized.split(rendererMarker).length - 1;
  const escapeCount = normalized.split(escapeMarker).length - 1;
  if (rendererCount !== 1 || escapeCount !== 1) {
    throw new Error(`Legal renderer normalization failed: renderer=${rendererCount}, escape=${escapeCount}`);
  }
  return normalized;
}

function normalizeTermsVersion(source) {
  if (source.includes("const TERMS_VERSION = 'beta-0.4';")) {
    return source.replace("const TERMS_VERSION = 'beta-0.4';", "const TERMS_VERSION = '2026-08-04';");
  }
  if (/const TERMS_VERSION = '\d{4}-\d{2}-\d{2}';/.test(source)) return source;
  throw new Error('Не найдена допустимая production terms version.');
}

let gateway = await fs.readFile(gatewayPath, 'utf8');
gateway = normalizeDeletedIdentityGuards(gateway);
gateway = normalizeLegalRenderer(gateway);
gateway = normalizeTermsVersion(gateway);

for (const marker of [
  'function escapeHtml(value)',
  "escapeHtml(safeText(value, 1000, 'не настроено'))",
  ".createHmac('sha256', identityTombstoneSecret)",
  'async function serveLegalDocument(res, filePath)'
]) {
  if (!gateway.includes(marker)) {
    throw new Error(`Final production fix verification failed: ${marker}`);
  }
}
if (!/const TERMS_VERSION = '\d{4}-\d{2}-\d{2}';/.test(gateway)) {
  throw new Error('Final production fix verification failed: production terms version');
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Pivnik final production fixes applied and verified.');
