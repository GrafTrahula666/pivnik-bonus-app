import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(root, 'index.html');
const appPath = path.join(root, 'app.js');
const INDEX_MARKER = '<!-- RED_COSMOS_V2_FINAL_SHELL -->';
const CANONICAL_STYLE_VERSION = '20.2-home-v2-large-iphone-fit';
const INTERACTION_FALLBACK_SRC = '/red-cosmos-v2.js?v=2.0.0';

function stripLegacyVisualLayers(source) {
  return source
    .replace(/\s*<link rel="stylesheet" href="\/v22\.css[^"]*"\s*\/>/g, '')
    .replace(/\s*<script defer src="\/v22-ui\.js[^"]*"><\/script>/g, '')
    .replace(/\s*<link rel="stylesheet" href="\/red-cosmos-v2\.css[^"]*"\s*\/>/g, '')
    .replace(/\s*<link rel="stylesheet" href="\/black-frosted-glass\.css[^"]*"\s*\/>/g, '')
    .replace(/\s*<link rel="stylesheet" href="\/black-frosted-surfaces\.css[^"]*"\s*\/>/g, '')
    .replace(/\s*<link rel="stylesheet" href="\/black-frosted-controls\.css[^"]*"\s*\/>/g, '');
}

let index = stripLegacyVisualLayers(await fs.readFile(indexPath, 'utf8'));

index = index.replace(
  /styles\.css\?v=[^"]+/g,
  `styles.css?v=${CANONICAL_STYLE_VERSION}`
);
index = index.replace(
  /app\.js\?v=[^"]+/g,
  `app.js?v=${CANONICAL_STYLE_VERSION}`
);

if (!index.includes(INTERACTION_FALLBACK_SRC)) {
  const appScript = new RegExp(
    '(<script defer src="app\\.js\\?v=' + CANONICAL_STYLE_VERSION.replaceAll('.', '\\.') + '"><\\/script>)'
  );
  if (!appScript.test(index)) throw new Error('Canonical app.js script tag not found');
  index = index.replace(appScript, `$1\n  <script defer src="${INTERACTION_FALLBACK_SRC}"></script>`);
}

if (!index.includes(INDEX_MARKER)) index += `\n${INDEX_MARKER}\n`;

const forbiddenVisualAssets = [
  '/v22.css',
  '/v22-ui.js',
  '/red-cosmos-v2.css',
  '/black-frosted-glass.css',
  '/black-frosted-surfaces.css',
  '/black-frosted-controls.css'
];

for (const asset of forbiddenVisualAssets) {
  if (index.includes(asset)) throw new Error(`Legacy visual layer still wired: ${asset}`);
}

if (!index.includes(`styles.css?v=${CANONICAL_STYLE_VERSION}`)) {
  throw new Error('Canonical SPACEVERSE white-gold stylesheet is not wired');
}
if (!index.includes(INTERACTION_FALLBACK_SRC)) {
  throw new Error('VK interaction fallback is not wired');
}

await fs.writeFile(indexPath, index, 'utf8');

const app = await fs.readFile(appPath, 'utf8');
if (!app.includes('SPACEVERSE_CANONICAL_THEME_LOCK')) {
  throw new Error('Canonical SPACEVERSE palette lock is missing from app.js');
}
const shellInputVersionSupported = app.includes("const APP_VERSION = '22.0-pivnik-rebuild';")
  || app.includes("const APP_VERSION = '20.0-spaceverse-purple-home';");
if (!shellInputVersionSupported) {
  throw new Error('Unsupported client version reached canonical shell finalization');
}

console.log('Canonical SPACEVERSE white-gold shell verified; legacy RED COSMOS/black-frosted visual layers are retired.');
