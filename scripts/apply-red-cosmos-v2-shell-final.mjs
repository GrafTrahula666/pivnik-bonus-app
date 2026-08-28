import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const appPath = path.join(root, 'app.js');
const INDEX_MARKER = '<!-- RED_COSMOS_V2_FINAL_SHELL -->';
const ASSET_VERSION = '2.0.1-interactions';
const CSS_ASSET = `/red-cosmos-v2.css?v=${ASSET_VERSION}`;
const JS_ASSET = `/red-cosmos-v2.js?v=${ASSET_VERSION}`;

let index = await fs.readFile(indexPath, 'utf8');
index = index
  .replace(/\s*<link rel="stylesheet" href="\/v22\.css[^"]*"\s*\/>/g, '')
  .replace(/\s*<script defer src="\/v22-ui\.js[^"]*"><\/script>/g, '')
  .replace(/\/red-cosmos-v2\.css\?v=[^"']+/g, CSS_ASSET)
  .replace(/\/red-cosmos-v2\.js\?v=[^"']+/g, JS_ASSET);

if (!index.includes(CSS_ASSET)) {
  index = index.replace(/(<link rel="stylesheet" href="styles\.css[^"]*"\s*\/>)/, `$1\n  <link rel="stylesheet" href="${CSS_ASSET}" />`);
}
if (!index.includes(JS_ASSET)) {
  index = index.replace(/(<script defer src="app\.js[^"]*"><\/script>)/, `$1\n  <script defer src="${JS_ASSET}"></script>`);
}
if (!index.includes(INDEX_MARKER)) index += `\n${INDEX_MARKER}\n`;

if (!index.includes(CSS_ASSET) || !index.includes(JS_ASSET)) throw new Error('RED COSMOS v2 shell assets not wired');
if (/\/red-cosmos-v2\.(?:css|js)\?v=(?!2\.0\.1-interactions)[^"']+/.test(index)) throw new Error('RED COSMOS v2 shell still references a stale asset version');
if (index.includes('/v22.css') || index.includes('/v22-ui.js')) throw new Error('RED COSMOS v2 shell still loads obsolete v22 UI layer');
await fs.writeFile(indexPath, index, 'utf8');

let app = await fs.readFile(appPath, 'utf8');
if (!app.includes('RED_COSMOS_V2_THEME_LOCK')) {
  const pattern = /function applyDesign\(design\) \{[\s\S]*?\n\}\n\nfunction renderBeer/;
  if (!pattern.test(app)) throw new Error('RED COSMOS v2 shell: applyDesign not found');
  app = app.replace(pattern, `function applyDesign(design) {
  if (!design) return;
  state.design = deepClone(design);
  // RED_COSMOS_V2_THEME_LOCK: server content settings may change copy/radius, never product colors.
  document.documentElement.style.setProperty('--radius', String(Number(design.radius || 20)) + 'px');
  $('#brandTitle').textContent = design.texts?.brand || 'Пивник';
  $('#balanceLabel').textContent = design.texts?.balanceLabel || 'Ваш баланс';
  const legacyQrButton = $('#showQrButton');
  if (legacyQrButton?.lastChild) legacyQrButton.lastChild.textContent = design.texts?.qrButton || 'Показать QR';
  $('#byline').textContent = (design.texts?.byline || 'by Kirill Gamilton') + ' △';
  Object.entries(design.sections || {}).forEach(([key, visible]) => {
    if (key === 'byline') $('#byline').classList.toggle('hidden', !visible);
    else document.querySelectorAll('[data-config-section="' + key + '"]').forEach((element) => element.classList.toggle('hidden', !visible));
  });
  try {
    tg?.setHeaderColor('#16030e');
    tg?.setBackgroundColor('#0d0002');
    tg?.setBottomBarColor('#0d0002');
  } catch (_) {}
}

function renderBeer`);
}
await fs.writeFile(appPath, app, 'utf8');
console.log(`RED COSMOS v2 shell wired (${ASSET_VERSION}) and server palette overrides disabled.`);
