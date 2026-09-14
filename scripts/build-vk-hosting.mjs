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

function assertVkClientSurface(html) {
  const requiredFragments = [
    'id="openWheelButton"',
    'data-screen="wheel"',
    'id="wheelSpinButton"',
    'id="openAchievementsButton"',
    'data-screen="actions"',
    'data-screen="league"',
    'data-screen="profile"'
  ];
  const missing = requiredFragments.filter((fragment) => !html.includes(fragment));
  if (missing.length) {
    throw new Error(`VK Hosting build is missing client surface: ${missing.join(', ')}`);
  }
  if (/telegram\.org\/js\/telegram-web-app\.js/i.test(html)) {
    throw new Error('VK Hosting build still contains Telegram WebApp runtime.');
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
  let html = source
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(/<script defer src="\/vendor\/vk-bridge\.js[^>]*><\/script>\s*/gi, '')
    .replace(/<script defer src="\/vk-platform\.js[^>]*><\/script>\s*/gi, '');

  if (!html.includes('account-link.js')) {
    html = html.replace(
      /<script defer src="app\.js([^\"]*)"><\/script>/i,
      '<script defer src="/account-link.js?v=2.3.0"></script>\n  <script defer src="app.js$1"></script>'
    );
  }

  html = html.replace(
    /<script defer src="\/account-link\.js([^\"]*)"><\/script>/i,
    '<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\n  <script defer src="/vk-platform.js?v=3.2.2-main-parity"></script>\n  <script defer src="/account-link.js$1"></script>'
  );

  const runtimeConfig = `<script>window.__PIVNIK_VK_API_BASE__=${JSON.stringify(apiBase)};</script>`;
  if (!html.includes('</head>')) throw new Error('index.html has no </head>.');
  html = html.replace('</head>', `  ${runtimeConfig}\n</head>`);
  assertVkClientSurface(html);
  return html;
}

function patchVkRuntime(source) {
  const marker = "  const originalFetch = window.fetch.bind(window);";
  if (!source.includes(marker)) throw new Error('vk-platform.js originalFetch marker not found.');

  const helper = `${marker}\n  const configuredApiBase = String(window.__PIVNIK_VK_API_BASE__ || '').trim().replace(/\\/+$/, '');\n\n  function resolveGatewayInput(input) {\n    if (!configuredApiBase) return input;\n    try {\n      const requestUrl = typeof input === 'string' ? input : input?.url || '';\n      const parsed = new URL(requestUrl, window.location.href);\n      const isApi = parsed.pathname === '/api' || parsed.pathname.startsWith('/api/');\n      const isRelativeApi = typeof input === 'string' && /^\\/api(?:\\/|$)/.test(requestUrl);\n      const isSameOriginApi = parsed.origin === window.location.origin && isApi;\n      if (!isRelativeApi && !isSameOriginApi) return input;\n      const target = configuredApiBase + parsed.pathname + parsed.search;\n      if (typeof Request !== 'undefined' && input instanceof Request) return new Request(target, input);\n      return target;\n    } catch (_) {\n      return input;\n    }\n  }`;

  let patched = source.replace(marker, helper);

  const bridgeLaunchFunction = `  function getBridgeLaunchParams() {`;
  if (!patched.includes(bridgeLaunchFunction)) {
    throw new Error('VK runtime launch params refresh function not found.');
  }
  patched = patched.replace(bridgeLaunchFunction, `  async function getBridgeLaunchParams() {`);

  const bridgeLaunchReturn = `    return bridgeLaunchParamsPromise;\n  }\n\n  async function resolveLaunchParams(preferBridge = false) {`;
  if (!patched.includes(bridgeLaunchReturn)) {
    throw new Error('VK runtime launch params promise return not found.');
  }
  patched = patched.replace(
    bridgeLaunchReturn,
    `    const resolvedLaunchParams = await bridgeLaunchParamsPromise;\n    if (!resolvedLaunchParams) bridgeLaunchParamsPromise = null;\n    return resolvedLaunchParams;\n  }\n\n  async function resolveLaunchParams(preferBridge = false) {`
  );

  const inputCalls = patched.match(/originalFetch\(input/g) || [];
  if (inputCalls.length !== 2) {
    throw new Error(`Expected exactly 2 originalFetch(input calls, found ${inputCalls.length}.`);
  }
  patched = patched.replace(/originalFetch\(input/g, 'originalFetch(resolveGatewayInput(input)');

  patched = patched.replace(
    /originalFetch\((['"])(\/api[^'"]*)\1/g,
    (_match, quote, apiPath) => `originalFetch(resolveGatewayInput(${quote}${apiPath}${quote})`
  );

  if (/originalFetch\(input/.test(patched)) {
    throw new Error('VK runtime still contains an un-routed dynamic API fetch.');
  }
  if (/originalFetch\((['"])\/api(?:\/|\1)/.test(patched)) {
    throw new Error('VK runtime still contains an un-routed literal API fetch.');
  }

  const authSingleFlight = `\n\n;(() => {\n  const vkPlatformFetch = window.fetch.bind(window);\n  let authInFlight = null;\n\n  window.fetch = (input, init = {}) => {\n    const requestUrl = typeof input === 'string' ? input : input?.url || '';\n    let pathname = requestUrl;\n    try { pathname = new URL(requestUrl, window.location.href).pathname; } catch (_) {}\n    if (pathname !== '/api/auth') return vkPlatformFetch(input, init);\n\n    if (!authInFlight) {\n      authInFlight = Promise.resolve(vkPlatformFetch(input, init))\n        .finally(() => {\n          queueMicrotask(() => { authInFlight = null; });\n        });\n    }\n    return authInFlight.then((response) => response.clone());\n  };\n})();\n`;
  if (!patched.includes('const vkPlatformFetch = window.fetch.bind(window);')) {
    patched += authSingleFlight;
  }
  return patched;
}

function patchVkAppRuntime(source) {
  const recoveryStateMarker = `let bootCompleted = false;`;
  if (!source.includes(recoveryStateMarker)) throw new Error('app.js boot state marker not found.');
  let patched = source.replace(
    recoveryStateMarker,
    `${recoveryStateMarker}\nlet vkSessionRecoveryPromise = null;`
  );

  const apiStateMarker = `  let lastError;\n  for (let attempt = 0; attempt < attempts; attempt += 1) {`;
  if (!patched.includes(apiStateMarker)) throw new Error('app.js API attempt marker not found.');
  patched = patched.replace(
    apiStateMarker,
    `  let lastError;\n  let vkSessionRecoveryUsed = false;\n  for (let attempt = 0; attempt < attempts; attempt += 1) {\n    const vkRequestToken = state.token;`
  );

  const catchMarker = `    } catch (error) {\n      lastError = error;\n      const retryable = !error.status || error.status >= 500 || error.code === 'TIMEOUT';`;
  if (!patched.includes(catchMarker)) throw new Error('app.js API catch marker not found.');
  patched = patched.replace(
    catchMarker,
    `    } catch (error) {\n      lastError = error;\n      const canRecoverVkSession = IS_VK\n        && method === 'GET'\n        && String(path) !== '/api/auth'\n        && String(path) !== '/api/bootstrap'\n        && error?.status === 401\n        && !vkSessionRecoveryUsed;\n      if (canRecoverVkSession) {\n        vkSessionRecoveryUsed = true;\n        if (vkRequestToken && state.token && state.token !== vkRequestToken) {\n          attempt -= 1;\n          continue;\n        }\n        if (!vkSessionRecoveryPromise) {\n          vkSessionRecoveryPromise = (async () => {\n            state.token = '';\n            safeStorage.remove('pivnik_session');\n            await authenticate();\n          })().finally(() => {\n            vkSessionRecoveryPromise = null;\n          });\n        }\n        await vkSessionRecoveryPromise;\n        attempt -= 1;\n        continue;\n      }\n      const retryable = !error.status || error.status >= 500 || error.code === 'TIMEOUT';`
  );

  return patched;
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const sourceHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const renderedHtml = renderVkIndex(sourceHtml);
await fs.writeFile(path.join(outDir, 'index.html'), renderedHtml);

for (const directory of ['assets', 'vendor']) await copyIfExists(directory);

const references = new Set();
for (const match of renderedHtml.matchAll(/(?:src|href)="([^\"]+)"/g)) {
  const raw = String(match[1] || '');
  if (!raw || /^(?:https?:|data:|#)/i.test(raw)) continue;
  references.add(raw.replace(/^\/+/, '').split(/[?#]/)[0]);
}
for (const file of references) await copyIfExists(file);

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

const vkAppPath = path.join(outDir, 'app.js');
const vkAppRuntime = await fs.readFile(vkAppPath, 'utf8');
await fs.writeFile(vkAppPath, patchVkAppRuntime(vkAppRuntime));

const requiredFiles = [
  'index.html',
  'app.js',
  'vk-platform.js',
  'account-link.js',
  'vendor/vk-bridge.js',
  'styles.css'
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
