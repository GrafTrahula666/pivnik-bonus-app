import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const appPath = path.join(root, 'app.js');

let index = await fs.readFile(indexPath, 'utf8');
if (!index.includes('/red-cosmos-v2.css?v=2.0.0')) {
  index = index.replace(
    /(<link rel="stylesheet" href="styles\.css[^"]*"\s*\/>)/,
    '$1\n  <link rel="stylesheet" href="/red-cosmos-v2.css?v=2.0.0" />'
  );
}
if (!index.includes('/red-cosmos-v2.js?v=2.0.0')) {
  index = index.replace(
    /(<script defer src="app\.js[^"]*"><\/script>)/,
    '$1\n  <script defer src="/red-cosmos-v2.js?v=2.0.0"></script>'
  );
}
if (!index.includes('/red-cosmos-v2.css?v=2.0.0') || !index.includes('/red-cosmos-v2.js?v=2.0.0')) {
  throw new Error('RED COSMOS v2 assets were not wired into index.html');
}
await fs.writeFile(indexPath, index, 'utf8');

let app = await fs.readFile(appPath, 'utf8');
if (!app.includes('RED_COSMOS_V2_THEME_LOCK')) {
  const pattern = /function applyDesign\(design\) \{[\s\S]*?\n\}\n\nfunction renderBeer/;
  if (!pattern.test(app)) throw new Error('applyDesign() was not found');
  const replacement = `function applyDesign(design) {
  if (!design) return;
  state.design = deepClone(design);
  const root = document.documentElement;
  // RED_COSMOS_V2_THEME_LOCK: content configuration must not change product colors.
  root.style.setProperty('--radius', String(Number(design.radius || 20)) + 'px');

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
  } catch (_) {}
}

function renderBeer`;
  app = app.replace(pattern, replacement);
}
if (!app.includes('RED_COSMOS_V2_THEME_LOCK')) throw new Error('RED COSMOS theme lock did not materialize');
await fs.writeFile(appPath, app, 'utf8');

console.log('RED COSMOS v2 phase-1 materialized.');
