import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT_MARKER = 'PIVNIK_V22_PRODUCT_REBUILD_20260827';
const SPECIAL_MARKER = 'PIVNIK_V22_SPECIAL_ACHIEVEMENT_20260827';

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function importFresh(relativePath, tag) {
  const url = pathToFileURL(path.join(root, relativePath));
  url.searchParams.set('v22-runtime', `${tag}-${Date.now()}`);
  return import(url.href);
}

const [app, server, gateway] = await Promise.all([
  read('app.js'), read('server.js'), read('universal-server.js')
]);

// A Railway healthcheck retry restarts npm in the same writable container.
// Once RED COSMOS has already transformed the legacy v22 files, the old v22
// version/frame assertions are no longer valid. Treat that state as the final
// materialized target and verify RED COSMOS invariants instead of trying to
// rebuild v22 over it again.
const redCosmosAlreadyApplied = app.includes('RED_COSMOS_V2_THEME_LOCK')
  || server.includes('RED_COSMOS_V2_FINAL_SERVER_RUNTIME')
  || gateway.includes('RED_COSMOS_V2_FINAL_GATEWAY_RUNTIME');

if (redCosmosAlreadyApplied) {
  const failures = [];
  if (!app.includes('RED_COSMOS_V2_THEME_LOCK')) failures.push('theme lock');
  if (!server.includes('RED_COSMOS_V2_FINAL_SERVER_RUNTIME')) failures.push('server runtime');
  if (!gateway.includes('RED_COSMOS_V2_FINAL_GATEWAY_RUNTIME')) failures.push('gateway runtime');
  if (gateway.includes('Колесо доступно только в Telegram.')) failures.push('VK wheel guard');
  if (!gateway.includes('platformLabel')) failures.push('leaderboard platform');
  if (failures.length) throw new Error(`RED COSMOS restart verification failed: ${failures.join(', ')}`);
  console.log('RED COSMOS runtime already materialized; restart-safe legacy v22 skip.');
  process.exit(0);
}

const productApplied = app.includes(`// ${PRODUCT_MARKER}:app`)
  && server.includes(`// ${PRODUCT_MARKER}:server`)
  && gateway.includes(`// ${PRODUCT_MARKER}:gateway`);

if (!productApplied) {
  await importFresh('scripts/apply-v22-product-rebuild.mjs', 'product');
} else {
  console.log('Pivnik v22 product rebuild already materialized; restart-safe skip.');
}

const [serverAfterProduct, gatewayAfterProduct] = await Promise.all([
  read('server.js'), read('universal-server.js')
]);
const specialApplied = serverAfterProduct.includes(`// ${SPECIAL_MARKER}:server`)
  && gatewayAfterProduct.includes(`// ${SPECIAL_MARKER}:gateway`);

if (!specialApplied) {
  await importFresh('scripts/apply-v22-special-achievement.mjs', 'special');
} else {
  console.log('Pivnik v22 special achievement already materialized; restart-safe skip.');
}

const [finalApp, finalServer, finalGateway] = await Promise.all([
  read('app.js'), read('server.js'), read('universal-server.js')
]);
const failures = [];
if (!finalApp.includes("APP_VERSION = '22.0-pivnik-rebuild'")) failures.push('client version');
if (!finalApp.includes('window.__PIVNIK_GO_BACK__')) failures.push('screen history');
if (!finalServer.includes("'frame-middle-finger': { frame: 'middle-finger'")) failures.push('shop frames');
if (!finalGateway.includes('platformLabel')) failures.push('leaderboard platform');
if (finalGateway.includes('Колесо доступно только в Telegram.')) failures.push('VK wheel guard');
if (!finalServer.includes("code: 'raise-shields'")) failures.push('special tester achievement');
if (!finalGateway.includes("achievement_code = 'raise-shields'")) failures.push('special tester lookup');
if (failures.length) throw new Error(`v22 runtime verification failed: ${failures.join(', ')}`);

console.log('Pivnik v22 runtime state is restart-safe and verified.');
