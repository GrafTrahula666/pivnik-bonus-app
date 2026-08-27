import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const EXPECTED_VERSION = '2.0.3-final-ui';
const expectedCommit = String(process.env.RELEASE_COMMIT_SHA || '').trim();

async function fetchAsset(baseUrl, pathname, expectedType, marker) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      'cache-control': 'no-cache',
      'user-agent': 'pivnik-static-ui-verifier/1.0'
    },
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok) throw new Error(`${baseUrl}${pathname}: HTTP ${response.status}`);
  if (!contentType.includes(expectedType)) {
    throw new Error(`${baseUrl}${pathname}: wrong content-type ${contentType || '<missing>'}`);
  }
  if (/<!doctype html>|<html[\s>]/i.test(body)) {
    throw new Error(`${baseUrl}${pathname}: browser asset was replaced by index.html`);
  }
  if (marker && !body.includes(marker)) {
    throw new Error(`${baseUrl}${pathname}: expected marker missing: ${marker}`);
  }
  return { pathname, contentType, bytes: Buffer.byteLength(body) };
}

async function fetchDocument(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'cache-control': 'no-cache', 'user-agent': 'pivnik-static-ui-verifier/1.0' },
    signal: AbortSignal.timeout(15_000)
  });
  const html = await response.text();
  if (!response.ok) throw new Error(`${baseUrl}${pathname}: HTTP ${response.status}`);
  for (const token of [
    `/red-cosmos-v2.css?v=${EXPECTED_VERSION}`,
    `/red-cosmos-v2.js?v=${EXPECTED_VERSION}`,
    `/final-ui-hotfix.css?v=${EXPECTED_VERSION}`,
    `/final-ui-hotfix.js?v=${EXPECTED_VERSION}`,
    `app.js?v=${EXPECTED_VERSION}`
  ]) {
    if (!html.includes(token)) throw new Error(`${baseUrl}${pathname}: missing final UI token ${token}`);
  }
  return { pathname, bytes: Buffer.byteLength(html) };
}

async function verifyPlatform(platform, baseUrl, documentPath) {
  const readiness = await fetch(`${baseUrl}/api/release-readiness`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
  if (expectedCommit && readiness.releaseCommit !== expectedCommit) {
    throw new Error(`${platform}: release commit mismatch ${readiness.releaseCommit} != ${expectedCommit}`);
  }
  const [document, redJs, redCss, finalJs, finalCss, appJs] = await Promise.all([
    fetchDocument(baseUrl, documentPath),
    fetchAsset(baseUrl, `/red-cosmos-v2.js?v=${EXPECTED_VERSION}`, 'javascript', 'RED_COSMOS'),
    fetchAsset(baseUrl, `/red-cosmos-v2.css?v=${EXPECTED_VERSION}`, 'text/css', '--primary-red'),
    fetchAsset(baseUrl, `/final-ui-hotfix.js?v=${EXPECTED_VERSION}`, 'javascript', 'PIVNIK_FINAL_UI_HOTFIX_20260827'),
    fetchAsset(baseUrl, `/final-ui-hotfix.css?v=${EXPECTED_VERSION}`, 'text/css', 'PIVNIK FINAL UI HOTFIX'),
    fetchAsset(baseUrl, `/app.js?v=${EXPECTED_VERSION}`, 'javascript', 'PIVNIK_FINAL_WHEEL_UI_20260827')
  ]);
  const appResponse = await fetch(`${baseUrl}/app.js?v=${EXPECTED_VERSION}`, { signal: AbortSignal.timeout(15_000) });
  const appBody = await appResponse.text();
  for (const forbidden of [
    'if (IS_VK || state.wheel.artworkReady) return;',
    'function renderWheelStatus() {\n  if (IS_VK) return;',
    'async function spinWheel() {\n  if (IS_VK ||',
    'function openWheel() {\n  if (IS_VK) return;'
  ]) {
    if (appBody.includes(forbidden)) throw new Error(`${platform}: VK wheel guard remains in production app.js`);
  }
  return { platform, releaseCommit: readiness.releaseCommit, document, assets: [redJs, redCss, finalJs, finalCss, appJs] };
}

const result = await Promise.all([
  verifyPlatform('telegram', RAILWAY_PRODUCTION.urls.telegram, '/'),
  verifyPlatform('vk', RAILWAY_PRODUCTION.urls.vk, '/vk')
]);
console.log(JSON.stringify({ ok: true, version: EXPECTED_VERSION, result }, null, 2));
