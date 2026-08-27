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
