import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const outDir = path.join(root, 'vk-hosting-build');

function normalizeApiBase(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('PIVNIK_VK_API_BASE is required for VK Hosting build.');
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error('PIVNIK_VK_API_BASE must use HTTPS.');
  const host = url.hostname.toLowerCase();
  if (host === 'vercel.app' || host.endsWith('.vercel.app')) {
    throw new Error('VK Hosting gateway must not use vercel.app.');
  }
  if (host === 'up.railway.app' || host.endsWith('.up.railway.app')) {
    throw new Error('VK Hosting gateway must not expose Railway directly.');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

const apiBase = normalizeApiBase(process.env.PIVNIK_VK_API_BASE);

const VK_TELEGRAM_PARITY_CSS = `/* Selectel VK client parity with Telegram.
   Transport/auth remain VK-specific; shared client surface and background match Telegram. */
html.platform-vk,
html.platform-vk body {
  background:#05070a!important;
}
html.platform-vk body::before,
html.platform-vk body::after {
  content:none!important;
  display:none!important;
  animation:none!important;
}
html.platform-vk #appShell,
html.platform-vk #appShell>main,
html.platform-vk .screen {
  background:transparent!important;
  background-image:none!important;
  animation:none!important;
}
html.platform-vk .app-shell::before {
  background:url('/assets/backgrounds/luxury-vip-space.webp?v=17.0') center top / cover no-repeat!important;
  filter:brightness(1.72) saturate(1.22) contrast(1.06)!important;
  opacity:1!important;
  pointer-events:none!important;
}
html.platform-vk .home-feature-grid {
  grid-template-columns:1fr!important;
}
html.platform-vk .home-achievement-card {
  min-height:192px!important;
}
html.platform-vk .client-tip {
  display:none!important;
}
`;

function assertVkClientParity(html) {
  const requiredFragments = [
    'id="openWheelButton"',
    'data-screen="wheel"',
    'id="wheelSpinButton"',
    'id="openAchievementsButton"',
    'id="openProfileShop"',
    'data-screen="actions"',
    'data-screen="league"',
    'data-screen="profile"'
  ];
  const missing = requiredFragments.filter((fragment) => !html.includes(fragment));
  if (missing.length) {
    throw new Error(`VK Telegram-parity build is missing client surface: ${missing.join(', ')}`);
  }
  if (html.includes('telegram-wheel-legacy:start')) {
    throw new Error('VK Telegram-parity build still contains the legacy home surface.');
  }
  if (/telegram\.org\/js\/telegram-web-app\.js/i.test(html)) {
    throw new Error('VK Telegram-parity build still contains Telegram WebApp runtime.');
  }
}

function assertVkWheelRuntime(source) {
  const forbiddenPatterns = [
    /function renderWheelArtwork\(\)[\s\S]{0,120}if \(IS_VK/,
    /function renderWheelStatus\(\)[\s\S]{0,120}if \(IS_VK/,
    /function startWheelCountdown\(\)[\s\S]{0,160}if \(IS_VK/,
    /async function loadWheelStatus\(\)[\s\S]{0,180}if \(IS_VK/,
    /async function spinWheel\(\)[\s\S]{0,160}if \(IS_VK/,
    /function openWheel\(\)[\s\S]{0,120}if \(IS_VK/,
    /async function refreshMe\(\)[\s\S]{0,220}if \(!IS_VK\) void loadWheelStatus/,
    /async function loadSecondaryData\(\)[\s\S]{0,320}if \(!IS_VK\) jobs\.push\(loadWheelStatus/
  ];
  const remaining = forbiddenPatterns.filter((pattern) => pattern.test(source));
  if (remaining.length) {
    throw new Error(`VK wheel runtime is still platform-disabled (${remaining.length} guard(s)).`);
  }
}

async function copyIfExists(relativePath) {
  const clean = relativePath.replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return;
  const source = path.join(root, clean);
  const target = path.join(outDir, clean);
  try {
    const stat = await fs.stat(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (stat.isDirectory()) await fs.cp(source, target, { recursive: true });
    else await fs.copyFile(source, target);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function renderVkIndex(source) {
  let html = source.replace(
    /<link rel="stylesheet" href="styles\.css([^\"]*)"\s*\/>/i,
    '<link rel="stylesheet" href="styles.css$1" />\n  <link rel="stylesheet" href="/loader-fix.css?v=2.1.0" />'
  );
  html = html.replace(
    /<script defer src="app\.js([^\"]*)"><\/script>/i,
    '<script defer src="/account-link.js?v=2.3.0"></script>\n  <script defer src="app.js$1"></script>'
  );
  html = html
    .replace(/<!-- telegram-wheel-legacy:start -->[\s\S]*?<!-- telegram-wheel-legacy:end -->/g, '')
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(
      /<script defer src="\/account-link\.js([^\"]*)"><\/script>/i,
      '<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\n  <script defer src="/account-link.js$1"></script>'
    );

  const runtimeConfig = `<script>window.__PIVNIK_VK_API_BASE__=${JSON.stringify(apiBase)};</script>`;
  const parityStylesheet = '<link rel="stylesheet" href="/vk-telegram-parity.css?v=20260903-2" />';
  if (!html.includes('</head>')) throw new Error('index.html has no </head>.');
  return html.replace('</head>', `  ${parityStylesheet}\n  ${runtimeConfig}\n</head>`);
}

function patchVkRuntime(source) {
  const marker = "  const originalFetch = window.fetch.bind(window);";
  if (!source.includes(marker)) throw new Error('vk-platform.js originalFetch marker not found.');

  const helper = `${marker}\n  const configuredApiBase = String(window.__PIVNIK_VK_API_BASE__ || '').trim().replace(/\\/+$/, '');\n\n  function resolveGatewayInput(input) {\n    if (!configuredApiBase) return input;\n    try {\n      const requestUrl = typeof input === 'string' ? input : input?.url || '';\n      const parsed = new URL(requestUrl, window.location.href);\n      const isApi = parsed.pathname === '/api' || parsed.pathname.startsWith('/api/');\n      const isRelativeApi = typeof input === 'string' && /^\\/api(?:\\/|$)/.test(requestUrl);\n      const isSameOriginApi = parsed.origin === window.location.origin && isApi;\n      if (!isRelativeApi && !isSameOriginApi) return input;\n      const target = configuredApiBase + parsed.pathname + parsed.search;\n      if (typeof Request !== 'undefined' && input instanceof Request) return new Request(target, input);\n      return target;\n    } catch (_) {\n      return input;\n    }\n  }`;

  let patched = source.replace(marker, helper);
  const matches = patched.match(/originalFetch\(input/g) || [];
  if (matches.length !== 2) {
    throw new Error(`Expected exactly 2 originalFetch(input calls, found ${matches.length}.`);
  }
  patched = patched.replace(/originalFetch\(input/g, 'originalFetch(resolveGatewayInput(input)');
  if (/originalFetch\(input/.test(patched)) throw new Error('VK runtime still contains un-routed API fetch.');
  return patched;
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const sourceHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const renderedHtml = renderVkIndex(sourceHtml);
assertVkClientParity(renderedHtml);
await fs.writeFile(path.join(outDir, 'index.html'), renderedHtml);
await fs.writeFile(path.join(outDir, 'vk-telegram-parity.css'), VK_TELEGRAM_PARITY_CSS);

for (const directory of ['assets', 'vendor']) await copyIfExists(directory);

const references = new Set();
for (const match of renderedHtml.matchAll(/(?:src|href)="([^\"]+)"/g)) {
  const raw = String(match[1] || '');
  if (!raw || /^(?:https?:|data:|#)/i.test(raw)) continue;
  references.add(raw.replace(/^\/+/, '').split(/[?#]/)[0]);
}
for (const file of references) await copyIfExists(file);

const appRuntime = await fs.readFile(path.join(outDir, 'app.js'), 'utf8');
assertVkWheelRuntime(appRuntime);

// In the Railway runtime this browser bundle is served directly from
// node_modules. VK Native Hosting is static, so materialize that dependency
// into the output directory explicitly.
const vkBridgeSource = path.join(
  root,
  'node_modules',
  '@vkontakte',
  'vk-bridge',
  'dist',
  'browser.min.js'
);
const vkBridgeTarget = path.join(outDir, 'vendor', 'vk-bridge.js');
await fs.mkdir(path.dirname(vkBridgeTarget), { recursive: true });
await fs.copyFile(vkBridgeSource, vkBridgeTarget);

const vkRuntimePath = path.join(outDir, 'vk-platform.js');
const vkRuntime = await fs.readFile(vkRuntimePath, 'utf8');
await fs.writeFile(vkRuntimePath, patchVkRuntime(vkRuntime));

const requiredFiles = [
  'index.html',
  'app.js',
  'vk-platform.js',
  'account-link.js',
  'vendor/vk-bridge.js',
  'styles.css',
  'vk-telegram-parity.css',
  'assets/backgrounds/luxury-vip-space.webp'
];
for (const relativePath of requiredFiles) {
  await fs.access(path.join(outDir, relativePath));
}

console.log(JSON.stringify({
  ok: true,
  output: path.relative(root, outDir),
  appId: 54694987,
  apiBase,
  requiredFiles
}, null, 2));
