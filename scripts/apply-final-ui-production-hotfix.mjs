import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
const appPath = path.join(root, 'app.js');
const indexPath = path.join(root, 'index.html');
const VERSION = '2.0.3-final-ui';
const SERVER_MARKER = '// PIVNIK_FINAL_ROOT_BROWSER_ASSETS_20260827';
const APP_MARKER = '// PIVNIK_FINAL_WHEEL_UI_20260827';
const INDEX_MARKER = '<!-- PIVNIK_FINAL_UI_ASSETS_20260827 -->';

function replaceAllKnown(source, pairs) {
  for (const [from, to] of pairs) source = source.replaceAll(from, to);
  return source;
}

let server = await fs.readFile(serverPath, 'utf8');
if (!server.includes(SERVER_MARKER)) {
  const anchor = "app.get('/styles.css', (_req, res) => res.sendFile(path.join(__dirname, 'styles.css')));";
  if (!server.includes(anchor)) throw new Error('Final UI hotfix: static styles anchor missing');
  const routes = `const PIVNIK_ROOT_BROWSER_ASSETS = Object.freeze({
  '/loader-fix.css': 'loader-fix.css',
  '/account-link.js': 'account-link.js',
  '/vk-platform.js': 'vk-platform.js',
  '/red-cosmos-v2.css': 'red-cosmos-v2.css',
  '/red-cosmos-v2.js': 'red-cosmos-v2.js',
  '/final-ui-hotfix.css': 'final-ui-hotfix.css',
  '/final-ui-hotfix.js': 'final-ui-hotfix.js'
});
for (const [route, filename] of Object.entries(PIVNIK_ROOT_BROWSER_ASSETS)) {
  app.get(route, (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('X-Pivnik-Static-Asset', '1');
    res.sendFile(path.join(__dirname, filename));
  });
}
${SERVER_MARKER}
`;
  server = server.replace(anchor, routes + "app.get('/styles.css', (_req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(__dirname, 'styles.css')); });");
  server = server.replace(
    "app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));",
    "app.get('/app.js', (_req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(__dirname, 'app.js')); });"
  );
  server = server.replace(
    "app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));",
    "app.get('/', (_req, res) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0'); res.sendFile(path.join(__dirname, 'index.html')); });"
  );
}
for (const token of ['/red-cosmos-v2.js', '/final-ui-hotfix.js', "X-Pivnik-Static-Asset", SERVER_MARKER]) {
  if (!server.includes(token)) throw new Error(`Final UI hotfix static verification missing: ${token}`);
}
await fs.writeFile(serverPath, server, 'utf8');

let app = await fs.readFile(appPath, 'utf8');
app = replaceAllKnown(app, [
  ["function renderWheelArtwork() {\n  if (IS_VK || state.wheel.artworkReady) return;", "function renderWheelArtwork() {\n  if (state.wheel.artworkReady) return;"],
  ["function renderWheelStatus() {\n  if (IS_VK) return;", "function renderWheelStatus() {"],
  ["function startWheelCountdown() {\n  if (IS_VK || state.wheel.countdownTimer) return;", "function startWheelCountdown() {\n  if (state.wheel.countdownTimer) return;"],
  ["async function loadWheelStatus() {\n  if (IS_VK || !state.token || !state.profile?.termsAccepted) return null;", "async function loadWheelStatus() {\n  if (!state.token || !state.profile?.termsAccepted) return null;"],
  ["async function spinWheel() {\n  if (IS_VK || state.wheel.busy) return;", "async function spinWheel() {\n  if (state.wheel.busy) return;"],
  ["function openWheel() {\n  if (IS_VK) return;", "function openWheel() {"],
  ["  if (!IS_VK) void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));", "  void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));"],
  ["  if (!IS_VK) jobs.push(loadWheelStatus());", "  jobs.push(loadWheelStatus());"]
]);
if (!app.includes(APP_MARKER)) app += `\n${APP_MARKER}\n`;
const forbidden = [
  'if (IS_VK || state.wheel.artworkReady) return;',
  'function renderWheelStatus() {\n  if (IS_VK) return;',
  'function startWheelCountdown() {\n  if (IS_VK ||',
  'async function loadWheelStatus() {\n  if (IS_VK ||',
  'async function spinWheel() {\n  if (IS_VK ||',
  'function openWheel() {\n  if (IS_VK) return;'
];
for (const token of forbidden) if (app.includes(token)) throw new Error(`Final UI hotfix: VK wheel guard remains: ${token}`);
await fs.writeFile(appPath, app, 'utf8');

let index = await fs.readFile(indexPath, 'utf8');
index = index
  .replace(/loader-fix\.css\?v=[^"']+/g, `loader-fix.css?v=${VERSION}`)
  .replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${VERSION}`)
  .replace(/app\.js\?v=[^"']+/g, `app.js?v=${VERSION}`)
  .replace(/account-link\.js\?v=[^"']+/g, `account-link.js?v=${VERSION}`)
  .replace(/vk-platform\.js\?v=[^"']+/g, `vk-platform.js?v=${VERSION}`)
  .replace(/\/red-cosmos-v2\.css\?v=[^"']+/g, `/red-cosmos-v2.css?v=${VERSION}`)
  .replace(/\/red-cosmos-v2\.js\?v=[^"']+/g, `/red-cosmos-v2.js?v=${VERSION}`);
if (!index.includes('/final-ui-hotfix.css')) {
  const cssAnchor = `  <link rel="stylesheet" href="/red-cosmos-v2.css?v=${VERSION}" />`;
  if (!index.includes(cssAnchor)) throw new Error('Final UI hotfix: red cosmos stylesheet anchor missing');
  index = index.replace(cssAnchor, `${cssAnchor}\n  <link rel="stylesheet" href="/final-ui-hotfix.css?v=${VERSION}" />`);
}
if (!index.includes('/final-ui-hotfix.js')) {
  const jsAnchor = `  <script defer src="/red-cosmos-v2.js?v=${VERSION}"></script>`;
  if (!index.includes(jsAnchor)) throw new Error('Final UI hotfix: red cosmos script anchor missing');
  index = index.replace(jsAnchor, `${jsAnchor}\n  <script defer src="/final-ui-hotfix.js?v=${VERSION}"></script>`);
}
if (!index.includes(INDEX_MARKER)) index += `\n${INDEX_MARKER}\n`;
for (const token of [`/final-ui-hotfix.css?v=${VERSION}`, `/final-ui-hotfix.js?v=${VERSION}`, `app.js?v=${VERSION}`, INDEX_MARKER]) {
  if (!index.includes(token)) throw new Error(`Final UI hotfix index verification missing: ${token}`);
}
await fs.writeFile(indexPath, index, 'utf8');

console.log(`PIVNIK final UI hotfix materialized: real root assets, cache bust ${VERSION}, VK/TG wheel interaction.`);
