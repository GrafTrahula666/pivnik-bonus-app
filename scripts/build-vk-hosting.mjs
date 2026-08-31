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
    .replace(/<!-- telegram-wheel:start -->[\s\S]*?<!-- telegram-wheel:end -->/g, '')
    .replace(/<script defer src="https:\/\/telegram\.org\/js\/telegram-web-app\.js[^>]*><\/script>\s*/i, '')
    .replace(
      /<script defer src="\/account-link\.js([^\"]*)"><\/script>/i,
      '<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\n  <script defer src="/account-link.js$1"></script>'
    );

  const runtimeConfig = `<script>window.__PIVNIK_VK_API_BASE__=${JSON.stringify(apiBase)};</script>`;
  if (!html.includes('</head>')) throw new Error('index.html has no </head>.');
  return html.replace('</head>', `  ${runtimeConfig}\n</head>`);
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
await fs.writeFile(path.join(outDir, 'index.html'), renderedHtml);

for (const directory of ['assets', 'vendor']) await copyIfExists(directory);

const references = new Set();
for (const match of renderedHtml.matchAll(/(?:src|href)="([^\"]+)"/g)) {
  const raw = String(match[1] || '');
  if (!raw || /^(?:https?:|data:|#)/i.test(raw)) continue;
  references.add(raw.replace(/^\/+/, '').split(/[?#]/)[0]);
}
for (const file of references) await copyIfExists(file);

const vkRuntimePath = path.join(outDir, 'vk-platform.js');
const vkRuntime = await fs.readFile(vkRuntimePath, 'utf8');
await fs.writeFile(vkRuntimePath, patchVkRuntime(vkRuntime));

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
